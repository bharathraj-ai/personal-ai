import { Agent, Task, AgentContext, Plan, PlanStep, AgentResult, VerificationResult } from "@personal-ai/shared";
import { ConnectorManager } from "@personal-ai/connectors";

export class EmailAgent implements Agent {
  id = "agent-email";
  name = "Email Agent";
  description = "Handles email reading, searching, classifying, drafting, and sending.";
  capabilities = ["email:read", "email:write"];

  constructor(private connectors: ConnectorManager) {}

  async canHandle(task: Task): Promise<boolean> {
    const goal = task.goal.toLowerCase();
    return goal.includes("email") || goal.includes("inbox") || goal.includes("reply") || goal.includes("draft a reply");
  }

  async plan(context: AgentContext): Promise<Plan> {
    const goal = context.task.goal.toLowerCase();
    const steps: PlanStep[] = [];

    if (goal.includes("read") || goal.includes("check") || goal.includes("attention")) {
      steps.push({ id: "s1", toolName: "read_email", description: "Read emails", successCriteria: "Read emails" });
      steps.push({ id: "s2", toolName: "classify_email", description: "Classify emails", successCriteria: "Classify emails" });
    }

    if (goal.includes("draft a reply") || goal.includes("draft")) {
      if (steps.length === 0) {
        steps.push({ id: "s1", toolName: "read_email", description: "Read original email", successCriteria: "Read email" });
      }
      steps.push({ id: "s3", toolName: "draft_email", description: "Draft response", successCriteria: "Draft created" });
      // Important: DRAFT goes to WAITING_FOR_APPROVAL
    }

    if (goal.includes("send")) {
      steps.push({ id: "s4", toolName: "send_email", description: "Send email", successCriteria: "Email sent" });
    }

    return { goal: context.task.goal, steps };
  }

  async execute(context: AgentContext, step: PlanStep): Promise<AgentResult> {
    const userId = context.task.userId;
    
    switch (step.toolName) {
      case "read_email": {
        const resp = await this.connectors.execute(userId, "email", { action: "READ_EMAIL" });
        return { success: resp.success, output: resp.result, error: resp.error };
      }
      case "classify_email": {
        const resp = await this.connectors.execute(userId, "email", { action: "CLASSIFY_EMAIL" });
        return { success: resp.success, output: resp.result, error: resp.error };
      }
      case "draft_email": {
        const resp = await this.connectors.execute(userId, "email", { action: "DRAFT_EMAIL" });
        // Drafting might need approval before sending, but drafting itself is low risk.
        return { success: resp.success, output: resp.result, error: resp.error };
      }
      case "send_email": {
        // Assume context contains approval if it was approved
        const payload = (context.task.result as any)?._approved ? { _approved: true } : {};
        const resp = await this.connectors.execute(userId, "email", { action: "SEND_EMAIL", payload });
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
