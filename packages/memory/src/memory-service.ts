import type { DatabaseClient } from "@personal-ai/db";
import { ensureUser } from "@personal-ai/db";
import type { EmbeddingProvider } from "./embeddings.js";
import { vectorToSql } from "./embeddings.js";
import { extractMemoryCandidates } from "./extract.js";
import { LearningPipeline } from "./learning-pipeline.js";
import { detectSecrets } from "./secret-filter.js";

export type MemoryType = "preference" | "decision" | "context" | "instruction" | "fact";

export interface MemoryRecord {
  id: string;
  userId: string;
  projectId?: string | null;
  content: string;
  memoryType: MemoryType;
  importance: number;
  metadata: Record<string, unknown>;
  score?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemorySearchOptions {
  userId: string;
  query: string;
  projectId?: string | null;
  /** If true, only project memories; if null/undefined with projectId, include personal + project */
  projectOnly?: boolean;
  limit?: number;
  similarityThreshold?: number;
}

export interface CreateMemoryInput {
  userId: string;
  content: string;
  memoryType?: MemoryType;
  projectId?: string | null;
  importance?: number;
  metadata?: Record<string, unknown>;
  /** Skip learning pipeline approval (already user-approved via API) */
  userApproved?: boolean;
}

export interface MemoryService {
  createMemory(input: CreateMemoryInput): Promise<MemoryRecord | { rejected: true; reason: string }>;
  searchMemory(options: MemorySearchOptions): Promise<MemoryRecord[]>;
  updateMemory(
    userId: string,
    memoryId: string,
    patch: { content?: string; importance?: number },
  ): Promise<MemoryRecord | null>;
  deleteMemory(userId: string, memoryId: string): Promise<boolean>;
  deleteAllMemories(userId: string, projectId?: string | null): Promise<number>;
  extractMemories(userMessage: string, userId: string): Promise<CreateMemoryInput[]>;
  shouldStoreMemory(content: string): { ok: boolean; reason?: string };
  listMemories(userId: string, projectId?: string | null, limit?: number): Promise<MemoryRecord[]>;
}

function contentHash(content: string): string {
  let h = 0;
  const normalized = content.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    h = (Math.imul(31, h) + normalized.charCodeAt(i)) | 0;
  }
  return String(h);
}

export class PostgresMemoryService implements MemoryService {
  private readonly pipeline = new LearningPipeline();

  constructor(
    private readonly db: DatabaseClient,
    private readonly embeddings: EmbeddingProvider,
    private readonly defaults: {
      topK: number;
      similarityThreshold: number;
    },
  ) {}

  shouldStoreMemory(content: string): { ok: boolean; reason?: string } {
    const secrets = detectSecrets(content);
    if (!secrets.safe) return { ok: false, reason: secrets.reason };
    if (content.trim().length < 10) return { ok: false, reason: "Content too short" };
    return { ok: true };
  }

  async createMemory(
    input: CreateMemoryInput,
  ): Promise<MemoryRecord | { rejected: true; reason: string }> {
    const gate = this.shouldStoreMemory(input.content);
    if (!gate.ok) return { rejected: true, reason: gate.reason ?? "Rejected" };

    const pipelineResult = await this.pipeline.process(
      {
        content: input.content,
        source: "user_feedback",
        userId: input.userId,
      },
      { userApproved: input.userApproved ?? true },
    );
    if (!pipelineResult.approved) {
      return { rejected: true, reason: pipelineResult.reason ?? "Pipeline rejected" };
    }

    const user = await ensureUser(this.db, input.userId);
    const content = pipelineResult.sanitizedContent ?? input.content.trim();
    const hash = contentHash(content);
    const embedding = await this.embeddings.embed(content);
    const memoryType = input.memoryType ?? "context";
    const importance = input.importance ?? 0.5;

    try {
      const result = await this.db.query<{
        id: string;
        user_id: string;
        project_id: string | null;
        content: string;
        memory_type: string;
        importance: number;
        metadata: Record<string, unknown>;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO personal_ai.memories (user_id, project_id, content, memory_type, importance, embedding, metadata, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8)
         ON CONFLICT (user_id, content_hash) WHERE content_hash IS NOT NULL
         DO UPDATE SET updated_at = NOW()
         RETURNING id, user_id, project_id, content, memory_type, importance, metadata, created_at, updated_at`,
        [
          user.id,
          input.projectId ?? null,
          content,
          memoryType,
          importance,
          vectorToSql(embedding),
          JSON.stringify(input.metadata ?? {}),
          hash,
        ],
      );

      return mapMemory(result.rows[0]);
    } catch (err) {
      return {
        rejected: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async searchMemory(options: MemorySearchOptions): Promise<MemoryRecord[]> {
    const user = await ensureUser(this.db, options.userId);
    const limit = options.limit ?? this.defaults.topK;
    const threshold = options.similarityThreshold ?? this.defaults.similarityThreshold;
    const queryEmbedding = await this.embeddings.embed(options.query);
    const vec = vectorToSql(queryEmbedding);

    let sql = `
      SELECT id, user_id, project_id, content, memory_type, importance, metadata,
             created_at, updated_at,
             1 - (embedding <=> $1::vector) AS score
      FROM personal_ai.memories
      WHERE user_id = $2
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> $1::vector) >= $3
    `;
    const params: unknown[] = [vec, user.id, threshold];

    if (options.projectOnly && options.projectId) {
      sql += ` AND project_id = $4`;
      params.push(options.projectId);
    } else if (options.projectId) {
      sql += ` AND (project_id IS NULL OR project_id = $4)`;
      params.push(options.projectId);
    } else {
      sql += ` AND project_id IS NULL`;
    }

    sql += ` ORDER BY embedding <=> $1::vector LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.db.query<{
      id: string;
      user_id: string;
      project_id: string | null;
      content: string;
      memory_type: string;
      importance: number;
      metadata: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
      score: number;
    }>(sql, params);

    return result.rows.map((r) => ({ ...mapMemory(r), score: Number(r.score) }));
  }

  async listMemories(
    userId: string,
    projectId?: string | null,
    limit = 50,
  ): Promise<MemoryRecord[]> {
    const user = await ensureUser(this.db, userId);
    const result = await this.db.query<{
      id: string;
      user_id: string;
      project_id: string | null;
      content: string;
      memory_type: string;
      importance: number;
      metadata: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(
      projectId
        ? `SELECT * FROM personal_ai.memories WHERE user_id = $1 AND project_id = $2
           ORDER BY updated_at DESC LIMIT $3`
        : `SELECT * FROM personal_ai.memories WHERE user_id = $1 AND project_id IS NULL
           ORDER BY updated_at DESC LIMIT $2`,
      projectId ? [user.id, projectId, limit] : [user.id, limit],
    );
    return result.rows.map(mapMemory);
  }

  async updateMemory(
    userId: string,
    memoryId: string,
    patch: { content?: string; importance?: number },
  ): Promise<MemoryRecord | null> {
    const user = await ensureUser(this.db, userId);
    if (patch.content) {
      const gate = this.shouldStoreMemory(patch.content);
      if (!gate.ok) return null;
      const embedding = await this.embeddings.embed(patch.content);
      const result = await this.db.query(
        `UPDATE personal_ai.memories SET content = $1, embedding = $2::vector, content_hash = $3,
         importance = COALESCE($4, importance), updated_at = NOW()
         WHERE id = $5 AND user_id = $6
         RETURNING id, user_id, project_id, content, memory_type, importance, metadata, created_at, updated_at`,
        [
          patch.content.trim(),
          vectorToSql(embedding),
          contentHash(patch.content),
          patch.importance ?? null,
          memoryId,
          user.id,
        ],
      );
      return result.rows[0] ? mapMemory(result.rows[0] as Parameters<typeof mapMemory>[0]) : null;
    }

    const result = await this.db.query(
      `UPDATE personal_ai.memories SET importance = COALESCE($1, importance), updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, user_id, project_id, content, memory_type, importance, metadata, created_at, updated_at`,
      [patch.importance ?? null, memoryId, user.id],
    );
    return result.rows[0] ? mapMemory(result.rows[0] as Parameters<typeof mapMemory>[0]) : null;
  }

  async deleteMemory(userId: string, memoryId: string): Promise<boolean> {
    const user = await ensureUser(this.db, userId);
    const result = await this.db.query(
      `DELETE FROM personal_ai.memories WHERE id = $1 AND user_id = $2`,
      [memoryId, user.id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteAllMemories(userId: string, projectId?: string | null): Promise<number> {
    const user = await ensureUser(this.db, userId);
    const result = projectId
      ? await this.db.query(`DELETE FROM personal_ai.memories WHERE user_id = $1 AND project_id = $2`, [
          user.id,
          projectId,
        ])
      : await this.db.query(`DELETE FROM personal_ai.memories WHERE user_id = $1`, [user.id]);
    return result.rowCount ?? 0;
  }

  async extractMemories(userMessage: string, userId: string): Promise<CreateMemoryInput[]> {
    const gate = this.shouldStoreMemory(userMessage);
    if (!gate.ok) return [];
    return extractMemoryCandidates(userMessage, userId);
  }
}

function mapMemory(row: {
  id: string;
  user_id: string;
  project_id: string | null;
  content: string;
  memory_type: string;
  importance: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}): MemoryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    content: row.content,
    memoryType: row.memory_type as MemoryType,
    importance: Number(row.importance),
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** In-memory fallback when DATABASE_URL is unset. */
export class InMemoryMemoryService implements MemoryService {
  private records: MemoryRecord[] = [];

  shouldStoreMemory(content: string) {
    const secrets = detectSecrets(content);
    if (!secrets.safe) return { ok: false, reason: secrets.reason };
    return { ok: true };
  }

  async createMemory(input: CreateMemoryInput) {
    const gate = this.shouldStoreMemory(input.content);
    if (!gate.ok) return { rejected: true as const, reason: gate.reason ?? "Rejected" };
    const normalized = input.content.trim().toLowerCase();
    if (
      this.records.some(
        (r) =>
          r.userId === input.userId &&
          r.content.trim().toLowerCase() === normalized &&
          (r.projectId ?? null) === (input.projectId ?? null),
      )
    ) {
      return { rejected: true as const, reason: "Duplicate memory" };
    }
    const record: MemoryRecord = {
      id: crypto.randomUUID(),
      userId: input.userId,
      projectId: input.projectId,
      content: input.content.trim(),
      memoryType: input.memoryType ?? "context",
      importance: input.importance ?? 0.5,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.records.push(record);
    return record;
  }

  async searchMemory(options: MemorySearchOptions) {
    const q = options.query.toLowerCase();
    return this.records
      .filter((r) => r.userId === options.userId)
      .filter((r) => {
        if (options.projectOnly && options.projectId) return r.projectId === options.projectId;
        if (options.projectId) return !r.projectId || r.projectId === options.projectId;
        return !r.projectId;
      })
      .filter((r) => r.content.toLowerCase().includes(q) || q.split(/\s+/).some((t) => r.content.toLowerCase().includes(t)))
      .slice(0, options.limit ?? 5);
  }

  async listMemories(userId: string, projectId?: string | null, limit = 50) {
    return this.records
      .filter((r) => r.userId === userId)
      .filter((r) => (projectId ? r.projectId === projectId : !r.projectId))
      .slice(0, limit);
  }

  async updateMemory() {
    return null;
  }

  async deleteMemory(userId: string, memoryId: string) {
    const before = this.records.length;
    this.records = this.records.filter((r) => !(r.userId === userId && r.id === memoryId));
    return this.records.length < before;
  }

  async deleteAllMemories(userId: string, projectId?: string | null) {
    const before = this.records.length;
    this.records = this.records.filter((r) => {
      if (r.userId !== userId) return true;
      if (projectId) return r.projectId !== projectId;
      return false;
    });
    return before - this.records.length;
  }

  async extractMemories(userMessage: string, userId: string) {
    const gate = this.shouldStoreMemory(userMessage);
    if (!gate.ok) return [];
    return extractMemoryCandidates(userMessage, userId);
  }
}
