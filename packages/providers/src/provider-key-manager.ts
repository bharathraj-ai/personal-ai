import { classifyProviderError, sanitizeProviderError, type LimitScope, type ProviderErrorKind } from "./error-classifier.js";
import { loadNumberedEnvKeys } from "./env-keys.js";

export type KeyStatus = "ACTIVE" | "COOLDOWN" | "INVALID" | "DISABLED" | "PAYMENT_REQUIRED";

export interface ProviderKeyRecord {
  provider: string;
  keyId: string;
  status: KeyStatus;
  lastUsedAt?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  cooldownUntil?: number;
  consecutiveFailures: number;
  rateLimitCount: number;
  invalidCount: number;
  paymentRequired: boolean;
  requestCount: number;
  estimatedUsage: number;
  enabled: boolean;
}

export interface SafeKeyEvent {
  event: string;
  provider: string;
  keyId?: string;
  from?: string;
  to?: string;
  reason?: string;
  at: string;
}

export interface ProviderKeyStatusView {
  available: boolean;
  healthyKeys: number;
  cooldownKeys: number;
  invalidKeys: number;
  paymentRequiredKeys: number;
  totalKeys: number;
  lastSuccessfulKeyId?: string;
  reason?: string;
  model?: string;
}

type StoredKey = ProviderKeyRecord & { secret: string };

export interface KeyManagerOptions {
  rotation?: boolean;
  maxAttempts?: number;
  cooldownBaseMs?: number;
  cooldownMaxMs?: number;
}

const DEFAULTS: Required<KeyManagerOptions> = {
  rotation: true,
  maxAttempts: 3,
  cooldownBaseMs: 30_000,
  cooldownMaxMs: 900_000,
};

export class ProviderKeyManager {
  private readonly keys = new Map<string, StoredKey[]>();
  private readonly providerPauseUntil = new Map<string, number>();
  private readonly providerPauseReason = new Map<string, string>();
  private readonly events: SafeKeyEvent[] = [];
  private readonly lastGoodKey = new Map<string, string>();
  private lock: Promise<void> = Promise.resolve();
  private readonly inFlight = new Set<string>();
  readonly options: Required<KeyManagerOptions>;

  constructor(options: KeyManagerOptions = {}) {
    this.options = {
      rotation: options.rotation ?? DEFAULTS.rotation,
      maxAttempts: options.maxAttempts ?? DEFAULTS.maxAttempts,
      cooldownBaseMs: options.cooldownBaseMs ?? DEFAULTS.cooldownBaseMs,
      cooldownMaxMs: options.cooldownMaxMs ?? DEFAULTS.cooldownMaxMs,
    };
  }

  loadFromEnv(env: NodeJS.ProcessEnv = process.env): void {
    this.ingest("groq", loadNumberedEnvKeys("GROQ_API_KEY", env));
    this.ingest("gemini", loadNumberedEnvKeys("GEMINI_API_KEY", env));
    this.ingest("cerebras", loadNumberedEnvKeys("CEREBRAS_API_KEY", env));
  }

  addKey(provider: string, keyId: string, secret: string): void {
    this.registerKey(provider, keyId, secret);
  }

  registerKey(provider: string, keyId: string, secret: string): void {
    const list = this.keys.get(provider) ?? [];
    if (list.some((k) => k.keyId === keyId || k.secret === secret)) return;
    list.push({
      provider,
      keyId,
      secret,
      status: "ACTIVE",
      consecutiveFailures: 0,
      rateLimitCount: 0,
      invalidCount: 0,
      paymentRequired: false,
      requestCount: 0,
      estimatedUsage: 0,
      enabled: true,
    });
    this.keys.set(provider, list);
  }

  async selectKey(provider: string): Promise<{ keyId: string; secret: string } | null> {
    return this.withLock(async () => {
      this.expireCooldowns(provider);
      if (this.isProviderPaused(provider)) return null;
      const eligible = (this.keys.get(provider) ?? []).filter(
        (k) => k.enabled && k.status === "ACTIVE" && !this.inFlight.has(`${provider}:${k.keyId}`),
      );
      const stickyId = this.lastGoodKey.get(provider);
      const sticky = eligible.find((k) => k.keyId === stickyId);
      eligible.sort((a, b) => {
        if (a.estimatedUsage !== b.estimatedUsage) return a.estimatedUsage - b.estimatedUsage;
        if (a.consecutiveFailures !== b.consecutiveFailures) {
          return a.consecutiveFailures - b.consecutiveFailures;
        }
        return (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0);
      });
      const pick = sticky ?? eligible[0];
      if (!pick) return null;
      this.inFlight.add(`${provider}:${pick.keyId}`);
      pick.lastUsedAt = Date.now();
      pick.requestCount += 1;
      this.pushEvent({ event: "KEY_SELECTED", provider, keyId: pick.keyId });
      return { keyId: pick.keyId, secret: pick.secret };
    });
  }

  releaseInFlight(provider: string, keyId: string): void {
    this.inFlight.delete(`${provider}:${keyId}`);
  }

  recordSuccess(provider: string, keyId: string, estimatedTokens = 0): void {
    const key = this.find(provider, keyId);
    if (!key) return;
    key.lastSuccessAt = Date.now();
    key.consecutiveFailures = 0;
    key.estimatedUsage += estimatedTokens;
    key.status = "ACTIVE";
    this.lastGoodKey.set(provider, keyId);
    this.releaseInFlight(provider, keyId);
    this.pushEvent({ event: "REQUEST_SUCCESS", provider, keyId });
  }

  recordFailure(provider: string, keyId: string | undefined, rawError: string): Classified {
    const classified = classifyProviderError(rawError);
    const safe = sanitizeProviderError(rawError);
    if (keyId) this.releaseInFlight(provider, keyId);
    const key = keyId ? this.find(provider, keyId) : undefined;
    if (key) {
      key.lastFailureAt = Date.now();
      key.consecutiveFailures += 1;
    }

    if (classified.kind === "RATE_LIMITED") {
      const wait =
        classified.retryAfterMs ??
        this.backoffMs(key?.rateLimitCount ?? 0);
      if (classified.limitScope === "PROVIDER_LIMIT") {
        this.pauseProvider(provider, wait, "rate_limited");
      } else if (key) {
        key.rateLimitCount += 1;
        this.cooldown(key, wait);
        this.pushEvent({ event: "RATE_LIMITED", provider, keyId: key.keyId, reason: "key_limit" });
        this.pushEvent({ event: "KEY_COOLDOWN", provider, keyId: key.keyId });
      }
    } else if (classified.kind === "PAYMENT_REQUIRED") {
      if (key) {
        key.paymentRequired = true;
        key.status = "PAYMENT_REQUIRED";
        key.enabled = false;
      }
      this.pauseProvider(provider, 6 * 60 * 60 * 1000, "payment_required");
      this.pushEvent({ event: "PAYMENT_REQUIRED", provider, keyId: key?.keyId });
    } else if (classified.kind === "INVALID" || classified.kind === "PERMISSION") {
      if (key) {
        key.invalidCount += 1;
        key.status = "INVALID";
        key.enabled = false;
      }
      this.pushEvent({ event: "KEY_INVALID", provider, keyId: key?.keyId, reason: classified.kind.toLowerCase() });
    } else if (classified.kind === "MODEL_UNAVAILABLE") {
      this.pushEvent({ event: "MODEL_UNAVAILABLE", provider, reason: safe.slice(0, 120) });
    } else if (classified.kind === "PROVIDER_ERROR" || classified.kind === "TIMEOUT" || classified.kind === "NETWORK_ERROR") {
      if (key && key.consecutiveFailures >= 5) this.cooldown(key, this.backoffMs(key.consecutiveFailures));
    }

    return { ...classified, safeMessage: safe };
  }

  markSuccess(provider: string, keyId: string, estimatedTokens = 0): void {
    this.recordSuccess(provider, keyId, estimatedTokens);
  }

  markRateLimited(provider: string, keyId: string, rawError: string): Classified {
    return this.recordFailure(provider, keyId, rawError);
  }

  markInvalid(provider: string, keyId: string, rawError = "Model API error 401: invalid api key"): Classified {
    return this.recordFailure(provider, keyId, rawError);
  }

  markPaymentRequired(provider: string, keyId: string, rawError = "Model API error 402: payment_required"): Classified {
    return this.recordFailure(provider, keyId, rawError);
  }

  getAvailableKeys(provider: string): string[] {
    this.expireCooldowns(provider);
    return (this.keys.get(provider) ?? [])
      .filter((k) => k.enabled && k.status === "ACTIVE")
      .map((k) => k.keyId);
  }

  getProviderStatus(): Record<string, ProviderKeyStatusView> {
    return this.statusView();
  }

  recordFallback(from: string, to: string, reason: string): void {
    this.pushEvent({ event: "PROVIDER_FALLBACK", provider: to, from, to, reason });
  }

  /** Admin/dev: clear KEY_LIMIT cooldowns. Does not re-enable INVALID or PAYMENT_REQUIRED. */
  resetCooldowns(provider?: string): void {
    const providers = provider ? [provider] : ["groq", "gemini", "cerebras"];
    for (const id of providers) {
      if (this.providerPauseReason.get(id) === "payment_required") continue;
      this.providerPauseUntil.delete(id);
      this.providerPauseReason.delete(id);
      for (const key of this.keys.get(id) ?? []) {
        if (key.status === "COOLDOWN") {
          key.status = "ACTIVE";
          key.cooldownUntil = undefined;
          key.enabled = true;
          this.pushEvent({ event: "KEY_REENABLED", provider: id, keyId: key.keyId });
        }
      }
    }
  }

  nextRetryAt(provider: string): number | undefined {
    const pause = this.providerPauseUntil.get(provider);
    const keyWaits = (this.keys.get(provider) ?? [])
      .filter((k) => k.status === "COOLDOWN" && k.cooldownUntil)
      .map((k) => k.cooldownUntil!);
    const times = [...(pause ? [pause] : []), ...keyWaits];
    if (!times.length) return undefined;
    return Math.min(...times);
  }

  isProviderPaused(provider: string): boolean {
    const until = this.providerPauseUntil.get(provider);
    if (!until) return false;
    if (Date.now() >= until) {
      this.providerPauseUntil.delete(provider);
      this.providerPauseReason.delete(provider);
      return false;
    }
    return true;
  }

  hasEligibleKey(provider: string): boolean {
    this.expireCooldowns(provider);
    if (this.isProviderPaused(provider)) return false;
    return (this.keys.get(provider) ?? []).some((k) => k.enabled && k.status === "ACTIVE");
  }

  statusView(): Record<string, ProviderKeyStatusView> {
    const out: Record<string, ProviderKeyStatusView> = {};
    for (const provider of ["groq", "gemini", "cerebras"]) {
      this.expireCooldowns(provider);
      const list = this.keys.get(provider) ?? [];
      const healthyKeys = list.filter((k) => k.enabled && k.status === "ACTIVE").length;
      const cooldownKeys = list.filter((k) => k.status === "COOLDOWN").length;
      const invalidKeys = list.filter((k) => k.status === "INVALID").length;
      const paymentRequiredKeys = list.filter((k) => k.status === "PAYMENT_REQUIRED").length;
      const paused = this.isProviderPaused(provider);
      const reason = paused ? this.providerPauseReason.get(provider) : undefined;
      out[provider] = {
        available: healthyKeys > 0 && !paused,
        healthyKeys,
        cooldownKeys,
        invalidKeys,
        paymentRequiredKeys,
        totalKeys: list.length,
        lastSuccessfulKeyId: this.lastGoodKey.get(provider),
        reason: paymentRequiredKeys > 0 && healthyKeys === 0
          ? "payment_required"
          : reason,
      };
    }
    return out;
  }

  records(provider: string): ProviderKeyRecord[] {
    return (this.keys.get(provider) ?? []).map(({ secret: _s, ...rest }) => rest);
  }

  getEvents(limit = 50): SafeKeyEvent[] {
    return this.events.slice(-limit);
  }

  reenableKey(provider: string, keyId: string): void {
    const key = this.find(provider, keyId);
    if (!key || key.status === "INVALID" || key.status === "PAYMENT_REQUIRED") return;
    key.status = "ACTIVE";
    key.enabled = true;
    key.cooldownUntil = undefined;
    this.pushEvent({ event: "KEY_REENABLED", provider, keyId });
  }

  private ingest(provider: string, loaded: Array<{ keyId: string; value: string }>): void {
    for (const k of loaded) this.registerKey(provider, k.keyId, k.value);
  }

  private find(provider: string, keyId: string): StoredKey | undefined {
    return (this.keys.get(provider) ?? []).find((k) => k.keyId === keyId);
  }

  private cooldown(key: StoredKey, ms: number): void {
    const wait = Math.min(this.options.cooldownMaxMs, Math.max(this.options.cooldownBaseMs, ms));
    key.status = "COOLDOWN";
    key.cooldownUntil = Date.now() + wait;
  }

  private backoffMs(rateLimitCount: number): number {
    const step = this.options.cooldownBaseMs * 2 ** Math.min(rateLimitCount, 4);
    return Math.min(this.options.cooldownMaxMs, step);
  }

  private pauseProvider(provider: string, ms: number, reason: string): void {
    const until = Date.now() + Math.min(this.options.cooldownMaxMs, ms);
    this.providerPauseUntil.set(provider, until);
    this.providerPauseReason.set(provider, reason);
    this.pushEvent({ event: "PROVIDER_PAUSED", provider, reason });
  }

  private expireCooldowns(provider: string): void {
    const now = Date.now();
    for (const key of this.keys.get(provider) ?? []) {
      if (key.status === "COOLDOWN" && key.cooldownUntil && key.cooldownUntil <= now) {
        key.status = "ACTIVE";
        key.cooldownUntil = undefined;
      }
    }
  }

  private pushEvent(partial: Omit<SafeKeyEvent, "at">): void {
    this.events.push({ ...partial, at: new Date().toISOString() });
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.lock;
    this.lock = prev.then(() => gate);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export type Classified = ReturnType<typeof classifyProviderError> & { safeMessage: string };

export function assertNoSecrets(text: string): boolean {
  return !/\b(gsk_|csk-|AIza|sk-|Bearer\s+)[A-Za-z0-9_\-.]{8,}/i.test(text);
}

export type { LimitScope, ProviderErrorKind };
