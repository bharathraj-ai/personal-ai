import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TaskVerifier } from "./verifier.js";
import type { ProviderManager, ProviderSelectRequest, ProviderExecuteResult, StructuredExecuteResult, ProviderSelection } from "@personal-ai/providers";
import { type AgentContext, type AgentResult, type Task } from "@personal-ai/shared";

class StubProviderManager {
  async selectFor(_request: ProviderSelectRequest): Promise<ProviderSelection> { throw new Error("Method not implemented."); }
  async execute(_request: ProviderSelectRequest, _options: any): Promise<ProviderExecuteResult> { throw new Error("Method not implemented."); }
  
  async executeStructured<T>(_request: ProviderSelectRequest, options: any, parse: (text: string) => { ok: boolean; value?: T; error?: string }): Promise<StructuredExecuteResult<T>> {
    const text = options.messages[0].content.includes("False success")
      ? '{"satisfied": false, "reason": "Output does not meet requirements"}'
      : '{"satisfied": true, "reason": "Looks good"}';
      
    const parsed = parse(text);
    return {
      parsed: parsed.ok ? (parsed.value as T) : undefined,
      validation: parsed.ok ? "valid" : "invalid",
      attemptCount: 1,
      selectedProvider: "stub",
      selection: { status: "selected", providerId: "stub", reason: "" } as unknown as ProviderSelection,
      attempted: [],
      fallbackUsed: false
    };
  }
}

describe("TaskVerifier", () => {
  it("fails verification if tool execution failed", async () => {
    const verifier = new TaskVerifier(new StubProviderManager() as unknown as ProviderManager);
    const result = await verifier.verifyResult({ task: {} as Task } as AgentContext, { success: false, error: "Command failed" } as AgentResult);
    assert.equal(result.passed, false);
    assert.equal(result.checks.find(c => c.name === "Execution Success")?.passed, false);
  });

  it("handles false success correctly (tool passes but requirement fails)", async () => {
    const verifier = new TaskVerifier(new StubProviderManager() as unknown as ProviderManager);
    const result = await verifier.verifyResult(
      { task: { goal: "False success" } as Task } as AgentContext, 
      { success: true, output: "Success!" } as AgentResult
    );
    assert.equal(result.passed, false);
    assert.equal(result.checks.find(c => c.name === "Requirement Verification")?.passed, false);
  });

  it("passes verification if tool passes and requirement met", async () => {
    const verifier = new TaskVerifier(new StubProviderManager() as unknown as ProviderManager);
    const result = await verifier.verifyResult(
      { task: { goal: "Real success" } as Task } as AgentContext, 
      { success: true, output: "Success!" } as AgentResult
    );
    assert.equal(result.passed, true);
    assert.equal(result.checks.find(c => c.name === "Requirement Verification")?.passed, true);
  });
});
