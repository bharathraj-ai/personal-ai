import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RecoveryManager } from "./recovery.js";
import { BudgetManager } from "./budget.js";
import { type Task, TaskState } from "@personal-ai/shared";

describe("RecoveryEngine", () => {
  it("recovers from transient failure", async () => {
    const manager = new RecoveryManager(new BudgetManager({ maxRetries: 3, maxExecutionTimeMs: 1000, maxPlanningSteps: 10 }));
    const task = { error: "" } as Task;
    const state = await manager.attemptRecovery(task, "Network timeout error", 0);
    assert.equal(state, TaskState.RETRYING);
  });

  it("eventually fails permanently", async () => {
    const manager = new RecoveryManager(new BudgetManager({ maxRetries: 3, maxExecutionTimeMs: 1000, maxPlanningSteps: 10 }));
    const task = { error: "" } as Task;
    let state = await manager.attemptRecovery(task, "Test failed", 0);
    assert.equal(state, TaskState.RETRYING);
    state = await manager.attemptRecovery(task, "Test failed", 1);
    assert.equal(state, TaskState.RETRYING);
    state = await manager.attemptRecovery(task, "Test failed", 2);
    assert.equal(state, TaskState.RETRYING);
    state = await manager.attemptRecovery(task, "Test failed", 3);
    assert.equal(state, TaskState.FAILED); // budget exceeded
  });

  it("fails immediately on irrecoverable error", async () => {
    const manager = new RecoveryManager(new BudgetManager({ maxRetries: 3, maxExecutionTimeMs: 1000, maxPlanningSteps: 10 }));
    const task = { error: "" } as Task;
    const state = await manager.attemptRecovery(task, "Permission denied", 0);
    assert.equal(state, TaskState.FAILED);
  });

  it("triggers loop protection on identical failure", async () => {
    const manager = new RecoveryManager(new BudgetManager({ maxRetries: 5, maxExecutionTimeMs: 1000, maxPlanningSteps: 10 }));
    const task = { error: "Network timeout" } as Task;
    const state = await manager.attemptRecovery(task, "Network timeout", 3);
    assert.equal(state, TaskState.FAILED);
    assert.match(task.error!, /Loop protection triggered/);
  });
});
