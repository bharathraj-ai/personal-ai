import { Agent, Task, AgentContext, Plan, PlanStep, AgentResult, VerificationResult } from "@personal-ai/shared";
import { ConnectorManager } from "@personal-ai/connectors";

export class OpportunityAgent implements Agent {
  id = "agent-opportunity";
  name = "Opportunity Agent";
  description = "Discovers and prepares applications for hackathons and opportunities.";
  capabilities = ["opportunity:read", "opportunity:write"];

  constructor(private connectors: ConnectorManager) {}

  async canHandle(task: Task): Promise<boolean> {
    const goal = task.goal.toLowerCase();
    return goal.includes("hackathon") || goal.includes("opportunity") || goal.includes("apply");
  }

  async plan(context: AgentContext): Promise<Plan> {
    const goal = context.task.goal.toLowerCase();
    const steps: PlanStep[] = [];

    if (goal.includes("find") || goal.includes("discover") || goal.includes("suitable")) {
      steps.push({ id: "s1", toolName: "discover", description: "Discover opportunities", successCriteria: "Discovered" });
      steps.push({ id: "s2", toolName: "analyze", description: "Match with profile", successCriteria: "Matched" });
    }

    if (goal.includes("apply")) {
      if (steps.length === 0) {
        steps.push({ id: "s1", toolName: "analyze", description: "Analyze opportunity", successCriteria: "Analyzed" });
      }
      steps.push({ id: "s3", toolName: "prepare", description: "Prepare application", successCriteria: "Prepared" });
      steps.push({ id: "s4", toolName: "submit", description: "Submit application", successCriteria: "Submitted" });
    }

    return { goal: context.task.goal, steps };
  }

  async execute(context: AgentContext, step: PlanStep): Promise<AgentResult> {
    const userId = context.task.userId;
    
    switch (step.toolName) {
      case "discover": {
        const resp = await this.connectors.execute(userId, "opportunity", { action: "DISCOVER" });
        return { success: resp.success, output: resp.result, error: resp.error };
      }
      case "analyze":
      case "prepare": {
        const resp = await this.connectors.execute(userId, "opportunity", { action: "PREPARE" });
        return { success: resp.success, output: resp.result, error: resp.error };
      }
      case "submit": {
        const payload = (context.task.result as any)?._approved ? { _approved: true } : {};
        const resp = await this.connectors.execute(userId, "opportunity", { action: "SUBMIT", payload });
        return { success: resp.success, output: resp.result, error: resp.error };
      }
      default:
        return { success: false, output: null, error: `Unknown step type: ${step.toolName}` };
    }
  }

  async verify(_context: AgentContext, result: AgentResult): Promise<VerificationResult> {
    return { 
      passed: result.success, 
      reason: result.success ? "Success" : result.error || "Unknown error",
      criteria: "Execution succeeded",
      status: result.success ? "verified" : "failed",
      evidence: [],
      checks: []
    };
  }
}
