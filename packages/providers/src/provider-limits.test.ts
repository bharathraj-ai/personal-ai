import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isModelNotFoundError, isQuotaError, isRateLimitError, isRequestTooLargeError, pickChatModel, providerLimits, retryAfterMs } from "./provider-limits.js";

describe("provider limits", () => {
  it("gives Bharath a 1024-token input budget", () => {
    assert.equal(providerLimits("bharath-ai").maxInputTokens, 1024);
    assert.equal(providerLimits("groq").jsonStructured, true);
  });

  it("does not treat Groq TPM request-too-large as a pin-worthy rate limit", () => {
    const groqTpm =
      'Model API error 413: Request too large for model openai/gpt-oss-120b on tokens per minute (TPM): Limit 8000, Requested 8568, please reduce your message size';
    assert.equal(isRequestTooLargeError(groqTpm), true);
    assert.equal(isRateLimitError(groqTpm), false);
    assert.equal(retryAfterMs("Please try again in 7.935s."), 8335);
  });

  it("detects quota errors so Cerebras 402 is not retried forever", () => {
    assert.equal(
      isQuotaError('Model API error 402: {"code":"payment_required"}'),
      true,
    );
    assert.equal(isQuotaError("model_not_found"), false);
  });

  it("detects model_not_found without retrying that id", () => {
    assert.equal(
      isModelNotFoundError('Model API error 404: {"code":"model_not_found"}'),
      true,
    );
    const next = pickChatModel(["llama-3.3-70b", "llama3.1-8b"], new Set(["llama-3.3-70b"]));
    assert.equal(next, "llama3.1-8b");
  });
});
