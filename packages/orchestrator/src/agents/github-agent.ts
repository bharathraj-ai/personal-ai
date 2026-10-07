import { Agent, Task, AgentContext, Plan, PlanStep, AgentResult, VerificationResult } from "@personal-ai/shared";
import { ConnectorManager } from "@personal-ai/connectors";

export class GitHubAgent implements Agent {
  id = "agent-github";
  name = "GitHub Agent";
  description = "Handles GitHub repositories, issues, and PRs.";
  capabilities = ["github:read", "github:write"];

  constructor(private connectors: ConnectorManager) {}

  async canHandle(task: Task): Promise<boolean> {
    const goal = task.goal.toLowerCase();
    return goal.includes("github") || goal.includes("repository") || goal.includes("pull request") || goal.includes("commit");
  }

  async plan(context: AgentContext): Promise<Plan> {
    const goal = context.task.goal.toLowerCase();
    const steps: PlanStep[] = [];

    if (goal.includes("read") || goal.includes("check") || goal.includes("what")) {
      steps.push({ id: "s1", toolName: "read_repository", description: "Read repository", successCriteria: "Read repository" });
    }

    if (goal.includes("fix") || goal.includes("commit") || goal.includes("pr")) {
      if (steps.length === 0) {
        steps.push({ id: "s1", toolName: "read_repository", description: "Read repository", successCriteria: "Read repository" });
      }
      steps.push({ id: "s2", toolName: "create_branch", description: "Create branch", successCriteria: "Branch created" });
      steps.push({ id: "s3", toolName: "commit", description: "Commit changes", successCriteria: "Changes committed" });
      steps.push({ id: "s4", toolName: "push", description: "Push branch", successCriteria: "Branch pushed" });
      if (goal.includes("pr") || goal.includes("pull request")) {
        steps.push({ id: "s5", toolName: "create_pr", description: "Create PR", successCriteria: "PR created" });
      }
    }

    return { goal: context.task.goal, steps };
  }

  async execute(context: AgentContext, step: PlanStep): Promise<AgentResult> {
    const userId = context.task.userId;
    const payload = (context.task.result as any)?._approved ? { _approved: true } : {};
    
    switch (step.toolName) {
      case "read_repository": {
        const resp = await this.connectors.execute(userId, "github", { action: "READ_REPOSITORY" });
        return { success: resp.success, output: resp.result, error: resp.error };
      }
      case "create_branch": {
        const resp = await this.connectors.execute(userId, "github", { action: "CREATE_BRANCH", payload });
        return { success: resp.success, output: resp.result, error: resp.error };
      }
      case "commit": {
        const resp = await this.connectors.execute(userId, "github", { action: "COMMIT", payload });
        return { success: resp.success, output: resp.result, error: resp.error };
      }
      case "push": {
        const resp = await this.connectors.execute(userId, "github", { action: "PUSH", payload });
        return { success: resp.success, output: resp.result, error: resp.error };
      }
      case "create_pr": {
        const resp = await this.connectors.execute(userId, "github", { action: "CREATE_PR", payload });
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
