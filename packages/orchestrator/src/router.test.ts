import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentRouter, AgentRegistry } from "./router.js";
import { type Task, TaskClassification, type Agent, type AgentContext, type Plan, type AgentResult, type VerificationResult } from "@personal-ai/shared";

class MockAgent implements Agent {
  constructor(public id: string, public name: string, public description: string, public capabilities: string[]) {}
  async canHandle(task: Task) { return this.capabilities.includes(task.type.toLowerCase()); }
  async plan(_context: AgentContext): Promise<Plan> { return { goal: "", steps: [] }; }
  async execute(_context: AgentContext, _step: any): Promise<AgentResult> { return { success: true, output: null }; }
  async verify(_context: AgentContext, _result: AgentResult): Promise<VerificationResult> { return { passed: true, checks: [], criteria: "", status: "verified", evidence: [], reason: "" }; }
}

describe("AgentRouter", () => {
  it("routes coding request to Coding Agent", async () => {
    const registry = new AgentRegistry();
    registry.register(new MockAgent("agent-1", "Coding Agent", "Writes code", ["coding"]));
    const router = new AgentRouter(registry);
    const task = { type: TaskClassification.CODING } as Task;
    const result = await router.route(task);
    assert.equal(result.agent?.name, "Coding Agent");
  });

  it("routes research request to Research Agent", async () => {
    const registry = new AgentRegistry();
    registry.register(new MockAgent("agent-1", "Coding Agent", "Writes code", ["coding"]));
    registry.register(new MockAgent("agent-2", "Research Agent", "Does research", ["research"]));
    const router = new AgentRouter(registry);
    const task = { type: TaskClassification.RESEARCH } as Task;
    const result = await router.route(task);
    assert.equal(result.agent?.name, "Research Agent");
  });

  it("routes unknown request to core orchestrator", async () => {
    const registry = new AgentRegistry();
    registry.register(new MockAgent("agent-1", "Coding Agent", "Writes code", ["coding"]));
    const router = new AgentRouter(registry);
    const task = { type: TaskClassification.MULTI_STEP } as Task;
    const result = await router.route(task);
    assert.equal(result.agent, undefined);
  });
});
