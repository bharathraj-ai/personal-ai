import { Agent, Task, AgentContext, Plan, PlanStep, AgentResult, VerificationResult } from "@personal-ai/shared";
import { ConnectorManager } from "@personal-ai/connectors";

export class CalendarAgent implements Agent {
  id = "agent-calendar";
  name = "Calendar Agent";
  description = "Handles calendar events and scheduling.";
  capabilities = ["calendar:read", "calendar:write"];

  constructor(private connectors: ConnectorManager) {}

  async canHandle(task: Task): Promise<boolean> {
    const goal = task.goal.toLowerCase();
    return goal.includes("calendar") || goal.includes("event") || goal.includes("schedule") || goal.includes("free time") || goal.includes("interview");
  }

  async plan(context: AgentContext): Promise<Plan> {
    const goal = context.task.goal.toLowerCase();
    const steps: PlanStep[] = [];

    if (goal.includes("read") || goal.includes("what's on my calendar") || goal.includes("interview")) {
      steps.push({ id: "s1", toolName: "read_calendar", description: "Read calendar", successCriteria: "Read calendar" });
    }

    if (goal.includes("create") || goal.includes("schedule")) {
      steps.push({ id: "s2", toolName: "create_event", description: "Create event", successCriteria: "Event created" });
    }

    if (steps.length === 0) {
      steps.push({ id: "s1", toolName: "read_calendar", description: "Read calendar", successCriteria: "Read calendar" });
    }

    return { goal: context.task.goal, steps };
  }

  async execute(context: AgentContext, step: PlanStep): Promise<AgentResult> {
    const userId = context.task.userId;
    
    switch (step.toolName) {
      case "read_calendar": {
        const resp = await this.connectors.execute(userId, "calendar", { action: "READ_CALENDAR" });
        return { success: resp.success, output: resp.result, error: resp.error };
      }
      case "create_event": {
        const payload = (context.task.result as any)?._approved ? { _approved: true } : {};
        const resp = await this.connectors.execute(userId, "calendar", { action: "CREATE_EVENT", payload });
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
