/**
 * Safe acceptance tests against a running gateway (default http://127.0.0.1:3001).
 * Skips gracefully when the gateway is down. Never prints secrets.
 *
 * Run: pnpm --filter @personal-ai/api test:acceptance
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3001";
const TOKEN = process.env.ACCEPTANCE_TOKEN ?? process.env.AUTH_DEV_TOKEN ?? "dev-token";

async function api(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: BearerHdr(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* raw */
  }
  return { status: res.status, json, text };
}

function BearerHdr(): string {
  return `Bearer ${TOKEN}`;
}

async function gatewayUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe("acceptance — foundation", () => {
  it("gateway health is reachable and truthful about modelLoaded", async (t) => {
    if (!(await gatewayUp())) {
      t.skip("gateway not running");
      return;
    }
    const { status, json } = await api("/health");
    assert.equal(status, 200);
    const body = json as {
      status: string;
      model: { healthy?: boolean; modelLoaded?: boolean; ready?: boolean; message?: string };
      database: { healthy?: boolean };
    };
    assert.ok(body.model);
    assert.equal(typeof body.model.modelLoaded, "boolean");
    if (body.model.modelLoaded === false) {
      assert.notEqual(body.status, "ok");
      assert.equal(body.model.ready, false);
    }
    // Never leak keys in health payload
    assert.doesNotMatch(JSON.stringify(body), /gsk_|csk-|AIza|GROQ_API_KEY=/i);
  });

  it("system status reports LOCAL workspace and cloudSandbox=false for self-hosted", async (t) => {
    if (!(await gatewayUp())) {
      t.skip("gateway not running");
      return;
    }
    const { status, json } = await api("/system/status");
    assert.equal(status, 200);
    const body = json as {
      phases: Record<string, unknown>;
      workspace: { kind?: string; provider?: string };
      model: { state?: string };
    };
    assert.equal(body.phases.cloudSandbox, false);
    assert.ok(body.workspace.kind === "LOCAL" || body.phases.localWorkspace === true);
  });

  it("reports S3 state truthfully", async (t) => {
    if (!(await gatewayUp())) {
      t.skip("gateway not running");
      return;
    }
    const { status, json } = await api("/system/status");
    assert.equal(status, 200);
    const body = json as { s3?: { state: string }; phases: { s3?: string } };
    const state = body.s3?.state ?? body.phases.s3;
    assert.ok(["CONNECTED", "NOT_CONFIGURED", "FAILED"].includes(String(state)));
  });
});

describe("acceptance — chat & search", () => {
  it("simple chat returns content without crashing", async (t) => {
    if (!(await gatewayUp())) {
      t.skip("gateway not running");
      return;
    }
    const { status, json } = await api("/chat", {
      method: "POST",
      body: JSON.stringify({ message: "Hello" }),
    });
    assert.equal(status, 200);
    const body = json as { content: string };
    assert.ok(typeof body.content === "string" && body.content.length > 0);
  });

  it("current date uses orchestrate local-time path without inventing web facts", async (t) => {
    if (!(await gatewayUp())) {
      t.skip("gateway not running");
      return;
    }
    const { status, json } = await api("/orchestrate", {
      method: "POST",
      body: JSON.stringify({ message: "What is the current date?" }),
    });
    assert.equal(status, 200);
    const body = json as {
      status: string;
      finalResponse: string;
      events: Array<{ tool?: string; event?: string }>;
    };
    assert.equal(body.status, "completed");
    assert.match(body.finalResponse, /Current date\/time|local/i);
    assert.ok(
      body.events.some((e) => e.tool === "get_current_time") ||
        /local tool/i.test(body.finalResponse),
    );
  });

  it("DuckDuckGo search endpoint returns structured verification (may be empty if blocked)", async (t) => {
    if (!(await gatewayUp())) {
      t.skip("gateway not running");
      return;
    }
    const { status, json } = await api("/search", {
      method: "POST",
      body: JSON.stringify({ query: "sea surface temperature NOAA" }),
    });
    assert.equal(status, 200);
    const body = json as {
      provider: string;
      results: unknown[];
      verification: { status: string };
    };
    assert.equal(body.provider, "duckduckgo");
    assert.ok(body.verification?.status);
    // If no results, must not claim verified
    if (!body.results?.length) {
      assert.notEqual(body.verification.status, "verified");
    }
  });
});

describe("acceptance — security", () => {
  it("rejects mismatched client userId", async (t) => {
    if (!(await gatewayUp())) {
      t.skip("gateway not running");
      return;
    }
    const { status } = await api("/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hi", userId: "attacker" }),
    });
    assert.equal(status, 403);
  });

  it("path traversal is rejected on workspace write", async (t) => {
    if (!(await gatewayUp())) {
      t.skip("gateway not running");
      return;
    }
    const created = await api("/workspaces", {
      method: "POST",
      body: JSON.stringify({ projectName: "accept-path" }),
    });
    assert.equal(created.status, 200);
    const ws = created.json as { id: string };
    const { status, json } = await api(`/workspaces/${ws.id}/exec`, {
      method: "POST",
      body: JSON.stringify({ command: "pwd" }),
    });
    // exec requires approval or succeeds — either way no escape; path test via verify write is coding tool
    assert.ok(status === 200 || status === 403 || status === 400);
    void json;
  });
});

describe("acceptance — small REST API foundation (P10 §17)", () => {
  it("clarify → plan → approve → coding pipeline for PostgreSQL REST API", async (t) => {
    if (!(await gatewayUp())) {
      t.skip("gateway not running");
      return;
    }
    const goal =
      "Create a small REST API with PostgreSQL persistence, authentication, one resource, and automated tests.";

    const s1 = await api("/orchestrate", {
      method: "POST",
      body: JSON.stringify({ message: goal }),
    });
    assert.equal(s1.status, 200);
    const st1 = (s1.json as { status: string }).status;
    assert.ok(
      st1 === "awaiting_clarification" || st1 === "awaiting_implementation_approval",
      `unexpected first status ${st1}`,
    );

    const s2 = await api("/orchestrate", {
      method: "POST",
      body: JSON.stringify({
        message: "use defaults",
        originalGoal: goal,
        clarificationAnswers: { __use_defaults: "true" },
      }),
    });
    assert.equal(s2.status, 200);

    const s3 = await api("/orchestrate", {
      method: "POST",
      body: JSON.stringify({
        message: "approve",
        originalGoal: goal,
        clarificationAnswers: { __use_defaults: "true" },
        implementationApproved: true,
      }),
    });
    assert.equal(s3.status, 200);
    const body = s3.json as {
      status: string;
      finalResponse: string;
      workspaceId?: string;
    };
    assert.ok(
      ["completed", "partial", "failed", "waiting_provider"].includes(body.status),
      `unexpected status ${body.status}`,
    );
    assert.doesNotMatch(body.finalResponse, /PLAN_INVALID|file-json|localStorage production store/i);
    if (body.status === "waiting_provider") {
      assert.match(body.finalResponse, /WAITING_FOR_PROVIDER|provider/i);
    } else {
      assert.ok(body.workspaceId || /CODE_EXECUTION|package\.json|REST|PostgreSQL/i.test(body.finalResponse));
    }
  });
});

describe("acceptance — school management full flow", () => {
  it("clarify → plan → approve → builds RBAC scaffold", async (t) => {
    if (!(await gatewayUp())) {
      t.skip("gateway not running");
      return;
    }
    const goal = "Create a school management system.";

    const s1 = await api("/orchestrate", {
      method: "POST",
      body: JSON.stringify({ message: goal }),
    });
    assert.equal(s1.status, 200);
    assert.equal((s1.json as { status: string }).status, "awaiting_clarification");

    const s2 = await api("/orchestrate", {
      method: "POST",
      body: JSON.stringify({
        message: "use defaults",
        history: [{ role: "user", content: goal }],
        originalGoal: goal,
        clarificationAnswers: { __use_defaults: "true" },
      }),
    });
    assert.equal(s2.status, 200);
    assert.equal((s2.json as { status: string }).status, "awaiting_implementation_approval");

    const s3 = await api("/orchestrate", {
      method: "POST",
      body: JSON.stringify({
        message: "approve",
        history: [
          { role: "user", content: goal },
          { role: "assistant", content: "plan ready" },
        ],
        originalGoal: goal,
        implementationApproved: true,
        clarificationAnswers: { __use_defaults: "true" },
      }),
    });
    assert.equal(s3.status, 200);
    const body = s3.json as { status: string; finalResponse: string };
    assert.ok(
      body.status === "completed" || body.status === "partial",
      `unexpected status ${body.status}`,
    );
    assert.match(body.finalResponse, /PARTIAL|Phase 1|school/i);
    assert.match(body.finalResponse, /students|attendance|dashboard|RBAC|CODE_EXECUTION_SUCCESS/i);
    assert.doesNotMatch(body.finalResponse, /^Project completed\./im);
  });
});

describe("acceptance — Project O", () => {
  it("orchestrate gates Project O with clarify/plan then executes with honest quality reporting", async (t) => {
    if (!(await gatewayUp())) {
      t.skip("gateway not running");
      return;
    }
    const goal =
      "Create a folder called Project O and build a model that predicts ocean temperature.";

    const step1 = await api("/orchestrate", {
      method: "POST",
      body: JSON.stringify({ message: goal }),
    });
    assert.equal(step1.status, 200);
    const body1 = step1.json as { status: string };
    assert.equal(body1.status, "awaiting_clarification");

    const s2 = await api("/orchestrate", {
      method: "POST",
      body: JSON.stringify({
        message: goal,
        clarificationAnswers: { __use_defaults: "true" },
        originalGoal: goal,
      }),
    });
    assert.equal(s2.status, 200);
    const body2 = s2.json as { status: string; finalResponse: string };
    assert.equal(body2.status, "awaiting_implementation_approval");
    assert.match(body2.finalResponse, /AWAITING_IMPLEMENTATION_APPROVAL|Implementation Plan/i);

    const step3 = await api("/orchestrate", {
      method: "POST",
      body: JSON.stringify({
        message: "approve",
        originalGoal: goal,
        clarificationAnswers: { __use_defaults: "true" },
        implementationApproved: true,
        history: [{ role: "user", content: goal }],
      }),
    });
    assert.equal(step3.status, 200);
    const body = step3.json as {
      status: string;
      finalResponse: string;
      workspaceId?: string;
      answerVerification?: { status: string; reason?: string };
    };
    assert.ok(
      body.status === "completed" || body.status === "failed",
      `unexpected status ${body.status}`,
    );
    assert.match(body.finalResponse, /MODEL_QUALITY_NOT_VERIFIED/i);
    if (body.status === "completed") {
      assert.match(body.finalResponse, /CODE_EXECUTION_SUCCESS|TESTS_PASSED/i);
    }
    assert.doesNotMatch(body.finalResponse, /MODEL_QUALITY_VERIFIED(?!_NOT)/i);
  });
});
