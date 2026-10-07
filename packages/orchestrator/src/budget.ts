

export interface BudgetConfig {
  maxRetries: number;
  maxExecutionTimeMs: number;
  maxPlanningSteps: number;
}

export class BudgetManager {
  constructor(private config: BudgetConfig) {}

  checkRetryBudget(attemptCount: number): boolean {
    return attemptCount < this.config.maxRetries;
  }

  checkTimeBudget(startTime: Date): boolean {
    const elapsed = Date.now() - startTime.getTime();
    return elapsed < this.config.maxExecutionTimeMs;
  }
}
