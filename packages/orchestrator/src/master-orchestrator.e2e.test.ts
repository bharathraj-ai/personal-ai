import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MasterOrchestrator } from "./master-orchestrator.js";
import type { DatabaseClient, DatabaseHealth } from "@personal-ai/db";
import type { ToolRegistry } from "@personal-ai/tools";
import type { ProviderManager, ProviderSelectRequest, ProviderExecuteResult, StructuredExecuteResult, ProviderSelection } from "@personal-ai/providers";
import type { AuditLogService, AuditEntry } from "@personal-ai/audit";
import { type Task, type UserContext, TaskClassification, TaskState, ToolPermissionLevel, type ToolDefinition, type ToolResult } from "@personal-ai/shared";

class StubDB {
  async query(_text: string, _params?: unknown[]) { return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] } as any; }
  async healthCheck(): Promise<DatabaseHealth> { return { healthy: true, pgvector: false }; }
  async healthCheckLite(): Promise<DatabaseHealth> { return { healthy: true, pgvector: false }; }
  async getLatency(): Promise<number> { return 1; }
  async connect(): Promise<any> { return {} as any; }
}

class StubAudit {
  async record(_entry: Omit<AuditEntry, "id" | "createdAt">): Promise<AuditEntry> { return {} as any; }
  async list(): Promise<AuditEntry[]> { return []; }
}

class StubRegistry {
  async execute(name: string, _args: any): Promise<ToolResult> {
    if (name === "fail") return { success: false, output: null, error: "Forced failure" };
    return { success: true, output: "Success" };
  }
  get(_name: string): any { return {}; }
  listDefinitions(): ToolDefinition[] { return []; }
  async healthCheck() { return { healthy: true }; }
}

class StubProviderManager {
  async selectFor(): Promise<ProviderSelection> { return { status: "selected", providerId: "stub", reason: "" } as unknown as ProviderSelection; }
  async execute(): Promise<ProviderExecuteResult> { return { selection: { status: "selected", providerId: "stub", reason: "" } as unknown as ProviderSelection, attempted: [], fallbackUsed: false }; }
  async executeStructured<T>(req: ProviderSelectRequest, opts: any, parse: any): Promise<StructuredExecuteResult<T>> {
    let json = '{"satisfied": true, "reason": "ok"}';
    if (req.capability === "planning") {
      json = '{"goal": "test", "steps": [{"id": "1", "description": "step 1", "toolName": "success", "successCriteria": "done"}]}';
      if (opts.messages[0].content.includes("fail_tool")) {
        json = '{"goal": "test", "steps": [{"id": "1", "description": "step 1", "toolName": "fail", "successCriteria": "done"}]}';
      }
    }
    const parsed = parse(json);
    return {
      parsed: parsed.ok ? parsed.value : undefined,
      validation: "valid",
      attemptCount: 1,
      selectedProvider: "stub",
      selection: { status: "selected", providerId: "stub", reason: "" } as unknown as ProviderSelection,
      attempted: [],
      fallbackUsed: false
    };
  }
}

describe("MasterOrchestrator E2E", () => {
  it("Simple E2E Happy Path", async () => {
    const orchestrator = new MasterOrchestrator(new StubRegistry() as unknown as ToolRegistry, { maxRetries: 3, maxExecutionTimeMs: 1000, maxPlanningSteps: 10 }, new StubDB() as unknown as DatabaseClient, new StubProviderManager() as unknown as ProviderManager, new StubAudit() as unknown as AuditLogService);
    const task: Task = {
      id: "t1", userId: "u1", type: TaskClassification.MULTI_STEP, goal: "test", status: TaskState.PENDING,
      priority: "MEDIUM", riskLevel: ToolPermissionLevel.READ, context: {} as UserContext, createdAt: new Date()
    };
    const result = await orchestrator.orchestrate(task);
    if (result.status !== "completed") console.error("E2E failed with error:", task.error);
    assert.equal(result.status, "completed");
  });

  it("Permanent Failure Path (loop protection)", async () => {
    const orchestrator = new MasterOrchestrator(new StubRegistry() as unknown as ToolRegistry, { maxRetries: 3, maxExecutionTimeMs: 1000, maxPlanningSteps: 10 }, new StubDB() as unknown as DatabaseClient, new StubProviderManager() as unknown as ProviderManager, new StubAudit() as unknown as AuditLogService);
    const task: Task = {
      id: "t2", userId: "u1", type: TaskClassification.MULTI_STEP, goal: "fail_tool", status: TaskState.PENDING,
      priority: "MEDIUM", riskLevel: ToolPermissionLevel.READ, context: {} as UserContext, createdAt: new Date()
    };
    const result = await orchestrator.orchestrate(task);
    assert.equal(result.status, "failed");
  });
});
