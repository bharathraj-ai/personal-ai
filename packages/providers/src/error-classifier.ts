import {
  isModelNotFoundError,
  isQuotaError,
  isRateLimitError,
  isRequestTooLargeError,
  retryAfterMs,
} from "./provider-limits.js";

export type ProviderErrorKind =
  | "RATE_LIMITED"
  | "PAYMENT_REQUIRED"
  | "INVALID"
  | "PERMISSION"
  | "MODEL_UNAVAILABLE"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "REQUEST_TOO_LARGE"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export type LimitScope = "KEY_LIMIT" | "PROVIDER_LIMIT";

export interface ClassifiedProviderError {
  kind: ProviderErrorKind;
  httpStatus?: number;
  retryAfterMs?: number;
  limitScope?: LimitScope;
  retryable: boolean;
}

const STATUS = /Model API error (\d{3})/i;

export function classifyProviderError(message: string): ClassifiedProviderError {
  const statusMatch = message.match(STATUS);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined;

  if (isRequestTooLargeError(message) || httpStatus === 413) {
    return { kind: "REQUEST_TOO_LARGE", httpStatus: httpStatus ?? 413, retryable: true };
  }
  if (isQuotaError(message) || httpStatus === 402) {
    return { kind: "PAYMENT_REQUIRED", httpStatus: 402, retryable: false, limitScope: "PROVIDER_LIMIT" };
  }
  if (isModelNotFoundError(message) || (httpStatus === 404 && /model/i.test(message))) {
    return { kind: "MODEL_UNAVAILABLE", httpStatus: 404, retryable: false };
  }
  if (httpStatus === 401 || /\binvalid api key\b|incorrect api key|authentication/i.test(message)) {
    return { kind: "INVALID", httpStatus: 401, retryable: false, limitScope: "KEY_LIMIT" };
  }
  if (httpStatus === 403) {
    return { kind: "PERMISSION", httpStatus: 403, retryable: false, limitScope: "KEY_LIMIT" };
  }
  if (httpStatus === 408 || /timeout|timed out|abort/i.test(message)) {
    return { kind: "TIMEOUT", httpStatus: httpStatus ?? 408, retryable: true };
  }
  if (
    /ENOTFOUND|ECONNRESET|ECONNREFUSED|fetch failed|network|socket hang up|UND_ERR/i.test(
      message,
    )
  ) {
    return { kind: "NETWORK_ERROR", retryable: true };
  }
  if (isRateLimitError(message) || httpStatus === 429) {
    const orgWide = /organization|tokens per minute \(TPM\)|provider[- ]wide|project/i.test(message);
    return {
      kind: "RATE_LIMITED",
      httpStatus: 429,
      retryAfterMs: retryAfterMs(message),
      retryable: true,
      limitScope: orgWide ? "PROVIDER_LIMIT" : "KEY_LIMIT",
    };
  }
  if (httpStatus && httpStatus >= 500) {
    return { kind: "PROVIDER_ERROR", httpStatus, retryable: true };
  }
  return { kind: "UNKNOWN", httpStatus, retryable: true };
}

export function sanitizeProviderError(message: string): string {
  return message
    .replace(/\b(gsk_|csk-|AIza|AQ\.|sk-|Bearer\s+)[A-Za-z0-9_\-.]{8,}/gi, "[REDACTED]")
    .replace(/api[_-]?key["'\s:=]+[^\s"'&,}]+/gi, "api_key=[REDACTED]")
    .slice(0, 500);
}
