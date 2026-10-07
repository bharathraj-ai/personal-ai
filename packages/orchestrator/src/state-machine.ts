import { TaskState, type Task } from "@personal-ai/shared";
import type { TaskManager } from "./task-manager.js";

export class TaskStateMachine {
  constructor(private taskManager: TaskManager) {}

  private allowedTransitions: Record<TaskState, TaskState[]> = {
    [TaskState.PENDING]: [TaskState.ANALYZING, TaskState.CANCELLED, TaskState.FAILED],
    [TaskState.ANALYZING]: [TaskState.PLANNING, TaskState.EXECUTING, TaskState.CANCELLED, TaskState.FAILED],
    [TaskState.PLANNING]: [TaskState.WAITING_FOR_APPROVAL, TaskState.EXECUTING, TaskState.CANCELLED, TaskState.FAILED],
    [TaskState.WAITING_FOR_APPROVAL]: [TaskState.EXECUTING, TaskState.CANCELLED, TaskState.FAILED],
    [TaskState.EXECUTING]: [TaskState.VERIFYING, TaskState.FAILED, TaskState.CANCELLED, TaskState.WAITING_FOR_APPROVAL],
    [TaskState.VERIFYING]: [TaskState.COMPLETED, TaskState.FAILED, TaskState.RETRYING, TaskState.CANCELLED],
    [TaskState.RETRYING]: [TaskState.EXECUTING, TaskState.FAILED, TaskState.CANCELLED],
    [TaskState.COMPLETED]: [],
    [TaskState.FAILED]: [TaskState.RETRYING],
    [TaskState.CANCELLED]: [],
  };

  canTransition(current: TaskState, next: TaskState): boolean {
    return this.allowedTransitions[current]?.includes(next) ?? false;
  }

  async transition(task: Task, nextState: TaskState): Promise<void> {
    const oldState = task.status;
    if (!this.canTransition(oldState, nextState)) {
      throw new Error(`Invalid task state transition from ${oldState} to ${nextState}`);
    }

    if (nextState === TaskState.EXECUTING && !task.startedAt) {
      task.startedAt = new Date();
    }
    if (nextState === TaskState.COMPLETED || nextState === TaskState.FAILED || nextState === TaskState.CANCELLED) {
      task.completedAt = new Date();
    }

    task.status = nextState;
    await this.taskManager.updateTask(task);
  }
}
