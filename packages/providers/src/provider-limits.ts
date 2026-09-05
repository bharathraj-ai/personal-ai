export interface ProviderLimits {
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  jsonStructured: boolean;
}

export const PROVIDER_LIMITS: Record<string, ProviderLimits> = {
  "bharath-ai": {
    maxInputTokens: 1024,
    maxOutputTokens: 256,
    timeoutMs: 30_000,
    jsonStructured: false,
  },
  groq: {
    maxInputTokens: 6000,
    maxOutputTokens: 2048,
    timeoutMs: 60_000,
    jsonStructured: true,
  },
  gemini: {
    maxInputTokens: 8192,
    maxOutputTokens: 4096,
    timeoutMs: 60_000,
    jsonStructured: true,
  },
  cerebras: {
    maxInputTokens: 8192,
    maxOutputTokens: 2048,
    timeoutMs: 45_000,
    jsonStructured: true,
  },
  fallback: {
    maxInputTokens: 8192,
    maxOutputTokens: 4096,
    timeoutMs: 60_000,
    jsonStructured: true,
  },
};

export function providerLimits(providerId: string): ProviderLimits {
  const id = providerId.toLowerCase();
  for (const [key, limits] of Object.entries(PROVIDER_LIMITS)) {
    if (id.includes(key)) return limits;
  }
  return PROVIDER_LIMITS.fallback!;
}

export function isModelNotFoundError(message: string): boolean {
  return /model_not_found|does not exist or you do not have access|model does not exist|no longer available/i.test(
    message,
  );
}

/** Billing/quota — never retry this provider for the rest of the session. */
export function isQuotaError(message: string): boolean {
  return /payment_required|quota|billing tab|402:|insufficient_quota/i.test(message);
}

/** Request size vs TPM budget — retry smaller; do not pin the provider. */
export function isRequestTooLargeError(message: string): boolean {
  if (/\b429\b/.test(message)) return false;
  return /request too large|reduce your message size|Requested \d+/i.test(message);
}

export function isRateLimitError(message: string): boolean {
  if (isRequestTooLargeError(message)) return false;
  return /\b429\b|too many requests|rate_limit_exceeded/i.test(message);
}

export function retryAfterMs(message: string): number | undefined {
  const m = message.match(/try again in ([\d.]+)\s*s/i);
  if (!m) return undefined;
  return Math.min(30_000, Math.round(Number(m[1]) * 1000) + 400);
}

const NON_CHAT = /whisper|embed|tts|guard|moderation/i;

export function pickChatModel(ids: string[], dead: Set<string>): string | undefined {
  const cleaned = ids
    .map((id) => id.replace(/^models\//, ""))
    .filter((id) => !dead.has(id) && !NON_CHAT.test(id));
  const flash = cleaned.find((id) => /flash/i.test(id) && !/tts|image/i.test(id));
  return flash ?? cleaned[0];
}
