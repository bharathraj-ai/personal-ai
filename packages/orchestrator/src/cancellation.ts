import { type Task, TaskState } from "@personal-ai/shared";
import type { TaskStateMachine } from "./state-machine.js";

export class CancellationManager {
  private controllers = new Map<string, AbortController>();

  constructor(private stateMachine: TaskStateMachine) {}

  getSignal(taskId: string): AbortSignal {
    if (!this.controllers.has(taskId)) {
      this.controllers.set(taskId, new AbortController());
    }
    return this.controllers.get(taskId)!.signal;
  }

  async cancelTask(task: Task, reason: string): Promise<void> {
    if (task.status !== TaskState.COMPLETED && task.status !== TaskState.FAILED && task.status !== TaskState.CANCELLED) {
      task.error = reason;
      await this.stateMachine.transition(task, TaskState.CANCELLED);
      
      const controller = this.controllers.get(task.id);
      if (controller) {
        controller.abort(reason);
        this.controllers.delete(task.id);
      }
    }
  }

  cleanup(taskId: string): void {
    this.controllers.delete(taskId);
  }
}
