import { type ApprovalRequest, type Task, TaskState } from "@personal-ai/shared";
import type { TaskStateMachine } from "./state-machine.js";
import type { DatabaseClient } from "@personal-ai/db";

export class ApprovalManager {
  constructor(private stateMachine: TaskStateMachine, private db: DatabaseClient) {}

  async requestApproval(task: Task, request: ApprovalRequest): Promise<void> {
    await this.stateMachine.transition(task, TaskState.WAITING_FOR_APPROVAL);
    
    // Persist approval request
    await this.db.query(
      `INSERT INTO personal_ai.task_approvals (
        id, task_id, status, requested_at
      ) VALUES ($1, $2, $3, $4)`,
      [request.id, task.id, "PENDING", request.requestedAt]
    );
  }

  async handleApprovalResponse(task: Task, approvalId: string, approved: boolean): Promise<void> {
    const status = approved ? "APPROVED" : "REJECTED";
    
    await this.db.query(
      `UPDATE personal_ai.task_approvals SET status = $1, responded_at = NOW() WHERE id = $2 AND task_id = $3`,
      [status, approvalId, task.id]
    );

    if (approved) {
      await this.stateMachine.transition(task, TaskState.EXECUTING);
    } else {
      task.error = "Task rejected by user during approval";
      await this.stateMachine.transition(task, TaskState.CANCELLED);
    }
  }
}
