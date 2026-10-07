import { type Task, type Observation, TaskState } from "@personal-ai/shared";
import type { DatabaseClient } from "@personal-ai/db";

export class TaskManager {
  constructor(private db: DatabaseClient) {}

  async createTask(task: Task): Promise<void> {
    await this.db.query(
      `INSERT INTO personal_ai.tasks (
        id, user_id, project_id, workspace_id, type, goal, status, priority, risk_level, current_step, plan, result, error, created_at, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        task.id,
        task.userId,
        task.context?.projectId || null,
        task.context?.workspaceId || null,
        task.type || "unknown",
        task.goal,
        task.status || TaskState.PENDING,
        task.priority || null,
        task.riskLevel || null,
        task.currentStep || null,
        task.plan ? JSON.stringify(task.plan) : null,
        task.result ? JSON.stringify(task.result) : null,
        task.error || null,
        task.createdAt || new Date(),
        task.startedAt || null,
        task.completedAt || null
      ]
    );
  }

  async getTask(id: string): Promise<Task | undefined> {
    const res = await this.db.query(
      `SELECT id, user_id as "userId", project_id as "projectId", workspace_id as "workspaceId", type, goal, status, priority, risk_level as "riskLevel", current_step as "currentStep", plan, result, error, created_at as "createdAt", started_at as "startedAt", completed_at as "completedAt"
       FROM personal_ai.tasks WHERE id = $1`,
      [id]
    );
    if (res.rows.length === 0) return undefined;
    const row = res.rows[0];
    
    return this.mapRowToTask(row);
  }

  private mapRowToTask(row: any): Task {
    return {
      id: row.id,
      userId: row.userId,
      type: row.type as any,
      goal: row.goal,
      status: row.status as TaskState,
      priority: row.priority,
      riskLevel: row.riskLevel,
      currentStep: row.currentStep,
      plan: row.plan ? (typeof row.plan === "string" ? JSON.parse(row.plan) : row.plan) : undefined,
      result: row.result ? (typeof row.result === "string" ? JSON.parse(row.result) : row.result) : undefined,
      error: row.error,
      createdAt: new Date(row.createdAt),
      startedAt: row.startedAt ? new Date(row.startedAt) : undefined,
      completedAt: row.completedAt ? new Date(row.completedAt) : undefined,
      context: {
        userId: row.userId,
        sessionId: "default",
        projectId: row.projectId,
        workspaceId: row.workspaceId
      }
    };
  }

  async updateTask(task: Task): Promise<void> {
    await this.db.query(
      `UPDATE personal_ai.tasks SET 
        status = $1, current_step = $2, plan = $3, result = $4, error = $5, started_at = $6, completed_at = $7
       WHERE id = $8`,
      [
        task.status,
        task.currentStep || null,
        task.plan ? JSON.stringify(task.plan) : null,
        task.result ? JSON.stringify(task.result) : null,
        task.error || null,
        task.startedAt || null,
        task.completedAt || null,
        task.id
      ]
    );
  }

  async recordObservation(observation: Observation): Promise<void> {
    await this.db.query(
      `INSERT INTO personal_ai.observations (
        id, task_id, step_id, type, status, output, error, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        observation.id,
        observation.taskId,
        observation.stepId || null,
        observation.type,
        observation.status,
        observation.output ? JSON.stringify(observation.output) : null,
        observation.error || null,
        observation.metadata ? JSON.stringify(observation.metadata) : null,
        observation.timestamp || new Date()
      ]
    );
  }

  async listTasks(filters: { userId: string }): Promise<Task[]> {
    const res = await this.db.query<any>(
      `SELECT id, user_id as "userId", project_id as "projectId", workspace_id as "workspaceId", type, goal, status, priority, risk_level as "riskLevel", current_step as "currentStep", plan, result, error, created_at as "createdAt", started_at as "startedAt", completed_at as "completedAt" 
       FROM personal_ai.tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [filters.userId]
    );
    return res.rows.map(row => this.mapRowToTask(row));
  }

  async listObservations(taskId: string): Promise<Observation[]> {
    const res = await this.db.query<any>(
      `SELECT * FROM personal_ai.observations WHERE task_id = $1 ORDER BY created_at ASC`,
      [taskId]
    );
    return res.rows.map(row => ({
      id: row.id,
      taskId: row.task_id,
      stepId: row.step_id || undefined,
      type: row.type,
      status: row.status,
      output: row.output ? (typeof row.output === "string" ? JSON.parse(row.output) : row.output) : undefined,
      error: row.error || undefined,
      metadata: row.metadata ? (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata) : undefined,
      timestamp: row.created_at
    }));
  }
}
