import type { ModelAdapter } from "@personal-ai/ai-core";
import type {
  HealthStatus,
  ProviderCapability,
  ProviderConfig,
  TokenUsage,
} from "@personal-ai/shared";
import { isModelNotFoundError, pickChatModel, providerLimits } from "./provider-limits.js";
import { classifyProviderError, sanitizeProviderError } from "./error-classifier.js";
import { estimateTokensFromText, dynamicMaxOutputTokens } from "./env-keys.js";
import { ProviderBudgetManager } from "./provider-budget.js";
import type { ProviderKeyManager } from "./provider-key-manager.js";

export type TaskType =
  | "chat"
  | "code"
  | "image"
  | "embedding"
  | "review"
  | "fix"
  | "complex_coding"
  | "verification";

export type RoutedTask =
  | "chat"
  | "complex_coding"
  | "code_review"
  | "verification";

export interface ProviderSelectionCriteria {
  taskType: TaskType;
  preferOwnModel?: boolean;
  maxLatencyMs?: number;
}

/** P3 selection request — capability is required. */
export interface ProviderSelectRequest {
  capability: ProviderCapability;
  taskType?: TaskType;
  preferredProvider?: string;
  excludeProviders?: string[];
  /** Default true: Bharath remains brain unless a specialist is explicitly needed. */
  preferOwnModel?: boolean;
  maxLatencyMs?: number;
}

export type ProviderSelectionStatus =
  | "selected"
  | "OWN_MODEL"
  | "NO_ELIGIBLE_PROVIDER";

export interface ProviderSelection {
  status: ProviderSelectionStatus;
  providerId: string;
  adapter: ModelAdapter;
  reason: string;
  capability: ProviderCapability;
  attempted: string[];
  healthy?: boolean;
  latencyMs?: number;
}

export interface ProviderUsageRecord {
  providerId: string;
  model?: string;
  task?: string;
  capability?: ProviderCapability;
  timestamp: Date;
  requestCount: number;
  promptTokens: number | "unknown";
  completionTokens: number | "unknown";
  totalTokens: number | "unknown";
  latencyMs: number | "unknown";
  success: boolean;
  error?: string;
}

export interface ProviderExecuteResult {
  selection: ProviderSelection;
  result?: Awaited<ReturnType<ModelAdapter["generate"]>>;
  error?: string;
  usage?: ProviderUsageRecord;
  fallbackUsed: boolean;
  attempted: string[];
}

export interface StructuredExecuteResult<T> extends ProviderExecuteResult {
  parsed?: T;
  validation: "valid" | "invalid" | "repaired" | "failed";
  fallbackReason?: string;
  failureKind?: ProviderFailureKind;
  attemptCount: number;
  selectedProvider: string;
  waitingForProvider?: { retryAt?: string; reason: string };
}

export type ProviderFailureKind =
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_STRUCTURED_OUTPUT"
  | "RATE_LIMIT"
  | "PROVIDER_LIMIT"
  | "PAYMENT_REQUIRED"
  | "MODEL_NOT_FOUND"
  | "NETWORK_ERROR"
  | "AUTH_ERROR"
  | "NO_ELIGIBLE_PROVIDER";

/** Secret-free snapshot for orchestrator / UI / model-facing routing. */
export interface ProviderCapabilityView {
  provider: string;
  id?: string;
  name?: string;
  model?: string;
  healthy: boolean;
  available: boolean;
  capabilities: ProviderCapability[];
  latency?: number;
  failureCount: number;
}

export type StructuredParseFn<T> = (
  text: string,
) => { ok: true; value: T } | { ok: false; error: string };

const DEFAULT_OWN_CAPABILITIES: ProviderCapability[] = [
  "chat",
  "generation",
  "reasoning",
  "streaming",
  "verification",
  "planning",
];

/** Conservative defaults — only claim what OpenAI-compatible chat APIs reasonably support. */
export const SPECIALIST_CAPABILITIES: Record<string, ProviderCapability[]> = {
  groq: [
    "chat",
    "coding",
    "code_review",
    "code_fix",
    "reasoning",
    "generation",
    "streaming",
    "planning",
    "json_structured_output",
    "fast_response",
    "verification",
  ],
  gemini: [
    "chat",
    "coding",
    "code_review",
    "code_fix",
    "reasoning",
    "generation",
    "streaming",
    "multimodal",
    "planning",
    "json_structured_output",
    "research",
    "verification",
  ],
  cerebras: [
    "chat",
    "coding",
    "code_review",
    "code_fix",
    "reasoning",
    "generation",
    "streaming",
    "planning",
    "json_structured_output",
    "fast_response",
    "verification",
  ],
  fallback: [
    "generation",
    "reasoning",
    "streaming",
    "coding",
    "code_review",
    "code_fix",
    "json_structured_output",
    "planning",
  ],
};

const MAX_FALLBACK_ATTEMPTS = 6;
const HEALTH_CACHE_MS = 30_000;
const QUOTA_PIN_MS = 6 * 60 * 60 * 1000;

function classifyStructuredFailure(
  error: string | undefined,
  validation: StructuredExecuteResult<unknown>["validation"],
  fallbackReason?: string,
): ProviderFailureKind | undefined {
  if (validation === "valid" || validation === "repaired") return undefined;
  const combined = `${fallbackReason ?? ""} ${error ?? ""}`;
  if (/payment_required|PAYMENT_REQUIRED|"code":"payment_required"/i.test(combined)) {
    return "PAYMENT_REQUIRED";
  }
  if (/rate limited|429|quota exceeded/i.test(combined)) {
    return "RATE_LIMIT";
  }
  const msg = error ?? "";
  if (/invalid structured output|not valid JSON|schema validation/i.test(combined)) {
    return "INVALID_STRUCTURED_OUTPUT";
  }
  if (/NO_ELIGIBLE_PROVIDER/i.test(msg) && !fallbackReason) return "NO_ELIGIBLE_PROVIDER";
  const classified = classifyProviderError(msg);
  switch (classified.kind) {
    case "RATE_LIMITED":
      return "RATE_LIMIT";
    case "PAYMENT_REQUIRED":
      return "PAYMENT_REQUIRED";
    case "MODEL_UNAVAILABLE":
      return "MODEL_NOT_FOUND";
    case "NETWORK_ERROR":
      return "NETWORK_ERROR";
    case "INVALID":
    case "PERMISSION":
      return "AUTH_ERROR";
    default:
      if (/provider.?limit|quota exceeded|too many requests/i.test(msg)) {
        return "PROVIDER_LIMIT";
      }
      return validation === "failed" || validation === "invalid"
        ? "INVALID_STRUCTURED_OUTPUT"
        : "PROVIDER_UNAVAILABLE";
  }
}

/**
 * Provider manager — routes to own model or specialist external providers.
 * External providers are optional workers, never the default path for normal chat.
 */
export class ProviderManager {
  private readonly ownModel: ModelAdapter;
  private readonly specialists = new Map<string, ModelAdapter>();
  private readonly configs = new Map<string, ProviderConfig>();
  private readonly healthCache = new Map<string, { at: number; status: HealthStatus }>();
  private readonly usageLog: ProviderUsageRecord[] = [];
  private ownCapabilities: ProviderCapability[] = [...DEFAULT_OWN_CAPABILITIES];
  private readonly failureCounts = new Map<string, number>();
  private readonly capabilityTests = new Map<string, "PASS" | "FAIL" | "UNTESTED">();
  private readonly deadModels = new Map<string, Set<string>>();
  private lastStructuredTrace?: {
    selectedProvider: string;
    fallbackReason?: string;
    attemptCount: number;
    validation: string;
    attempted: string[];
    responseSize?: number;
    failureKind?: ProviderFailureKind;
  };
  private readonly pinnedUnhealthy = new Map<string, { until: number; message: string }>();
  private keyManager?: ProviderKeyManager;
  private budgetManager?: ProviderBudgetManager;
  private waitingForProvider?: { retryAt?: string; reason: string };

  constructor(ownModel: ModelAdapter) {
    this.ownModel = ownModel;
  }

  setOwnCapabilities(caps: ProviderCapability[]): void {
    this.ownCapabilities = [...caps];
  }

  getOwnCapabilities(): ProviderCapability[] {
    return [...this.ownCapabilities];
  }

  setCapabilityTest(name: string, result: "PASS" | "FAIL" | "UNTESTED"): void {
    this.capabilityTests.set(name, result);
  }

  getCapabilityTests(): Record<string, "PASS" | "FAIL" | "UNTESTED"> {
    return Object.fromEntries(this.capabilityTests);
  }

  getLastStructuredTrace() {
    return this.lastStructuredTrace;
  }

  attachKeyManager(manager: ProviderKeyManager): void {
    this.keyManager = manager;
    this.budgetManager = new ProviderBudgetManager(manager);
  }

  getKeyManager(): ProviderKeyManager | undefined {
    return this.keyManager;
  }

  getWaitingForProvider(): { retryAt?: string; reason: string } | undefined {
    return this.waitingForProvider;
  }

  getSafeProviderStatus(): Record<string, unknown> {
    return this.keyManager?.statusView() ?? {};
  }

  private ownCanServe(capability: ProviderCapability): boolean {
    if (capability === "chat") {
      return (
        this.ownCapabilities.includes("chat") ||
        this.ownCapabilities.includes("generation")
      );
    }
    return this.ownCapabilities.includes(capability);
  }

  registerSpecialist(config: ProviderConfig, adapter: ModelAdapter): void {
    const capabilities =
      config.capabilities ??
      SPECIALIST_CAPABILITIES[config.id] ??
      SPECIALIST_CAPABILITIES[config.type] ??
      ["generation", "streaming"];
    this.specialists.set(config.id, adapter);
    this.configs.set(config.id, { ...config, capabilities });
  }

  /**
   * Legacy select — prefer own model by default.
   * Prefer {@link selectFor} for capability-aware routing.
   */
  select(criteria: ProviderSelectionCriteria, specialistId?: string): ModelAdapter {
    if (specialistId) {
      const specialist = this.specialists.get(specialistId);
      if (specialist) return specialist;
    }
    // Default: own model. Specialists only when preferOwnModel === false.
    if (criteria.preferOwnModel === false) {
      const enabled = [...this.configs.values()]
        .filter((c) => c.enabled)
        .sort((a, b) => a.priority - b.priority);
      for (const config of enabled) {
        const adapter = this.specialists.get(config.id);
        if (adapter) return adapter;
      }
    }
    return this.ownModel;
  }

  /**
   * Task-type routing: chat stays on Bharath; coding/review may use a specialist.
   * Registration alone does not select a provider.
   */
  async selectForTask(task: RoutedTask): Promise<ProviderSelection> {
    switch (task) {
      case "chat":
        return this.selectFor({ capability: "generation", preferOwnModel: true, taskType: "chat" });
      case "complex_coding":
        return this.selectFor({
          capability: "coding",
          preferOwnModel: this.ownCanServe("coding") && this.ownCanServe("json_structured_output"),
          taskType: "complex_coding",
        });
      case "code_review":
        return this.selectFor({
          capability: "code_review",
          preferOwnModel: false,
          taskType: "review",
        });
      case "verification":
        return this.selectFor({
          capability: "verification",
          preferOwnModel: true,
          taskType: "verification",
        });
    }
  }

  /**
   * Capability-aware selection. Does not pick a provider merely because it is registered.
   */
  async selectFor(request: ProviderSelectRequest): Promise<ProviderSelection> {
    const attempted: string[] = [];
    const exclude = new Set(request.excludeProviders ?? []);
    const preferOwn = request.preferOwnModel !== false;
    const capability =
      request.capability === "chat" ? ("generation" as ProviderCapability) : request.capability;

    // Own model only when it actually has the capability (not merely because it is loaded).
    if (preferOwn && !request.preferredProvider && this.ownCanServe(request.capability)) {
      const health = await this.ownModel.healthCheck();
      const ready = Boolean(health.healthy && health.modelLoaded !== false);
      const specialistOnly =
        request.capability === "coding" ||
        request.capability === "json_structured_output" ||
        request.capability === "code_review" ||
        request.capability === "code_fix";
      if (specialistOnly && !ready) {
        // Fall through to a healthy specialist.
      } else {
        return {
          status: "OWN_MODEL",
          providerId: this.ownModel.id,
          adapter: this.ownModel,
          reason: ready
            ? "Bharath AI is primary for this capability"
            : "Bharath AI selected but model weights are NOT_LOADED",
          capability,
          attempted,
          healthy: ready,
          latencyMs: health.latencyMs,
        };
      }
    }

    const candidates = [...this.configs.values()]
      .filter((c) => c.enabled)
      .filter((c) => !exclude.has(c.id))
      .filter((c) => (c.capabilities ?? []).includes(capability))
      .sort((a, b) => {
        if (request.preferredProvider) {
          if (a.id === request.preferredProvider) return -1;
          if (b.id === request.preferredProvider) return 1;
        }
        return a.priority - b.priority;
      });

    if (candidates.length === 0) {
      if (
        capability === "coding" ||
        capability === "code_review" ||
        capability === "code_fix" ||
        capability === "json_structured_output" ||
        capability === "multimodal"
      ) {
        if (preferOwn === false || !this.ownCanServe(capability)) {
          return {
            status: "NO_ELIGIBLE_PROVIDER",
            providerId: this.ownModel.id,
            adapter: this.ownModel,
            reason: `NO_ELIGIBLE_PROVIDER for capability ${capability}`,
            capability,
            attempted,
          };
        }
      }
      return {
        status: "OWN_MODEL",
        providerId: this.ownModel.id,
        adapter: this.ownModel,
        reason: "No specialist matched; using Bharath AI",
        capability,
        attempted,
      };
    }

    for (const config of candidates) {
      attempted.push(config.id);
      const adapter = this.specialists.get(config.id);
      if (!adapter) continue;

      if (this.keyManager && this.keyManager.records(config.id).length > 0) {
        if (this.keyManager.isProviderPaused(config.id) || !this.keyManager.hasEligibleKey(config.id)) {
          continue;
        }
      }

      const health = await this.getHealth(config.id, adapter);
      if (!health.healthy) continue;
      if (this.isModelExhausted(config.id, adapter)) continue;
      if (
        request.maxLatencyMs != null &&
        health.latencyMs != null &&
        health.latencyMs > request.maxLatencyMs
      ) {
        continue;
      }

      return {
        status: "selected",
        providerId: config.id,
        adapter,
        reason: `Selected ${config.name} for ${request.capability} (priority ${config.priority})`,
        capability: request.capability,
        attempted,
        healthy: true,
        latencyMs: health.latencyMs,
      };
    }

    return {
      status: "NO_ELIGIBLE_PROVIDER",
      providerId: this.ownModel.id,
      adapter: this.ownModel,
      reason: `NO_ELIGIBLE_PROVIDER: no healthy specialist for ${request.capability}`,
      capability: request.capability,
      attempted,
    };
  }

  /**
   * Bounded fallback: try providers until one succeeds or attempts exhausted.
   * Does not cycle endlessly. Does not substitute incompatible capabilities.
   */
  async executeWithFallback(
    request: ProviderSelectRequest,
    generate: Parameters<ModelAdapter["generate"]>[0],
    options: { maxAttempts?: number } = {},
  ): Promise<ProviderExecuteResult> {
    const maxAttempts = Math.min(options.maxAttempts ?? MAX_FALLBACK_ATTEMPTS, MAX_FALLBACK_ATTEMPTS);
    const attempted: string[] = [];
    const exclude: string[] = [...(request.excludeProviders ?? [])];
    let lastSelection: ProviderSelection | undefined;
    let lastError: string | undefined;
    let fallbackUsed = false;

    for (let i = 0; i < maxAttempts; i++) {
      const selection = await this.selectFor({
        ...request,
        preferOwnModel: i === 0 ? request.preferOwnModel !== false : false,
        excludeProviders: exclude,
      });
      lastSelection = selection;

      if (selection.status === "NO_ELIGIBLE_PROVIDER") {
        return {
          selection,
          error: selection.reason,
          fallbackUsed,
          attempted,
        };
      }

      if (attempted.includes(selection.providerId) && this.shouldLeaveProvider(selection.providerId)) {
        exclude.push(selection.providerId);
        continue;
      }
      if (!attempted.includes(selection.providerId)) attempted.push(selection.providerId);

      const started = Date.now();
      try {
        const result = await this.generateWithModelRecovery(selection, generate);
        const latencyMs = Date.now() - started;
        const usage = this.recordUsage({
          providerId: selection.providerId,
          model: this.configs.get(selection.providerId)?.model,
          capability: request.capability,
          task: request.taskType,
          latencyMs,
          success: true,
          usage: result.usage,
        });
        return {
          selection,
          result,
          usage,
          fallbackUsed,
          attempted,
        };
      } catch (err) {
        fallbackUsed = true;
        lastError = err instanceof Error ? err.message : String(err);
        this.pinIfTerminal(selection.providerId, lastError);
        // Never log credentials — only provider id + sanitized error
        this.recordUsage({
          providerId: selection.providerId,
          capability: request.capability,
          task: request.taskType,
          latencyMs: Date.now() - started,
          success: false,
          error: sanitizeProviderError(lastError),
        });
        if (this.shouldLeaveProvider(selection.providerId)) {
          exclude.push(selection.providerId);
        }
      }
    }

    return {
      selection:
        lastSelection ??
        ({
          status: "NO_ELIGIBLE_PROVIDER",
          providerId: this.ownModel.id,
          adapter: this.ownModel,
          reason: "NO_ELIGIBLE_PROVIDER",
          capability: request.capability,
          attempted,
        } satisfies ProviderSelection),
      error: lastError ?? "All provider attempts failed",
      fallbackUsed,
      attempted,
    };
  }

  /**
   * Generate + schema-validate. Invalid output triggers repair then a different provider.
   * Does not silently swap providers: fallbackReason and attempted are always recorded.
   */
  async executeStructured<T>(
    request: ProviderSelectRequest,
    generate: Parameters<ModelAdapter["generate"]>[0],
    parse: StructuredParseFn<T>,
    options: { maxAttempts?: number } = {},
  ): Promise<StructuredExecuteResult<T>> {
    const maxAttempts = Math.min(options.maxAttempts ?? MAX_FALLBACK_ATTEMPTS, MAX_FALLBACK_ATTEMPTS);
    const attempted: string[] = [];
    const exclude: string[] = [...(request.excludeProviders ?? [])];
    let lastSelection: ProviderSelection | undefined;
    let lastError: string | undefined;
    let fallbackUsed = false;
    let fallbackReason: string | undefined;
    let attemptCount = 0;

    for (let i = 0; i < maxAttempts; i++) {
      const selection = await this.selectFor({
        ...request,
        preferOwnModel: i === 0 ? request.preferOwnModel !== false : false,
        excludeProviders: exclude,
      });
      lastSelection = selection;

      if (selection.status === "NO_ELIGIBLE_PROVIDER") {
        const failed: StructuredExecuteResult<T> = {
          selection,
          error: selection.reason,
          fallbackUsed,
          attempted,
          validation: "failed",
          fallbackReason: fallbackReason ?? selection.reason,
          attemptCount,
          selectedProvider: selection.providerId,
          waitingForProvider: this.waitingForProvider ?? {
            reason: selection.reason ?? "no eligible coding provider",
            retryAt: this.keyManager
              ? (() => {
                  const t = ["groq", "gemini", "cerebras"]
                    .map((p) => this.keyManager?.nextRetryAt(p))
                    .filter((n): n is number => Boolean(n));
                  return t.length ? new Date(Math.min(...t)).toISOString() : undefined;
                })()
              : undefined,
          },
        };
        this.lastStructuredTrace = {
          selectedProvider: selection.providerId,
          fallbackReason: failed.fallbackReason,
          attemptCount,
          validation: "failed",
          attempted,
        };
        return {
          ...failed,
          failureKind: classifyStructuredFailure(failed.error, "failed", failed.fallbackReason),
        };
      }

      if (attempted.includes(selection.providerId) && this.shouldLeaveProvider(selection.providerId)) {
        exclude.push(selection.providerId);
        continue;
      }
      if (!attempted.includes(selection.providerId)) attempted.push(selection.providerId);
      attemptCount += 1;

      const started = Date.now();
      try {
        const result = await this.generateWithModelRecovery(selection, generate);
        const responseSize = (result.content ?? "").length;
        let parsed = parse(result.content ?? "");
        let validation: StructuredExecuteResult<T>["validation"] = parsed.ok ? "valid" : "invalid";

        if (!parsed.ok) {
          const repair = await this.generateWithModelRecovery(selection, {
            ...generate,
            temperature: 0,
            messages: [
              ...(generate.messages ?? []),
              { role: "assistant", content: (result.content ?? "").slice(0, 2500) },
              {
                role: "user",
                content: `Your previous output failed schema validation: ${parsed.error}. Return ONLY valid JSON for the required schema. No markdown, no explanation.`,
              },
            ],
          });
          attemptCount += 1;
          parsed = parse(repair.content ?? "");
          if (parsed.ok) {
            validation = "repaired";
            const usage = this.recordUsage({
              providerId: selection.providerId,
              model: this.configs.get(selection.providerId)?.model,
              capability: request.capability,
              task: request.taskType,
              latencyMs: Date.now() - started,
              success: true,
              usage: repair.usage,
            });
            const out: StructuredExecuteResult<T> = {
              selection,
              result: repair,
              usage,
              fallbackUsed,
              attempted,
              parsed: parsed.value,
              validation,
              fallbackReason,
              attemptCount,
              selectedProvider: selection.providerId,
            };
            this.lastStructuredTrace = {
              selectedProvider: selection.providerId,
              fallbackReason,
              attemptCount,
              validation,
              attempted,
              responseSize: (repair.content ?? "").length,
            };
            return out;
          }
          fallbackUsed = true;
          fallbackReason = appendReason(
            fallbackReason,
            `invalid structured output from ${selection.providerId}: ${parsed.error}`,
          );
          lastError = fallbackReason;
          this.recordUsage({
            providerId: selection.providerId,
            capability: request.capability,
            task: request.taskType,
            latencyMs: Date.now() - started,
            success: false,
            error: sanitizeProviderError(parsed.error),
          });
          exclude.push(selection.providerId);
          continue;
        }

        const usage = this.recordUsage({
          providerId: selection.providerId,
          model: this.configs.get(selection.providerId)?.model,
          capability: request.capability,
          task: request.taskType,
          latencyMs: Date.now() - started,
          success: true,
          usage: result.usage,
        });
        const out: StructuredExecuteResult<T> = {
          selection,
          result,
          usage,
          fallbackUsed,
          attempted,
          parsed: parsed.value,
          validation,
          fallbackReason,
          attemptCount,
          selectedProvider: selection.providerId,
        };
        this.lastStructuredTrace = {
          selectedProvider: selection.providerId,
          fallbackReason,
          attemptCount,
          validation,
          attempted,
          responseSize,
        };
        if (fallbackUsed && attempted.length > 1) {
          const from = attempted.find((p) => p !== selection.providerId);
          if (from) {
            this.keyManager?.recordFallback(
              from,
              selection.providerId,
              fallbackReason ?? "provider_fallback",
            );
          }
        }
        return out;
      } catch (err) {
        fallbackUsed = true;
        lastError = err instanceof Error ? err.message : String(err);
        this.pinIfTerminal(selection.providerId, lastError);
        const classified = classifyProviderError(lastError);
        fallbackReason = appendReason(
          fallbackReason,
          `generate failed on ${selection.providerId}: ${sanitizeProviderError(lastError)}`,
        );
        this.recordUsage({
          providerId: selection.providerId,
          capability: request.capability,
          task: request.taskType,
          latencyMs: Date.now() - started,
          success: false,
          error: sanitizeProviderError(lastError),
        });
        const moreKeys = this.keyManager?.hasEligibleKey(selection.providerId);
        if (classified.kind === "PAYMENT_REQUIRED" || !moreKeys) {
          if (!exclude.includes(selection.providerId)) {
            exclude.push(selection.providerId);
          }
        }
      }
    }

    const failed: StructuredExecuteResult<T> = {
      selection:
        lastSelection ??
        ({
          status: "NO_ELIGIBLE_PROVIDER",
          providerId: this.ownModel.id,
          adapter: this.ownModel,
          reason: "NO_ELIGIBLE_PROVIDER",
          capability: request.capability,
          attempted,
        } satisfies ProviderSelection),
      error: lastError ?? "All structured-output attempts failed",
      fallbackUsed,
      attempted,
      validation: "failed",
      fallbackReason: fallbackReason ?? lastError,
      attemptCount,
      selectedProvider: lastSelection?.providerId ?? this.ownModel.id,
      waitingForProvider: this.waitingForProvider,
    };
    this.lastStructuredTrace = {
      selectedProvider: failed.selectedProvider,
      fallbackReason: failed.fallbackReason,
      attemptCount,
      validation: "failed",
      attempted,
      failureKind: classifyStructuredFailure(failed.error, "failed", failed.fallbackReason),
    };
    return {
      ...failed,
      failureKind: classifyStructuredFailure(failed.error, "failed", failed.fallbackReason),
    };
  }

  async healthCheckAll(options?: { force?: boolean }): Promise<Map<string, HealthStatus>> {
    const force = options?.force ?? false;
    const results = new Map<string, HealthStatus>();
    const entries: Array<[string, ModelAdapter]> = [
      [this.ownModel.id, this.ownModel],
      ...this.specialists.entries(),
    ];
    const checked = await Promise.all(
      entries.map(async ([id, adapter]) => [id, await this.getHealth(id, adapter, force)] as const),
    );
    for (const [id, status] of checked) {
      results.set(id, status);
    }
    return results;
  }

  listProviders(): ProviderConfig[] {
    return [...this.configs.values()];
  }

  /** Secret-free provider metadata. Never includes API keys or headers. */
  async listCapabilityViews(): Promise<ProviderCapabilityView[]> {
    const views: ProviderCapabilityView[] = [];
    const ownHealth = await this.ownModel.healthCheck();
    views.push({
      provider: this.ownModel.id,
      id: this.ownModel.id,
      name: this.ownModel.name,
      model: this.ownModel.name,
      healthy: Boolean(ownHealth.healthy),
      available: Boolean(ownHealth.healthy && ownHealth.modelLoaded !== false),
      capabilities: [...this.ownCapabilities],
      latency: ownHealth.latencyMs,
      failureCount: this.failureCounts.get(this.ownModel.id) ?? 0,
    });
    for (const [id, adapter] of this.specialists) {
      const cfg = this.configs.get(id);
      const health = await this.getHealth(id, adapter);
      views.push({
        provider: id,
        id,
        name: cfg?.name ?? id,
        model: cfg?.model,
        healthy: Boolean(health.healthy),
        available: Boolean(cfg?.enabled && health.healthy),
        capabilities: [...(cfg?.capabilities ?? [])],
        latency: health.latencyMs,
        failureCount: this.failureCounts.get(id) ?? 0,
      });
    }
    return views;
  }

  getUsageLog(limit = 100): ProviderUsageRecord[] {
    return this.usageLog.slice(-limit);
  }

  getOwnModel(): ModelAdapter {
    return this.ownModel;
  }

  private shouldLeaveProvider(providerId: string): boolean {
    if (!this.keyManager || this.keyManager.records(providerId).length === 0) return true;
    return !this.keyManager.hasEligibleKey(providerId);
  }

  private applyProviderLimits(
    providerId: string,
    generate: Parameters<ModelAdapter["generate"]>[0],
  ): Parameters<ModelAdapter["generate"]>[0] {
    const limits = providerLimits(providerId);
    const prompt = (generate.messages ?? []).map((m) => m.content).join("\n");
    const estimatedIn = estimateTokensFromText(prompt);
    const requested = generate.maxTokens ?? limits.maxOutputTokens;
    const dynamic = dynamicMaxOutputTokens({
      providerId,
      taskChars: prompt.length,
      hardMax: limits.maxOutputTokens,
    });
    const maxTokens = this.budgetManager
      ? this.budgetManager.clampOutput(providerId, estimatedIn, Math.min(requested, dynamic))
      : Math.min(requested, dynamic, limits.maxOutputTokens);
    return { ...generate, maxTokens };
  }

  private async applyKey(providerId: string, adapter: ModelAdapter): Promise<string | undefined> {
    if (!this.keyManager || this.keyManager.records(providerId).length === 0) return undefined;
    const selected = await this.keyManager.selectKey(providerId);
    if (!selected) return undefined;
    adapter.setApiKey?.(selected.secret);
    return selected.keyId;
  }

  private async generateWithModelRecovery(
    selection: ProviderSelection,
    generate: Parameters<ModelAdapter["generate"]>[0],
  ): Promise<Awaited<ReturnType<ModelAdapter["generate"]>>> {
    let bounded = this.applyProviderLimits(selection.providerId, generate);
    let keyId = await this.applyKey(selection.providerId, selection.adapter);
    const run = () => selection.adapter.generate(bounded);
    try {
      const result = await run();
      const tokens = result.usage?.totalTokens ?? estimateTokensFromText(result.content ?? "");
      if (keyId) this.keyManager?.recordSuccess(selection.providerId, keyId, typeof tokens === "number" ? tokens : 0);
      this.waitingForProvider = undefined;
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const classified = classifyProviderError(msg);
      if (this.keyManager) {
        this.keyManager.recordFailure(selection.providerId, keyId, msg);
      } else {
        this.pinIfTerminal(selection.providerId, msg);
      }

      if (classified.kind === "REQUEST_TOO_LARGE") {
        const smaller = Math.min(1024, Math.max(256, Math.floor((bounded.maxTokens ?? 2048) / 2)));
        bounded = { ...bounded, maxTokens: smaller };
        return run();
      }
      if (classified.kind === "RATE_LIMITED") {
        const wait = Math.min(classified.retryAfterMs ?? 2000, 30_000);
        if (wait <= 30_000) {
          await new Promise((resolve) => setTimeout(resolve, wait));
          try {
            const result = await run();
            if (keyId) this.keyManager?.recordSuccess(selection.providerId, keyId, 0);
            this.waitingForProvider = undefined;
            return result;
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            this.keyManager?.recordFailure(selection.providerId, keyId, retryMsg);
            const retryClassified = classifyProviderError(retryMsg);
            const retryWait = Math.min(retryClassified.retryAfterMs ?? 2000, 30_000);
            if (retryClassified.kind === "RATE_LIMITED" && retryWait <= 30_000) {
              await new Promise((resolve) => setTimeout(resolve, retryWait));
              try {
                const result2 = await run();
                if (keyId) this.keyManager?.recordSuccess(selection.providerId, keyId, 0);
                this.waitingForProvider = undefined;
                return result2;
              } catch (retryErr2) {
                const msg2 = retryErr2 instanceof Error ? retryErr2.message : String(retryErr2);
                this.keyManager?.recordFailure(selection.providerId, keyId, msg2);
              }
            }
            const retryAt = this.keyManager?.nextRetryAt(selection.providerId);
            this.waitingForProvider = {
              retryAt: retryAt ? new Date(retryAt).toISOString() : undefined,
              reason: `${selection.providerId} rate limited`,
            };
            throw retryErr;
          }
        }
        const retryAt = this.keyManager?.nextRetryAt(selection.providerId) ?? Date.now() + wait;
        this.waitingForProvider = {
          retryAt: new Date(retryAt).toISOString(),
          reason: `${selection.providerId} rate limited`,
        };
        throw err;
      }
      if (classified.kind === "PAYMENT_REQUIRED") {
        this.waitingForProvider = {
          reason: `${selection.providerId} payment_required`,
        };
        throw err;
      }
      if (classified.kind === "PROVIDER_ERROR" && classified.retryable) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        try {
          const result = await run();
          if (keyId) this.keyManager?.recordSuccess(selection.providerId, keyId, 0);
          this.waitingForProvider = undefined;
          return result;
        } catch (retryErr) {
          throw retryErr;
        }
      }
      if (!isModelNotFoundError(msg)) throw err;
      const current = selection.adapter.getModel?.() ?? this.configs.get(selection.providerId)?.model;
      if (current) {
        const dead = this.deadModels.get(selection.providerId) ?? new Set<string>();
        dead.add(current);
        this.deadModels.set(selection.providerId, dead);
      }
      const listed = (await selection.adapter.listModels?.()) ?? [];
      const dead = this.deadModels.get(selection.providerId) ?? new Set<string>();
      const next = pickChatModel(listed, dead);
      if (!next || next === current) {
        throw err;
      }
      selection.adapter.setModel?.(next);
      const cfg = this.configs.get(selection.providerId);
      if (cfg) this.configs.set(selection.providerId, { ...cfg, model: next });
      return run();
    }
  }

  private isModelExhausted(providerId: string, adapter: ModelAdapter): boolean {
    const dead = this.deadModels.get(providerId);
    const current = adapter.getModel?.();
    return Boolean(current && dead?.has(current) && !adapter.listModels);
  }

  private pinIfTerminal(providerId: string, message: string): void {
    const kind = classifyProviderError(message).kind;
    if (kind === "PAYMENT_REQUIRED") {
      this.pinnedUnhealthy.set(providerId, {
        until: Date.now() + QUOTA_PIN_MS,
        message: sanitizeProviderError(message),
      });
    }
  }

  private async getHealth(
    id: string,
    adapter: ModelAdapter,
    force = false,
  ): Promise<HealthStatus> {
    const pin = this.pinnedUnhealthy.get(id);
    if (pin && Date.now() < pin.until) {
      return { healthy: false, message: pin.message };
    }
    if (pin && Date.now() >= pin.until) {
      this.pinnedUnhealthy.delete(id);
    }
    const cached = this.healthCache.get(id);
    if (!force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
      return cached.status;
    }
    const status = await adapter.healthCheck();
    this.healthCache.set(id, { at: Date.now(), status });
    return status;
  }

  private recordUsage(input: {
    providerId: string;
    model?: string;
    capability?: ProviderCapability;
    task?: string;
    latencyMs: number;
    success: boolean;
    error?: string;
    usage?: TokenUsage;
  }): ProviderUsageRecord {
    const record: ProviderUsageRecord = {
      providerId: input.providerId,
      model: input.model,
      task: input.task,
      capability: input.capability,
      timestamp: new Date(),
      requestCount: 1,
      promptTokens: input.usage?.promptTokens ?? "unknown",
      completionTokens: input.usage?.completionTokens ?? "unknown",
      totalTokens: input.usage?.totalTokens ?? "unknown",
      latencyMs: input.latencyMs,
      success: input.success,
      error: input.error,
    };
    this.usageLog.push(record);
    if (!input.success) {
      this.failureCounts.set(input.providerId, (this.failureCounts.get(input.providerId) ?? 0) + 1);
    }
    if (this.usageLog.length > 1000) this.usageLog.splice(0, this.usageLog.length - 1000);
    return record;
  }
}

/** Strip anything that looks like a credential from provider error strings. */
export { sanitizeProviderError } from "./error-classifier.js";

function appendReason(prev: string | undefined, next: string): string {
  if (!prev) return next;
  if (prev.includes(next.slice(0, 80))) return prev;
  return `${prev} | ${next}`.slice(0, 900);
}

export { DEFAULT_OWN_CAPABILITIES };
