import type { DatabaseClient } from "@personal-ai/db";
import { ensureUser } from "@personal-ai/db";

export interface ProjectRecord {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  workspaceId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectService {
  create(input: {
    userId: string;
    name: string;
    description?: string;
    workspaceId?: string;
  }): Promise<ProjectRecord>;
  list(userId: string): Promise<ProjectRecord[]>;
  get(userId: string, projectId: string): Promise<ProjectRecord | null>;
  update(
    userId: string,
    projectId: string,
    patch: { name?: string; description?: string; workspaceId?: string | null },
  ): Promise<ProjectRecord | null>;
  delete(userId: string, projectId: string): Promise<boolean>;
}

export class PostgresProjectService implements ProjectService {
  constructor(private readonly db: DatabaseClient) {}

  async create(input: {
    userId: string;
    name: string;
    description?: string;
    workspaceId?: string;
  }): Promise<ProjectRecord> {
    const user = await ensureUser(this.db, input.userId);
    const result = await this.db.query(
      `INSERT INTO projects (user_id, name, description, workspace_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, name, description, workspace_id, created_at, updated_at`,
      [user.id, input.name, input.description ?? null, input.workspaceId ?? null],
    );
    return mapProject(result.rows[0] as Parameters<typeof mapProject>[0]);
  }

  async list(userId: string): Promise<ProjectRecord[]> {
    const user = await ensureUser(this.db, userId);
    const result = await this.db.query(
      `SELECT * FROM projects WHERE user_id = $1 ORDER BY updated_at DESC`,
      [user.id],
    );
    return result.rows.map((r) => mapProject(r as Parameters<typeof mapProject>[0]));
  }

  async get(userId: string, projectId: string): Promise<ProjectRecord | null> {
    const user = await ensureUser(this.db, userId);
    const result = await this.db.query(
      `SELECT * FROM projects WHERE id = $1 AND user_id = $2`,
      [projectId, user.id],
    );
    return result.rows[0] ? mapProject(result.rows[0] as Parameters<typeof mapProject>[0]) : null;
  }

  async update(
    userId: string,
    projectId: string,
    patch: { name?: string; description?: string; workspaceId?: string | null },
  ): Promise<ProjectRecord | null> {
    const user = await ensureUser(this.db, userId);
    const result = await this.db.query(
      `UPDATE projects SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         workspace_id = COALESCE($3, workspace_id),
         updated_at = NOW()
       WHERE id = $4 AND user_id = $5
       RETURNING *`,
      [
        patch.name ?? null,
        patch.description ?? null,
        patch.workspaceId === undefined ? null : patch.workspaceId,
        projectId,
        user.id,
      ],
    );
    return result.rows[0] ? mapProject(result.rows[0] as Parameters<typeof mapProject>[0]) : null;
  }

  async delete(userId: string, projectId: string): Promise<boolean> {
    const user = await ensureUser(this.db, userId);
    const result = await this.db.query(`DELETE FROM projects WHERE id = $1 AND user_id = $2`, [
      projectId,
      user.id,
    ]);
    return (result.rowCount ?? 0) > 0;
  }
}

export class InMemoryProjectService implements ProjectService {
  private projects: ProjectRecord[] = [];

  async create(input: {
    userId: string;
    name: string;
    description?: string;
    workspaceId?: string;
  }) {
    const record: ProjectRecord = {
      id: crypto.randomUUID(),
      userId: input.userId,
      name: input.name,
      description: input.description,
      workspaceId: input.workspaceId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.projects.push(record);
    return record;
  }

  async list(userId: string) {
    return this.projects.filter((p) => p.userId === userId);
  }

  async get(userId: string, projectId: string) {
    return this.projects.find((p) => p.userId === userId && p.id === projectId) ?? null;
  }

  async update(
    userId: string,
    projectId: string,
    patch: { name?: string; description?: string; workspaceId?: string | null },
  ) {
    const p = await this.get(userId, projectId);
    if (!p) return null;
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.description !== undefined) p.description = patch.description;
    if (patch.workspaceId !== undefined) p.workspaceId = patch.workspaceId;
    p.updatedAt = new Date();
    return p;
  }

  async delete(userId: string, projectId: string) {
    const before = this.projects.length;
    this.projects = this.projects.filter((p) => !(p.userId === userId && p.id === projectId));
    return this.projects.length < before;
  }
}

function mapProject(row: {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  workspace_id: string | null;
  created_at: Date;
  updated_at: Date;
}): ProjectRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
