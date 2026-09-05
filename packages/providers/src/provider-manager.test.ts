import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  GenerateOptions,
  GenerateResult,
  HealthStatus,
  StreamChunk,
  TokenUsage,
} from "@personal-ai/shared";
import type { ModelAdapter } from "@personal-ai/ai-core";
import { ProviderManager, sanitizeProviderError } from "./provider-manager.js";
import { ProviderKeyManager } from "./provider-key-manager.js";

class FakeAdapter implements ModelAdapter {
  constructor(
    readonly id: string,
    readonly name: string,
    private readonly opts: {
      healthy?: boolean;
      failGenerate?: boolean;
      failMessage?: string;
      content?: string;
      latencyMs?: number;
      modelLoaded?: boolean;
    } = {},
  ) {}

  async generate(_options: GenerateOptions): Promise<GenerateResult> {
    if (this.opts.failGenerate) throw new Error(this.opts.failMessage ?? `fail:${this.id}`);
    return { content: this.opts.content ?? `ok:${this.id}`, finishReason: "stop" };
  }

  async *stream(): AsyncIterable<StreamChunk> {
    yield { type: "text", content: "x" };
    yield { type: "done" };
  }

  async healthCheck(): Promise<HealthStatus> {
    return {
      healthy: this.opts.healthy !== false,
      latencyMs: this.opts.latencyMs ?? 10,
      modelLoaded: this.opts.modelLoaded,
    };
  }

  async getUsage(): Promise<TokenUsage> {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  setApiKey(_key: string): void {}
}

describe("ProviderManager", () => {
  const own = new FakeAdapter("bharath-ai", "Bharath AI");

  function mgr() {
    const m = new ProviderManager(own);
    m.registerSpecialist(
      {
        id: "groq",
        name: "Groq",
        type: "groq",
        enabled: true,
        priority: 10,
        capabilities: ["coding", "code_review", "code_fix", "generation", "streaming", "json_structured_output"],
      },
      new FakeAdapter("groq", "Groq"),
    );
    m.registerSpecialist(
      {
        id: "gemini",
        name: "Gemini",
        type: "gemini",
        enabled: true,
        priority: 20,
        capabilities: ["coding", "code_review", "code_fix", "generation", "multimodal", "json_structured_output"],
      },
      new FakeAdapter("gemini", "Gemini"),
    );
    m.registerSpecialist(
      {
        id: "cerebras",
        name: "Cerebras",
        type: "cerebras",
        enabled: true,
        priority: 30,
        capabilities: ["coding", "code_fix", "generation"],
      },
      new FakeAdapter("cerebras", "Cerebras", { healthy: false }),
    );
    return m;
  }

  it("keeps Bharath as default for generation", async () => {
    const m = mgr();
    const sel = await m.selectFor({ capability: "generation" });
    assert.equal(sel.status, "OWN_MODEL");
    assert.equal(sel.providerId, "bharath-ai");
  });

  it("selects groq for code_review by priority among healthy providers", async () => {
    const m = mgr();
    const sel = await m.selectFor({
      capability: "code_review",
      preferOwnModel: false,
    });
    assert.equal(sel.status, "selected");
    assert.equal(sel.providerId, "groq");
  });

  it("skips unhealthy cerebras and does not claim multimodal for groq", async () => {
    const m = mgr();
    const multi = await m.selectFor({
      capability: "multimodal",
      preferOwnModel: false,
    });
    assert.equal(multi.providerId, "gemini");

    const coding = await m.selectFor({
      capability: "coding",
      preferOwnModel: false,
      excludeProviders: ["groq", "gemini"],
    });
    // cerebras unhealthy → NO_ELIGIBLE
    assert.equal(coding.status, "NO_ELIGIBLE_PROVIDER");
  });

  it("pins a 402 quota provider and does not retry it on the next call", async () => {
    const m = new ProviderManager(own);
    m.setOwnCapabilities(["chat"]);
    m.registerSpecialist(
      {
        id: "groq",
        name: "Groq",
        type: "groq",
        enabled: true,
        priority: 10,
        capabilities: ["json_structured_output", "coding"],
      },
      new FakeAdapter("groq", "Groq", { content: '{"ok":true}' }),
    );
    m.registerSpecialist(
      {
        id: "cerebras",
        name: "Cerebras",
        type: "cerebras",
        enabled: true,
        priority: 1,
        capabilities: ["json_structured_output", "coding"],
      },
      new FakeAdapter("cerebras", "Cerebras", {
        failGenerate: true,
        failMessage: 'Model API error 402: {"code":"payment_required"}',
      }),
    );
    const parse = (text: string) => {
      try {
        return { ok: true as const, value: JSON.parse(text) as { ok: boolean } };
      } catch {
        return { ok: false as const, error: "bad json" };
      }
    };
    const first = await m.executeStructured(
      { capability: "json_structured_output", preferOwnModel: false },
      { messages: [{ role: "user", content: "x" }] },
      parse,
    );
    assert.equal(first.selectedProvider, "groq");
    assert.ok(first.attempted.includes("cerebras"));
    const second = await m.executeStructured(
      { capability: "json_structured_output", preferOwnModel: false },
      { messages: [{ role: "user", content: "x" }] },
      parse,
    );
    assert.equal(second.selectedProvider, "groq");
    assert.ok(!second.attempted.includes("cerebras"));
  });

  it("returns NO_ELIGIBLE_PROVIDER when capability unsupported", async () => {
    const m = new ProviderManager(own);
    m.registerSpecialist(
      {
        id: "groq",
        name: "Groq",
        type: "groq",
        enabled: true,
        priority: 1,
        capabilities: ["generation"],
      },
      new FakeAdapter("groq", "Groq"),
    );
    const sel = await m.selectFor({
      capability: "code_fix",
      preferOwnModel: false,
    });
    assert.equal(sel.status, "NO_ELIGIBLE_PROVIDER");
  });

  it("bounded fallback skips failed provider and uses next eligible", async () => {
    const m = new ProviderManager(own);
    m.registerSpecialist(
      {
        id: "groq",
        name: "Groq",
        type: "groq",
        enabled: true,
        priority: 10,
        capabilities: ["code_fix"],
      },
      new FakeAdapter("groq", "Groq", { failGenerate: true }),
    );
    m.registerSpecialist(
      {
        id: "gemini",
        name: "Gemini",
        type: "gemini",
        enabled: true,
        priority: 20,
        capabilities: ["code_fix"],
      },
      new FakeAdapter("gemini", "Gemini", { content: "patch ok" }),
    );

    const out = await m.executeWithFallback(
      { capability: "code_fix", preferOwnModel: false },
      { messages: [{ role: "user", content: "fix" }] },
    );
    assert.equal(out.fallbackUsed, true);
    assert.equal(out.result?.content, "patch ok");
    assert.deepEqual(out.attempted, ["groq", "gemini"]);
  });

  it("does not invent usage quota numbers", async () => {
    const m = mgr();
    const out = await m.executeWithFallback(
      { capability: "coding", preferOwnModel: false },
      { messages: [{ role: "user", content: "x" }] },
    );
    assert.equal(out.usage?.promptTokens, "unknown");
  });

  it("sanitizes provider errors without echoing keys", () => {
    const cleaned = sanitizeProviderError("auth failed Bearer gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    assert.equal(cleaned.includes("gsk_ABCDEF"), false);
    assert.match(cleaned, /REDACTED/);
  });

  it("selectForTask uses Bharath for chat and a coding specialist when Bharath lacks coding capability", async () => {
    const m = mgr();
    const chat = await m.selectForTask("chat");
    assert.equal(chat.providerId, "bharath-ai");
    const coding = await m.selectForTask("complex_coding");
    assert.equal(coding.providerId, "groq");
    const review = await m.selectForTask("code_review");
    assert.equal(review.providerId, "groq");
  });

  it("routes coding to a specialist when Bharath weights are not loaded", async () => {
    const m = new ProviderManager(new FakeAdapter("bharath-ai", "Bharath AI", { healthy: false, modelLoaded: false }));
    m.registerSpecialist(
      {
        id: "groq",
        name: "Groq",
        type: "groq",
        enabled: true,
        priority: 10,
        capabilities: ["coding"],
      },
      new FakeAdapter("groq", "Groq"),
    );
    const coding = await m.selectForTask("complex_coding");
    assert.equal(coding.providerId, "groq");
  });

  it("executeWithFallback with preferOwnModel uses Bharath first only when coding capability is granted", async () => {
    const m = mgr();
    m.setOwnCapabilities(["generation", "reasoning", "streaming", "verification", "coding"]);
    const out = await m.executeWithFallback(
      { capability: "coding", preferOwnModel: true },
      { messages: [{ role: "user", content: "x" }] },
    );
    assert.equal(out.selection.providerId, "bharath-ai");
    assert.equal(out.result?.content, "ok:bharath-ai");
  });

  it("executeStructured falls back after invalid JSON without silent provider swap", async () => {
    const m = new ProviderManager(own);
    m.registerSpecialist(
      {
        id: "groq",
        name: "Groq",
        type: "groq",
        enabled: true,
        priority: 10,
        capabilities: ["coding", "json_structured_output"],
      },
      new FakeAdapter("groq", "Groq", { content: "not json" }),
    );
    m.registerSpecialist(
      {
        id: "gemini",
        name: "Gemini",
        type: "gemini",
        enabled: true,
        priority: 20,
        capabilities: ["coding", "json_structured_output"],
      },
      new FakeAdapter("gemini", "Gemini", {
        content: JSON.stringify({ ok: true }),
      }),
    );
    const out = await m.executeStructured(
      { capability: "json_structured_output", preferOwnModel: false },
      { messages: [{ role: "user", content: "json" }] },
      (text) => {
        try {
          const v = JSON.parse(text) as { ok?: boolean };
          if (v.ok === true) return { ok: true as const, value: v };
          return { ok: false as const, error: "missing ok" };
        } catch {
          return { ok: false as const, error: "not json" };
        }
      },
    );
    assert.equal(out.selectedProvider, "gemini");
    assert.equal(out.fallbackUsed, true);
    assert.match(out.fallbackReason ?? "", /invalid structured output from groq/);
    assert.equal(out.validation, "valid");
    assert.deepEqual(out.parsed, { ok: true });
  });

  it("legacy select prefers own model by default", () => {
    const m = mgr();
    assert.equal(m.select({ taskType: "chat" }).id, "bharath-ai");
    assert.equal(m.select({ taskType: "code", preferOwnModel: false }).id, "groq");
  });

  it("429 on groq falls back to gemini structured output", async () => {
    const m = new ProviderManager(own);
    m.setOwnCapabilities(["chat"]);
    m.registerSpecialist(
      {
        id: "groq",
        name: "Groq",
        type: "groq",
        enabled: true,
        priority: 10,
        capabilities: ["json_structured_output", "coding"],
      },
      new FakeAdapter("groq", "Groq", {
        failGenerate: true,
        failMessage: "Model API error 429: Rate limit reached. Please try again in 60s",
      }),
    );
    m.registerSpecialist(
      {
        id: "gemini",
        name: "Gemini",
        type: "gemini",
        enabled: true,
        priority: 20,
        capabilities: ["json_structured_output", "coding"],
      },
      new FakeAdapter("gemini", "Gemini", { content: '{"ok":true}' }),
    );
    const parse = (text: string) => {
      try {
        return { ok: true as const, value: JSON.parse(text) as { ok: boolean } };
      } catch {
        return { ok: false as const, error: "bad json" };
      }
    };
    const out = await m.executeStructured(
      { capability: "json_structured_output", preferOwnModel: false },
      { messages: [{ role: "user", content: "x" }] },
      parse,
    );
    assert.equal(out.selectedProvider, "gemini");
    assert.equal(out.fallbackUsed, true);
    assert.deepEqual(out.parsed, { ok: true });
    assert.equal(out.waitingForProvider, undefined);
  });

  it("all coding providers 429 yield WAITING_FOR_PROVIDER not a fake success", async () => {
    const m = new ProviderManager(own);
    m.setOwnCapabilities(["chat"]);
    for (const id of ["groq", "gemini"] as const) {
      m.registerSpecialist(
        {
          id,
          name: id,
          type: id,
          enabled: true,
          priority: id === "groq" ? 10 : 20,
          capabilities: ["json_structured_output", "coding"],
        },
        new FakeAdapter(id, id, {
          failGenerate: true,
          failMessage: "Model API error 429: Rate limit reached. Please try again in 90s",
        }),
      );
    }
    const out = await m.executeStructured(
      { capability: "json_structured_output", preferOwnModel: false },
      { messages: [{ role: "user", content: "x" }] },
      () => ({ ok: false as const, error: "none" }),
    );
    assert.equal(out.validation, "failed");
    assert.ok(out.waitingForProvider?.reason);
    assert.match(out.waitingForProvider?.reason ?? "", /rate limited/);
  });

  it("rotates Groq keys inside one request then succeeds", async () => {
    class FailThenOk implements ModelAdapter {
      id = "groq";
      name = "Groq";
      n = 0;
      async generate(): Promise<GenerateResult> {
        this.n += 1;
        // Exhaust inline 429 retries (up to 3 attempts per key) before succeeding.
        if (this.n <= 3) {
          throw new Error("Model API error 429: Rate limit reached. Please try again in 1s");
        }
        return { content: '{"ok":true}', finishReason: "stop" };
      }
      async *stream(): AsyncIterable<StreamChunk> {
        yield { type: "done" };
      }
      async healthCheck(): Promise<HealthStatus> {
        return { healthy: true, latencyMs: 1 };
      }
      async getUsage(): Promise<TokenUsage> {
        return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      }
      setApiKey(): void {}
    }
    const groq = new FailThenOk();
    const m = new ProviderManager(own);
    m.setOwnCapabilities(["chat"]);
    m.registerSpecialist(
      {
        id: "groq",
        name: "Groq",
        type: "groq",
        enabled: true,
        priority: 10,
        capabilities: ["json_structured_output", "coding"],
      },
      groq,
    );
    const km = new ProviderKeyManager({ cooldownBaseMs: 30_000 });
    km.registerKey("groq", "k1", "gsk_aaaaaaaaaaaaaaaaaaaaaaaa");
    km.registerKey("groq", "k2", "gsk_bbbbbbbbbbbbbbbbbbbbbbbb");
    m.attachKeyManager(km);
    const out = await m.executeStructured(
      { capability: "json_structured_output", preferOwnModel: false },
      { messages: [{ role: "user", content: "x" }] },
      (text) => {
        try {
          return { ok: true as const, value: JSON.parse(text) as { ok: boolean } };
        } catch {
          return { ok: false as const, error: "bad" };
        }
      },
    );
    assert.equal(out.selectedProvider, "groq");
    assert.equal(out.validation, "valid");
    assert.equal(groq.n, 4);
    assert.equal(km.records("groq").find((k) => k.keyId === "k1")?.status, "COOLDOWN");
    assert.equal(km.records("groq").find((k) => k.keyId === "k2")?.status, "ACTIVE");
  });

  it("G: preserves structured failure reason (not only NO_ELIGIBLE_PROVIDER)", async () => {
    const m = new ProviderManager(own);
    m.setOwnCapabilities(["chat"]);
    m.registerSpecialist(
      {
        id: "groq",
        name: "Groq",
        type: "groq",
        enabled: true,
        priority: 10,
        capabilities: ["json_structured_output"],
      },
      new FakeAdapter("groq", "Groq", { content: "not-json-at-all" }),
    );
    const parse = () => ({ ok: false as const, error: "not valid JSON after fence normalization" });
    const out = await m.executeStructured(
      { capability: "json_structured_output", preferOwnModel: false, excludeProviders: ["gemini", "cerebras"] },
      { messages: [{ role: "user", content: "test" }] },
      parse,
      { maxAttempts: 1 },
    );
    assert.equal(out.validation, "failed");
    assert.equal(out.failureKind, "INVALID_STRUCTURED_OUTPUT");
  });

  it("Cerebras 402 is PAYMENT_REQUIRED and excluded without repeated retry", async () => {
    const m = new ProviderManager(own);
    m.setOwnCapabilities(["chat"]);
    m.registerSpecialist(
      {
        id: "cerebras",
        name: "Cerebras",
        type: "cerebras",
        enabled: true,
        priority: 30,
        capabilities: ["json_structured_output", "coding"],
      },
      new FakeAdapter("cerebras", "Cerebras", {
        failGenerate: true,
        failMessage:
          'Model API error 402: {"message":"Payment required","type":"payment_required_error","code":"payment_required"}',
      }),
    );
    const out = await m.executeStructured(
      { capability: "json_structured_output", preferOwnModel: false, excludeProviders: ["groq", "gemini"] },
      { messages: [{ role: "user", content: "x" }] },
      () => ({ ok: true as const, value: { ok: true } }),
      { maxAttempts: 3 },
    );
    assert.equal(out.validation, "failed");
    assert.equal(out.failureKind, "PAYMENT_REQUIRED");
    assert.ok(out.waitingForProvider?.reason?.includes("payment_required"));
    assert.deepEqual(out.attempted, ["cerebras"]);
  });
});
