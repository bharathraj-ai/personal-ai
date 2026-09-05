import type { DatabaseClient } from "@personal-ai/db";
import {
  sanitizeAuditDetail,
  type AuditEntry,
  type AuditEventName,
  type AuditLogService,
} from "./types.js";

export class InMemoryAuditLogService implements AuditLogService {
  private readonly entries: AuditEntry[] = [];

  async record(entry: Omit<AuditEntry, "id" | "createdAt">): Promise<AuditEntry> {
    const row: AuditEntry = {
      ...entry,
      id: crypto.randomUUID(),
      detail: sanitizeAuditDetail(entry.detail),
      createdAt: new Date(),
    };
    this.entries.push(row);
    return row;
  }

  async list(opts: {
    userId: string;
    projectId?: string;
    taskId?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const limit = opts.limit ?? 100;
    return this.entries
      .filter((e) => {
        if (e.userId !== opts.userId) return false;
        if (opts.projectId && e.projectId !== opts.projectId) return false;
        if (opts.taskId && e.taskId !== opts.taskId) return false;
        return true;
      })
      .slice(-limit)
      .reverse();
  }
}

export class PostgresAuditLogService implements AuditLogService {
  constructor(private readonly db: DatabaseClient) {}

  async record(entry: Omit<AuditEntry, "id" | "createdAt">): Promise<AuditEntry> {
    const detail = sanitizeAuditDetail(entry.detail);
    const result = await this.db.query<{
      id: string;
      created_at: Date;
    }>(
      `INSERT INTO personal_ai.audit_logs (user_id, project_id, task_id, event, detail)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [
        entry.userId,
        entry.projectId ?? null,
        entry.taskId ?? null,
        entry.event,
        JSON.stringify(detail),
      ],
    );
    const row = result.rows[0]!;
    return {
      id: row.id,
      userId: entry.userId,
      projectId: entry.projectId,
      taskId: entry.taskId,
      event: entry.event,
      detail,
      createdAt: row.created_at,
    };
  }

  async list(opts: {
    userId: string;
    projectId?: string;
    taskId?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const limit = Math.min(opts.limit ?? 100, 500);
    const clauses = ["user_id = $1"];
    const params: unknown[] = [opts.userId];
    if (opts.projectId) {
      params.push(opts.projectId);
      clauses.push(`project_id = $${params.length}`);
    }
    if (opts.taskId) {
      params.push(opts.taskId);
      clauses.push(`task_id = $${params.length}`);
    }
    params.push(limit);
    const result = await this.db.query<{
      id: string;
      user_id: string;
      project_id: string | null;
      task_id: string | null;
      event: AuditEventName;
      detail: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT id, user_id, project_id, task_id, event, detail, created_at
       FROM personal_ai.audit_logs
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      projectId: r.project_id ?? undefined,
      taskId: r.task_id ?? undefined,
      event: r.event,
      detail: r.detail ?? {},
      createdAt: r.created_at,
    }));
  }
}
