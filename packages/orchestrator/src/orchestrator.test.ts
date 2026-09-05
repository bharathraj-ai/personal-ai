import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ModelAdapter } from "@personal-ai/ai-core";
import type {
  GenerateOptions,
  GenerateResult,
  HealthStatus,
  Message,
  StreamChunk,
  ToolDefinition,
  ToolResult,
} from "@personal-ai/shared";
import { ToolPermissionLevel } from "@personal-ai/shared";
import { Orchestrator } from "./orchestrator.js";
import { schoolManagementProjectPlan } from "./project-plan.js";
import type { ToolRegistry } from "@personal-ai/tools";

class StubModel implements ModelAdapter {
  id = "bharath-stub";
  name = "Bharath Stub";
  constructor(private readonly planJson: string, private readonly answer = "Done.") {}
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const last = options.messages.at(-1)?.content ?? "";
    if (/Goal:/.test(last) && /Available tools:/.test(last)) {
      return { content: this.planJson, finishReason: "stop" };
    }
    return { content: this.answer, finishReason: "stop" };
  }
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: "text", content: this.answer };
    yield { type: "done" };
  }
  async healthCheck(): Promise<HealthStatus> {
    return { healthy: true, latencyMs: 1 };
  }
  async getUsage() {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
}

function stubTools(handlers: Record<string, () => Promise<ToolResult>>): ToolRegistry {
  const defs: ToolDefinition[] = Object.keys(handlers).map((name) => ({
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    permissionLevel: ToolPermissionLevel.READ,
  }));
  return {
    listDefinitions: () => defs,
    get: (name: string) =>
      handlers[name]
        ? {
            definition: defs.find((d) => d.name === name)!,
            execute: async () => handlers[name]!(),
          }
        : undefined,
    execute: async (name: string) => {
      const h = handlers[name];
      if (!h) return { success: false, output: null, error: `unknown ${name}` };
      return h();
    },
  } as unknown as ToolRegistry;
}

describe("Orchestrator COMPLETE ordering", () => {
  it("emits COMPLETE / TASK_COMPLETED only after final verification", async () => {
    const phases: string[] = [];
    const events: string[] = [];
    const model = new StubModel(
      JSON.stringify({
        reasoning: "local time",
        steps: [
          {
            id: "t1",
            description: "get time",
            toolName: "get_current_time",
            successCriteria: "time",
          },
        ],
      }),
      "The local clock answered.",
    );

    const orch = new Orchestrator(
      {
        model,
        tools: stubTools({
          get_current_time: async () => ({
            success: true,
            output: { iso: "2026-08-27T12:00:00Z", timezone: "UTC" },
          }),
        }),
        onPhaseChange: (p) => phases.push(p),
        onEvent: (e) => {
          if (e.event) events.push(e.event);
          events.push(`${e.phase}:${e.status}`);
        },
      },
      { maxRetries: 1 },
    );

    const result = await orch.run({
      goal: "What is the current date?",
      context: { userId: "u1", sessionId: "s1" },
      history: [] as Message[],
    });

    const completeIdx = phases.lastIndexOf("complete" as never);
    // OrchestratorPhase.COMPLETE value
    const completePhaseIdx = phases.findIndex((p) => String(p).toLowerCase().includes("complete"));
    const verifyIdx = phases.findIndex((p) => String(p).toLowerCase().includes("verify"));
    assert.ok(verifyIdx >= 0);
    assert.ok(completePhaseIdx > verifyIdx || events.includes("TASK_COMPLETED"));
    assert.ok(events.includes("VERIFICATION_STARTED") || events.some((e) => e.includes("VERIFY")));
    assert.ok(result.answerVerification);
    assert.ok(result.events.some((e) => e.event === "TASK_COMPLETED" || e.phase === "complete"));
    void completeIdx;
  });

  it("does not route greetings through specialists", async () => {
    let specialistCalled = false;
    const fakePm = {
      selectFor: async () => {
        specialistCalled = true;
        return {
          status: "selected",
          providerId: "groq",
          adapter: new StubModel("{}"),
          reason: "should not run",
          capability: "coding",
          attempted: [],
        };
      },
      executeWithFallback: async () => {
        specialistCalled = true;
        return {
          selection: {
            status: "selected",
            providerId: "groq",
            adapter: new StubModel("{}"),
            reason: "x",
            capability: "coding",
            attempted: [],
          },
          fallbackUsed: false,
          attempted: [],
        };
      },
    };

    const orch = new Orchestrator(
      {
        model: new StubModel(
          JSON.stringify({
            reasoning: "hi",
            steps: [{ id: "1", description: "greet", successCriteria: "ok" }],
          }),
          "Hello!",
        ),
        tools: stubTools({}),
        providerManager: fakePm as never,
      },
      { maxRetries: 0 },
    );

    await orch.run({ goal: "Hello", context: { userId: "u1", sessionId: "s1" } });
    assert.equal(specialistCalled, false);
  });

  it("routes FULL_APPLICATION through CodingAgent instead of school templates", async () => {
    let implementCalled = false;
    const orch = new Orchestrator(
      {
        model: new StubModel(
          JSON.stringify({ reasoning: "plan", steps: [] }),
          "ok",
        ),
        tools: stubTools({
          create_workspace: async () => ({
            success: true,
            output: { workspaceId: "ws-agent" },
          }),
          list_files: async () => ({ success: true, output: { files: ["package.json", "app/page.tsx"] } }),
        }),
        codingAgent: {
          async implement() {
            implementCalled = true;
            return {
              success: true,
              summary: "agent wrote files",
              filesCreated: [
                "package.json",
                "app/page.tsx",
                "app/students/page.tsx",
                "app/api/students/route.ts",
                "lib/db.ts",
                "tests/students.test.ts",
              ],
              verification: {
                passed: false,
                steps: [],
                report: { status: "NOT_VERIFIED", build: "PASSED", tests: "FAILED", security: "NOT_IMPLEMENTED" },
              },
            };
          },
        },
      },
      { maxRetries: 0 },
    );

    const result = await orch.run({
      goal: "Create a complete school management system.",
      context: {
        userId: "u1",
        sessionId: "s1",
        implementationApproved: true,
        clarificationAnswers: { __use_defaults: "true" },
      },
    });

    assert.equal(implementCalled, true);
    assert.match(result.finalResponse, /CodingAgent/);
    assert.notEqual(result.projectStatus, "COMPLETE");
  });

  it("resume does not ask CodingAgent to regenerate completed modules", async () => {
    let seenCompleted: string[] | undefined;
    const orch = new Orchestrator(
      {
        model: new StubModel(JSON.stringify({ reasoning: "plan", steps: [] }), "ok"),
        tools: stubTools({}),
        getStoredProject: async () => {
          const plan = schoolManagementProjectPlan(1);
          plan.implementationProgress = {
            completedModuleIds: ["MODULE-AUTH", "MODULE-ROLES"],
            failedModuleIds: [],
            partialModuleIds: [],
            providersUsed: ["groq"],
            attemptCount: 1,
            lifecycleState: "IMPLEMENTING",
            architectureConstraints: {
              database: "postgresql",
              authentication: "session",
              roles: ["ADMIN", "TEACHER", "STUDENT"],
              storage: "storage-service",
            },
            approvedPlan: {
              approvalId: "test-approval",
              approvedAt: new Date().toISOString(),
              plan,
              requirements: plan.requirements,
              constraints: {
                database: "postgresql",
                authentication: "session",
                roles: ["ADMIN", "TEACHER", "STUDENT"],
                storage: "storage-service",
              },
            },
          };
          return { workspaceId: "ws-school", projectId: "p1", plan };
        },
        codingAgent: {
          async implement(input) {
            seenCompleted = input.completedModuleIds;
            return {
              success: false,
              summary: "waiting",
              filesCreated: ["src/auth.js"],
              moduleProgress: [{ id: "STUDENT", name: "STUDENT", status: "waiting", files: [] }],
              waitingForProvider: { reason: "groq rate limited" },
              verification: {
                passed: false,
                steps: [],
                report: { status: "NOT_VERIFIED", tests: "NO_TESTS" },
              },
            };
          },
        },
      },
      { maxRetries: 0 },
    );

    const result = await orch.run({
      goal: "continue my school management project",
      context: { userId: "u1", sessionId: "s1" },
    });

    assert.deepEqual(seenCompleted, ["MODULE-AUTH", "MODULE-ROLES"]);
    assert.equal(result.projectStatus, "WAITING_FOR_PROVIDER");
    assert.equal(result.status, "waiting_provider");
  });

  it("resume uses triggerMessage when goal was resolved from session", async () => {
    let implementCalled = false;
    const orch = new Orchestrator(
      {
        model: new StubModel(JSON.stringify({ reasoning: "plan", steps: [] }), "ok"),
        tools: stubTools({}),
        getStoredProject: async () => {
          const plan = schoolManagementProjectPlan(1);
          plan.implementationProgress = {
            completedModuleIds: [],
            failedModuleIds: [],
            partialModuleIds: [],
            providersUsed: [],
            attemptCount: 1,
            lifecycleState: "PARTIAL",
            approvedPlan: {
              approvalId: "test-approval",
              approvedAt: new Date().toISOString(),
              plan,
              requirements: plan.requirements,
              constraints: {
                database: "postgresql",
                authentication: "session",
                roles: ["ADMIN", "TEACHER", "STUDENT"],
                storage: "storage-service",
              },
            },
          };
          return { workspaceId: "ws-rest", projectId: "p-rest", plan };
        },
        codingAgent: {
          async implement() {
            implementCalled = true;
            return {
              success: false,
              summary: "partial",
              filesCreated: ["app.py"],
              verification: {
                passed: false,
                steps: [],
                report: { status: "NOT_VERIFIED", tests: "NO_TESTS", build: "FAILED" },
              },
            };
          },
        },
      },
      { maxRetries: 0 },
    );

    const result = await orch.run({
      goal: "Create a small REST API with one endpoint and a real automated test.",
      triggerMessage: "Continue my project.",
      context: { userId: "u1", sessionId: "s1", projectId: "p-rest" },
    });

    assert.equal(implementCalled, true);
    assert.notEqual(result.status, "awaiting_implementation_approval");
    assert.notEqual(result.status, "awaiting_clarification");
  });

  it("resume succeeds without Bharath when approved plan is persisted", async () => {
    let modelCalls = 0;
    let implementCalled = false;
    class DownBharath implements ModelAdapter {
      id = "bharath-ai";
      name = "Bharath";
      async generate(): Promise<GenerateResult> {
        modelCalls += 1;
        throw new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:8000");
      }
      async *stream(): AsyncIterable<StreamChunk> {
        yield { type: "done" };
      }
      async healthCheck(): Promise<HealthStatus> {
        return { healthy: false, latencyMs: 0 };
      }
      async getUsage() {
        return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      }
    }

    const orch = new Orchestrator(
      {
        model: new DownBharath(),
        tools: stubTools({}),
        getStoredProject: async () => {
          const plan = schoolManagementProjectPlan(1);
          plan.goal = "Build school management system";
          plan.implementationProgress = {
            completedModuleIds: ["MODULE-AUTH"],
            failedModuleIds: [],
            partialModuleIds: [],
            providersUsed: ["groq"],
            attemptCount: 1,
            lifecycleState: "WAITING_FOR_PROVIDER",
            architectureConstraints: {
              database: "postgresql",
              authentication: "session",
              roles: ["ADMIN", "TEACHER", "STUDENT"],
              storage: "storage-service",
            },
            approvedPlan: {
              approvalId: "appr-resume",
              approvedAt: new Date().toISOString(),
              plan,
              requirements: plan.requirements,
              constraints: {
                database: "postgresql",
                authentication: "session",
                roles: ["ADMIN", "TEACHER", "STUDENT"],
                storage: "storage-service",
              },
            },
          };
          return { workspaceId: "ws-resume", projectId: "p-resume", plan };
        },
        codingAgent: {
          async implement(input) {
            implementCalled = true;
            assert.deepEqual(input.completedModuleIds, ["MODULE-AUTH"]);
            return {
              success: false,
              summary: "waiting",
              waitingForProvider: { reason: "groq rate limited" },
              verification: {
                passed: false,
                steps: [],
                report: { status: "NOT_VERIFIED", tests: "NO_TESTS" },
              },
            };
          },
        },
      },
      { maxRetries: 0 },
    );

    const result = await orch.run({
      goal: "Continue my project.",
      triggerMessage: "Continue my project.",
      context: { userId: "u1", sessionId: "s1", projectId: "p-resume" },
    });

    assert.equal(modelCalls, 0, "Bharath must not be called during resume");
    assert.equal(implementCalled, true);
    assert.equal(result.status, "waiting_provider");
    assert.match(result.finalResponse ?? "", /Resume|WAITING_FOR_PROVIDER|Modules/i);
  });

  it("resume returns RESUME_NOT_FOUND without calling Bharath when project missing", async () => {
    let modelCalls = 0;
    class DownBharath implements ModelAdapter {
      id = "bharath-ai";
      name = "Bharath";
      async generate(): Promise<GenerateResult> {
        modelCalls += 1;
        throw new Error("ECONNREFUSED");
      }
      async *stream(): AsyncIterable<StreamChunk> {
        yield { type: "done" };
      }
      async healthCheck(): Promise<HealthStatus> {
        return { healthy: false, latencyMs: 0 };
      }
      async getUsage() {
        return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      }
    }

    const orch = new Orchestrator(
      {
        model: new DownBharath(),
        tools: stubTools({}),
        getStoredProject: async () => null,
      },
      { maxRetries: 0 },
    );

    const result = await orch.run({
      goal: "Continue my project.",
      triggerMessage: "Continue my project.",
      context: { userId: "u1", sessionId: "s1", projectId: "missing" },
    });

    assert.equal(modelCalls, 0);
    assert.equal(result.status, "failed");
    assert.match(result.finalResponse ?? "", /RESUME_NOT_FOUND/);
  });
});
