import { type AgentContext, type AgentResult, type VerificationResult } from "@personal-ai/shared";
import type { ProviderManager } from "@personal-ai/providers";

export class TaskVerifier {
  constructor(private providerManager: ProviderManager) {}

  async verifyResult(context: AgentContext, result: AgentResult): Promise<VerificationResult> {
    const checks = [];
    let passed = true;
    let failureReason = "";

    // Level 1: Execution verification
    checks.push({ name: "Execution Success", passed: result.success });
    if (!result.success) {
      passed = false;
      failureReason = result.error || "Execution failed";
    }

    // Level 2: Tool output verification
    if (passed && result.output === undefined) {
      checks.push({ name: "Tool Output Present", passed: false, details: "No output returned" });
    } else if (passed) {
      checks.push({ name: "Tool Output Present", passed: true });
    }

    // Level 5: Requirement Verification via LLM
    if (passed) {
      const prompt = `Goal: ${context.task.goal}
Task Type: ${context.task.type}
Tool Output: ${JSON.stringify(result.output)}

Determine if the output satisfies the goal. Answer ONLY with a JSON object: {"satisfied": boolean, "reason": "string"}`;
      
      const llmCheck = await this.providerManager.executeStructured<{ satisfied: boolean; reason: string }>(
        { capability: "verification" },
        { messages: [{ role: "system", content: prompt }], responseFormat: "json_object" },
        (text: string) => {
          try {
            return { ok: true, value: JSON.parse(text) };
          } catch (e: any) {
            return { ok: false, error: e.message };
          }
        }
      );

      const isSatisfied = llmCheck.parsed?.satisfied ?? false;
      checks.push({ name: "Requirement Verification", passed: isSatisfied, details: llmCheck.parsed?.reason });
      
      if (!isSatisfied) {
        passed = false;
        failureReason = llmCheck.parsed?.reason || "LLM determined goal was not satisfied";
      }
    }

    return {
      passed,
      criteria: "Multi-level verification including LLM requirement check",
      status: passed ? "verified" : "failed",
      evidence: [],
      checks,
      reason: passed ? "All required verification levels passed." : failureReason,
      confidence: passed ? 1.0 : 0.0,
    };
  }
}
