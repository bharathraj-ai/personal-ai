import { type Task, TaskState } from "@personal-ai/shared";
import type { BudgetManager } from "./budget.js";

export enum FailureCategory {
  TRANSIENT = "TRANSIENT",
  NETWORK = "NETWORK",
  TIMEOUT = "TIMEOUT",
  PROVIDER = "PROVIDER",
  TOOL = "TOOL",
  VALIDATION = "VALIDATION",
  BUILD = "BUILD",
  TEST = "TEST",
  PERMISSION = "PERMISSION",
  PLANNING = "PLANNING",
  UNKNOWN = "UNKNOWN",
}

export class RecoveryManager {
  constructor(private budget: BudgetManager) {}

  async attemptRecovery(task: Task, error: string, attemptCount: number): Promise<TaskState> {
    const category = this.classifyError(error);
    
    // Loop protection
    if (attemptCount >= 3 && task.error === error) {
      task.error = `Loop protection triggered: Repeated identical failure (${category}).`;
      return TaskState.FAILED;
    }

    if (!this.canRecover(category)) {
      task.error = `Irrecoverable failure: ${category} - ${error}`;
      return TaskState.FAILED;
    }

    if (!this.budget.checkRetryBudget(attemptCount)) {
      task.error = `Retry budget exceeded. Last error: ${error}`;
      return TaskState.FAILED;
    }

    task.error = error; // Record previous error to track loop
    return TaskState.RETRYING;
  }

  private classifyError(error: string): FailureCategory {
    const lower = error.toLowerCase();
    if (lower.includes("timeout") || lower.includes("timed out")) return FailureCategory.TIMEOUT;
    if (lower.includes("network") || lower.includes("econnrefused")) return FailureCategory.NETWORK;
    if (lower.includes("provider") || lower.includes("llm") || lower.includes("rate limit") || lower.includes("429")) return FailureCategory.PROVIDER;
    if (lower.includes("permission denied") || lower.includes("unauthorized")) return FailureCategory.PERMISSION;
    if (lower.includes("validation") || lower.includes("schema") || lower.includes("invalid input")) return FailureCategory.VALIDATION;
    if (lower.includes("build failed") || lower.includes("tsc")) return FailureCategory.BUILD;
    if (lower.includes("test failed") || lower.includes("jest")) return FailureCategory.TEST;
    if (lower.includes("tool execution") || lower.includes("failed to execute")) return FailureCategory.TOOL;
    if (lower.includes("plan") || lower.includes("invalid steps")) return FailureCategory.PLANNING;
    if (lower.includes("transient")) return FailureCategory.TRANSIENT;

    return FailureCategory.UNKNOWN;
  }

  private canRecover(category: FailureCategory): boolean {
    switch (category) {
      case FailureCategory.NETWORK:
      case FailureCategory.TIMEOUT:
      case FailureCategory.PROVIDER:
      case FailureCategory.TRANSIENT:
      case FailureCategory.BUILD:
      case FailureCategory.TEST:
      case FailureCategory.TOOL:
      case FailureCategory.PLANNING:
        return true;
      
      case FailureCategory.PERMISSION:
      case FailureCategory.VALIDATION:
      case FailureCategory.UNKNOWN:
        return false;
    }
  }
}
