import { type Plan, type AgentContext } from "@personal-ai/shared";
import type { ProviderManager } from "@personal-ai/providers";

export class TaskPlanner {
  constructor(private providerManager: ProviderManager) {}

  async createPlan(context: AgentContext): Promise<Plan> {
    const prompt = `You are a planner. Your task is to plan the following goal: ${context.task.goal}.
Available tools:
${context.availableTools.map(t => `- ${t.name}: ${t.description}`).join("\n")}

Respond with a JSON object containing a "goal", a "reasoning" string, and a "steps" array.
Each step should have "id", "description", "toolName", "toolArgs", and "successCriteria".
`;

    const result = await this.providerManager.executeStructured<Plan>(
      { capability: "planning" },
      { messages: [{ role: "system", content: prompt }], responseFormat: "json_object" },
      (text: string) => {
        try {
          const obj = JSON.parse(text);
          if (!obj.goal || !Array.isArray(obj.steps)) {
            return { ok: false, error: "Invalid plan format" };
          }
          return { ok: true, value: obj as Plan };
        } catch (e: any) {
          return { ok: false, error: e.message };
        }
      }
    );

    if (result.error || !result.parsed) {
      throw new Error(`Failed to generate plan: ${result.error || "No result"}`);
    }

    return result.parsed;
  }

  async validatePlan(plan: Plan): Promise<boolean> {
    if (!plan || !plan.steps) return false;
    if (plan.steps.length === 0) return false;
    for (const step of plan.steps) {
      if (!step.id || !step.description || !step.successCriteria) {
        return false;
      }
    }
    return true;
  }
}
