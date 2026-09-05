import type { DatabaseClient } from "@personal-ai/db";
import type { CompletenessReport, ProjectPlan, ProjectStatus, RequestScale } from "@personal-ai/shared";

export interface ProjectPlanRecord {
  id: string;
  userId: string;
  projectId?: string | null;
  taskId?: string | null;
  workspaceId?: string | null;
  classification: RequestScale;
  projectStatus: ProjectStatus;
  plan: ProjectPlan;
  requirements: unknown;
  milestones: unknown;
  verificationState: CompletenessReport | Record<string, unknown>;
  storageRefs: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectPlanStore {
  save(input: {
    userId: string;
    projectId?: string;
    taskId?: string;
    workspaceId?: string;
    classification: RequestScale;
    projectStatus: ProjectStatus;
    plan: ProjectPlan;
    completeness?: CompletenessReport;
    storageRefs?: string[];
  }): Promise<void>;
  getLatest(opts: {
    userId: string;
    projectId?: string;
    workspaceId?: string;
  }): Promise<ProjectPlanRecord | null>;
}

export class InMemoryProjectPlanStore implements ProjectPlanStore {
  readonly records: ProjectPlanRecord[] = [];
  async save(input: Parameters<ProjectPlanStore["save"]>[0]): Promise<void> {
    this.records.push({
      id: crypto.randomUUID(),
      userId: input.userId,
      projectId: input.projectId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      classification: input.classification,
      projectStatus: input.projectStatus,
      plan: input.plan,
      requirements: input.plan.requirements,
      milestones: input.plan.milestones,
      verificationState: input.completeness ?? {},
      storageRefs: input.storageRefs ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async getLatest(opts: {
    userId: string;
    projectId?: string;
    workspaceId?: string;
  }): Promise<ProjectPlanRecord | null> {
    const matches = this.records.filter((r) => {
      if (r.userId !== opts.userId) return false;
      if (opts.projectId) {
        return r.projectId === opts.projectId || r.taskId === opts.projectId;
      }
      if (opts.workspaceId) return r.workspaceId === opts.workspaceId;
      return true;
    });
    matches.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return matches[0] ?? null;
  }
}

export class PostgresProjectPlanStore implements ProjectPlanStore {
  constructor(private readonly db: DatabaseClient) {}

  async save(input: Parameters<ProjectPlanStore["save"]>[0]): Promise<void> {
    await this.db.query(
      `INSERT INTO personal_ai.project_plans
        (user_id, project_id, task_id, workspace_id, classification, project_status,
         plan, requirements, milestones, verification_state, storage_refs)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb)`,
      [
        input.userId,
        input.projectId ?? null,
        input.taskId ?? null,
        input.workspaceId ?? null,
        input.classification,
        input.projectStatus,
        JSON.stringify(input.plan),
        JSON.stringify(input.plan.requirements ?? []),
        JSON.stringify(input.plan.milestones ?? []),
        JSON.stringify(input.completeness ?? {}),
        JSON.stringify(input.storageRefs ?? []),
      ],
    );
  }

  async getLatest(opts: {
    userId: string;
    projectId?: string;
    workspaceId?: string;
  }): Promise<ProjectPlanRecord | null> {
    const result = await this.db.query<{
      id: string;
      user_id: string;
      project_id: string | null;
      task_id: string | null;
      workspace_id: string | null;
      classification: RequestScale;
      project_status: ProjectStatus;
      plan: ProjectPlan;
      requirements: unknown;
      milestones: unknown;
      verification_state: CompletenessReport | Record<string, unknown>;
      storage_refs: string[];
      created_at: Date;
      updated_at: Date;
    }>(
      opts.projectId
        ? `SELECT id, user_id, project_id, task_id, workspace_id, classification, project_status,
                  plan, requirements, milestones, verification_state, storage_refs,
                  created_at, updated_at
             FROM personal_ai.project_plans
            WHERE user_id = $1 AND (project_id = $2 OR task_id = $2)
            ORDER BY updated_at DESC
            LIMIT 1`
        : opts.workspaceId
          ? `SELECT id, user_id, project_id, task_id, workspace_id, classification, project_status,
                    plan, requirements, milestones, verification_state, storage_refs,
                    created_at, updated_at
               FROM personal_ai.project_plans
              WHERE user_id = $1 AND workspace_id = $2
              ORDER BY updated_at DESC
              LIMIT 1`
          : `SELECT id, user_id, project_id, task_id, workspace_id, classification, project_status,
                    plan, requirements, milestones, verification_state, storage_refs,
                    created_at, updated_at
               FROM personal_ai.project_plans
              WHERE user_id = $1
              ORDER BY updated_at DESC
              LIMIT 1`,
      opts.projectId
        ? [opts.userId, opts.projectId]
        : opts.workspaceId
          ? [opts.userId, opts.workspaceId]
          : [opts.userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      projectId: row.project_id,
      taskId: row.task_id,
      workspaceId: row.workspace_id,
      classification: row.classification,
      projectStatus: row.project_status,
      plan: row.plan,
      requirements: row.requirements,
      milestones: row.milestones,
      verificationState: row.verification_state,
      storageRefs: row.storage_refs ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
