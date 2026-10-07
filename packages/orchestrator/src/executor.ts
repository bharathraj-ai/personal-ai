import { type PlanStep, type AgentContext, type AgentResult } from "@personal-ai/shared";
import type { ToolRegistry } from "@personal-ai/tools";
import type { ProviderManager } from "@personal-ai/providers";

export class TaskExecutor {
  constructor(private registry: ToolRegistry, private providerManager: ProviderManager) {}

  async executeStep(context: AgentContext, step: PlanStep): Promise<AgentResult> {
    if (step.toolName) {
      try {
        const result = await this.registry.execute(step.toolName, step.toolArgs || {});
        return {
          success: result.success,
          output: result.output,
          error: result.error,
        };
      } catch (err: any) {
        return { success: false, output: null, error: err.message };
      }
    }
    
    // Use LLM to execute generic step if no specific tool is mapped
    const prompt = `Execute the following step for the task "${context.task.goal}":
Step: ${step.description}
Success Criteria: ${step.successCriteria}

Provide your complete response or solution.`;

    const response = await this.providerManager.executeStructured<{ result: string }>(
      { capability: "generation" },
      { messages: [{ role: "system", content: prompt }], responseFormat: "json_object" },
      (text: string) => {
        try {
          return { ok: true, value: JSON.parse(text) };
        } catch {
          return { ok: true, value: { result: text } };
        }
      }
    );

    if (response.error) {
      return { success: false, output: null, error: response.error };
    }

    return { success: true, output: response.parsed?.result || response.result?.content };
  }
}
