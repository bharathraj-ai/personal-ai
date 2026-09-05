import { estimateTokensFromText } from "./env-keys.js";
import { providerLimits } from "./provider-limits.js";
import type { ProviderKeyManager } from "./provider-key-manager.js";

export interface ProviderBudgetSnapshot {
  provider: string;
  model?: string;
  requests: number;
  estimatedTokens: number;
  usageLabel: "ESTIMATED";
  lastRequestAt?: number;
  rateLimitedUntil?: number;
  consecutiveFailures: number;
  temporaryUnavailable: boolean;
  permanentUnavailable: boolean;
  reason?: string;
}

/** Session/request budget — values are ESTIMATED unless the provider returned usage. */
export class ProviderBudgetManager {
  constructor(private readonly keys?: ProviderKeyManager) {}

  canSpend(providerId: string, estimatedInput: number, maxOutput: number): boolean {
    const limits = providerLimits(providerId);
    return estimatedInput + maxOutput <= limits.maxInputTokens + limits.maxOutputTokens;
  }

  clampOutput(providerId: string, estimatedInput: number, requestedOutput: number): number {
    const limits = providerLimits(providerId);
    const tpmHeadroom = providerId.includes("groq") ? 8000 - estimatedInput - 64 : limits.maxOutputTokens;
    return Math.max(256, Math.min(requestedOutput, limits.maxOutputTokens, tpmHeadroom));
  }

  snapshot(provider: string, model?: string): ProviderBudgetSnapshot {
    const records = this.keys?.records(provider) ?? [];
    const view = this.keys?.statusView()[provider];
    const requests = records.reduce((n, r) => n + r.requestCount, 0);
    const estimatedTokens = records.reduce((n, r) => n + r.estimatedUsage, 0);
    const failures = records.reduce((n, r) => n + r.consecutiveFailures, 0);
    const retry = this.keys?.nextRetryAt(provider);
    return {
      provider,
      model,
      requests,
      estimatedTokens,
      usageLabel: "ESTIMATED",
      lastRequestAt: records.reduce((m, r) => Math.max(m, r.lastUsedAt ?? 0), 0) || undefined,
      rateLimitedUntil: retry,
      consecutiveFailures: failures,
      temporaryUnavailable: Boolean(view && !view.available && view.cooldownKeys > 0),
      permanentUnavailable: Boolean(view?.reason === "payment_required" || (view && view.invalidKeys > 0 && view.healthyKeys === 0)),
      reason: view?.reason,
    };
  }
}

export { estimateTokensFromText };
