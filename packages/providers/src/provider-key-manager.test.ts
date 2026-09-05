import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProviderKeyManager, assertNoSecrets } from "./provider-key-manager.js";
import { loadNumberedEnvKeys } from "./env-keys.js";
import { classifyProviderError } from "./error-classifier.js";

describe("ProviderKeyManager", () => {
  it("selects a single active key and keeps it after success", async () => {
    const km = new ProviderKeyManager();
    km.registerKey("groq", "k1", "gsk_aaaaaaaaaaaaaaaaaaaaaaaa");
    const a = await km.selectKey("groq");
    assert.equal(a?.keyId, "k1");
    km.recordSuccess("groq", "k1", 10);
    const b = await km.selectKey("groq");
    assert.equal(b?.keyId, "k1");
    km.releaseInFlight("groq", "k1");
    assert.equal(km.records("groq")[0]?.status, "ACTIVE");
  });

  it("loads non-contiguous numbered env keys", () => {
    const loaded = loadNumberedEnvKeys("GROQ_API_KEY", {
      GROQ_API_KEY: "gsk_one",
      GROQ_API_KEY_2: "gsk_two",
      GROQ_API_KEY_5: "gsk_five",
    } as NodeJS.ProcessEnv);
    assert.equal(loaded.length, 3);
    assert.ok(loaded.some((k) => k.envName === "GROQ_API_KEY_5"));
  });

  it("429 cooldowns a key and selects the next", async () => {
    const km = new ProviderKeyManager({ cooldownBaseMs: 30_000 });
    km.registerKey("groq", "k1", "gsk_aaaaaaaaaaaaaaaaaaaaaaaa");
    km.registerKey("groq", "k2", "gsk_bbbbbbbbbbbbbbbbbbbbbbbb");
    const first = await km.selectKey("groq");
    assert.equal(first?.keyId, "k1");
    km.recordFailure(
      "groq",
      "k1",
      'Model API error 429: {"error":{"message":"Rate limit reached"}}',
    );
    const second = await km.selectKey("groq");
    assert.equal(second?.keyId, "k2");
    km.recordSuccess("groq", "k2");
    const rec1 = km.records("groq").find((k) => k.keyId === "k1");
    assert.equal(rec1?.status, "COOLDOWN");
    const third = await km.selectKey("groq");
    assert.equal(third?.keyId, "k2");
    km.releaseInFlight("groq", "k2");
  });

  it("skips cooldown keys until expiry", async () => {
    const km = new ProviderKeyManager({ cooldownBaseMs: 50, cooldownMaxMs: 50 });
    km.registerKey("groq", "k1", "gsk_aaaaaaaaaaaaaaaaaaaaaaaa");
    km.registerKey("groq", "k2", "gsk_bbbbbbbbbbbbbbbbbbbbbbbb");
    const first = await km.selectKey("groq");
    km.recordFailure("groq", first!.keyId, "Model API error 429: rate_limit_exceeded");
    await new Promise((r) => setTimeout(r, 80));
    const after = await km.selectKey("groq");
    assert.ok(after);
    km.releaseInFlight("groq", after!.keyId);
  });

  it("401 marks the key INVALID", () => {
    const km = new ProviderKeyManager();
    km.registerKey("groq", "k1", "gsk_aaaaaaaaaaaaaaaaaaaaaaaa");
    km.recordFailure("groq", "k1", "Model API error 401: invalid api key");
    assert.equal(km.records("groq")[0]?.status, "INVALID");
    assert.equal(km.statusView().groq?.healthyKeys, 0);
  });

  it("402 marks payment required and pauses the provider", async () => {
    const km = new ProviderKeyManager();
    km.registerKey("cerebras", "c1", "csk-aaaaaaaaaaaaaaaaaaaaaaaa");
    km.recordFailure("cerebras", "c1", 'Model API error 402: {"code":"payment_required"}');
    assert.equal(km.records("cerebras")[0]?.status, "PAYMENT_REQUIRED");
    assert.equal(await km.selectKey("cerebras"), null);
    assert.equal(km.statusView().cerebras?.reason, "payment_required");
  });

  it("classifies model_not_found without treating it as payment", () => {
    const c = classifyProviderError('Model API error 404: {"code":"model_not_found"}');
    assert.equal(c.kind, "MODEL_UNAVAILABLE");
    assert.equal(c.retryable, false);
  });

  it("5xx is retryable provider error", () => {
    const c = classifyProviderError("Model API error 503: unavailable");
    assert.equal(c.kind, "PROVIDER_ERROR");
    assert.equal(c.retryable, true);
  });

  it("org TPM 429 is PROVIDER_LIMIT", () => {
    const c = classifyProviderError(
      "Model API error 429: Rate limit reached for model x in organization org_1 on tokens per minute (TPM)",
    );
    assert.equal(c.kind, "RATE_LIMITED");
    assert.equal(c.limitScope, "PROVIDER_LIMIT");
  });

  it("status view never includes secrets", () => {
    const km = new ProviderKeyManager();
    km.registerKey("groq", "k1", "gsk_supersecretkeyvaluezzzzzzzz");
    const json = JSON.stringify(km.statusView()) + JSON.stringify(km.getEvents()) + JSON.stringify(km.records("groq"));
    assert.equal(json.includes("gsk_supersecret"), false);
    assert.equal(assertNoSecrets(json), true);
  });

  it("concurrent select does not hand the same in-flight key twice", async () => {
    const km = new ProviderKeyManager();
    km.registerKey("groq", "k1", "gsk_aaaaaaaaaaaaaaaaaaaaaaaa");
    km.registerKey("groq", "k2", "gsk_bbbbbbbbbbbbbbbbbbbbbbbb");
    const [a, b] = await Promise.all([km.selectKey("groq"), km.selectKey("groq")]);
    assert.ok(a && b);
    assert.notEqual(a.keyId, b.keyId);
    km.releaseInFlight("groq", a.keyId);
    km.releaseInFlight("groq", b.keyId);
  });

  it("does not retry indefinitely: max two keys then none", async () => {
    const km = new ProviderKeyManager();
    km.registerKey("groq", "k1", "gsk_aaaaaaaaaaaaaaaaaaaaaaaa");
    km.registerKey("groq", "k2", "gsk_bbbbbbbbbbbbbbbbbbbbbbbb");
    const a = await km.selectKey("groq");
    km.recordFailure("groq", a!.keyId, "Model API error 401: invalid");
    const b = await km.selectKey("groq");
    km.recordFailure("groq", b!.keyId, "Model API error 401: invalid");
    assert.equal(await km.selectKey("groq"), null);
  });

  it("keeps a successful key sticky instead of round-robin", async () => {
    const km = new ProviderKeyManager();
    km.addKey("groq", "k1", "gsk_aaaaaaaaaaaaaaaaaaaaaaaa");
    km.addKey("groq", "k2", "gsk_bbbbbbbbbbbbbbbbbbbbbbbb");
    const first = await km.selectKey("groq");
    assert.equal(first?.keyId, "k1");
    km.markSuccess("groq", "k1", 12);
    const second = await km.selectKey("groq");
    assert.equal(second?.keyId, "k1");
    km.releaseInFlight("groq", "k1");
  });

  it("third key succeeds after two 429s", async () => {
    const km = new ProviderKeyManager({ cooldownBaseMs: 30_000 });
    km.registerKey("groq", "k1", "gsk_aaaaaaaaaaaaaaaaaaaaaaaa");
    km.registerKey("groq", "k2", "gsk_bbbbbbbbbbbbbbbbbbbbbbbb");
    km.registerKey("groq", "k3", "gsk_cccccccccccccccccccccccc");
    const a = await km.selectKey("groq");
    km.recordFailure("groq", a!.keyId, "Model API error 429: rate_limit_exceeded");
    const b = await km.selectKey("groq");
    km.recordFailure("groq", b!.keyId, "Model API error 429: rate_limit_exceeded");
    const c = await km.selectKey("groq");
    assert.equal(c?.keyId, "k3");
    km.recordSuccess("groq", "k3");
    const skip = await km.selectKey("groq");
    assert.equal(skip?.keyId, "k3");
    km.releaseInFlight("groq", "k3");
  });

  it("classifies network failures separately from 429", () => {
    const c = classifyProviderError("fetch failed: ECONNRESET");
    assert.equal(c.kind, "NETWORK_ERROR");
    assert.equal(c.retryable, true);
  });
});
