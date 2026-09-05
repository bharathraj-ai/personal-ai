import type { DatabaseClient } from "@personal-ai/db";
import { ensureUser } from "@personal-ai/db";
import type { EmbeddingProvider } from "@personal-ai/memory";
import {
  detectSecrets,
  vectorToSql,
  wrapUntrustedContext,
} from "@personal-ai/memory";

export interface DocumentRecord {
  id: string;
  userId: string;
  projectId?: string | null;
  filename: string;
  mimeType?: string | null;
  sizeBytes: number;
  status: "pending" | "processing" | "indexed" | "failed";
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RetrievedChunk {
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  score: number;
  filename?: string;
  metadata?: Record<string, unknown>;
}

export interface RagSearchOptions {
  userId: string;
  query: string;
  projectId?: string | null;
  limit?: number;
  similarityThreshold?: number;
}

export interface RagConfig {
  topK: number;
  similarityThreshold: number;
  chunkSize: number;
  chunkOverlap: number;
  maxContextChars: number;
}

export interface RagService {
  ingestDocument(input: {
    userId: string;
    filename: string;
    content: string;
    mimeType?: string;
    projectId?: string | null;
  }): Promise<DocumentRecord>;
  search(options: RagSearchOptions): Promise<RetrievedChunk[]>;
  listDocuments(userId: string, projectId?: string | null): Promise<DocumentRecord[]>;
  getDocument(userId: string, documentId: string): Promise<DocumentRecord | null>;
  deleteDocument(userId: string, documentId: string): Promise<boolean>;
  buildProtectedContext(chunks: RetrievedChunk[]): string;
}

/** Retrieval behind a replaceable interface (hybrid search deferred). */
export interface Retriever {
  semanticSearch(options: RagSearchOptions): Promise<RetrievedChunk[]>;
  hybridSearch(options: RagSearchOptions): Promise<RetrievedChunk[]>;
}

export class SemanticRetriever implements Retriever {
  constructor(private readonly rag: RagService) {}

  semanticSearch(options: RagSearchOptions): Promise<RetrievedChunk[]> {
    return this.rag.search(options);
  }

  /** Reserved for BM25 + vector fusion. Currently delegates to semanticSearch. */
  hybridSearch(options: RagSearchOptions): Promise<RetrievedChunk[]> {
    return this.semanticSearch(options);
  }
}

export function chunkText(
  text: string,
  chunkSize: number,
  overlap: number,
): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

export class PostgresRagService implements RagService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly embeddings: EmbeddingProvider,
    private readonly config: RagConfig,
  ) {}

  async ingestDocument(input: {
    userId: string;
    filename: string;
    content: string;
    mimeType?: string;
    projectId?: string | null;
  }): Promise<DocumentRecord> {
    const secrets = detectSecrets(input.content);
    if (!secrets.safe) {
      throw new Error(secrets.reason ?? "Document rejected: secrets detected");
    }

    const user = await ensureUser(this.db, input.userId);
    const inserted = await this.db.query<{
      id: string;
      user_id: string;
      project_id: string | null;
      filename: string;
      mime_type: string | null;
      size_bytes: string;
      status: DocumentRecord["status"];
      error: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO documents (user_id, project_id, filename, mime_type, size_bytes, status)
       VALUES ($1, $2, $3, $4, $5, 'processing')
       RETURNING *`,
      [
        user.id,
        input.projectId ?? null,
        input.filename,
        input.mimeType ?? "text/plain",
        Buffer.byteLength(input.content, "utf8"),
      ],
    );

    const doc = mapDoc(inserted.rows[0]);

    try {
      const chunks = chunkText(
        input.content,
        this.config.chunkSize,
        this.config.chunkOverlap,
      );
      const embeddings = await this.embeddings.embedBatch(chunks);

      for (let i = 0; i < chunks.length; i++) {
        await this.db.query(
          `INSERT INTO document_chunks (document_id, chunk_index, content, embedding, metadata)
           VALUES ($1, $2, $3, $4::vector, $5::jsonb)`,
          [
            doc.id,
            i,
            chunks[i],
            vectorToSql(embeddings[i]),
            JSON.stringify({ filename: input.filename }),
          ],
        );
      }

      await this.db.query(
        `UPDATE documents SET status = 'indexed', updated_at = NOW() WHERE id = $1`,
        [doc.id],
      );
      doc.status = "indexed";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.db.query(
        `UPDATE documents SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`,
        [doc.id, message],
      );
      doc.status = "failed";
      doc.error = message;
    }

    return doc;
  }

  async search(options: RagSearchOptions): Promise<RetrievedChunk[]> {
    const user = await ensureUser(this.db, options.userId);
    const limit = options.limit ?? this.config.topK;
    const threshold = options.similarityThreshold ?? this.config.similarityThreshold;
    const queryEmbedding = await this.embeddings.embed(options.query);
    const vec = vectorToSql(queryEmbedding);

    const params: unknown[] = [vec, user.id, threshold];
    let projectClause = "";
    if (options.projectId) {
      projectClause = "AND d.project_id = $4";
      params.push(options.projectId);
    }

    const result = await this.db.query<{
      document_id: string;
      chunk_id: string;
      chunk_index: number;
      content: string;
      filename: string;
      metadata: Record<string, unknown>;
      score: number;
    }>(
      `SELECT c.document_id, c.id AS chunk_id, c.chunk_index, c.content,
              d.filename, c.metadata,
              1 - (c.embedding <=> $1::vector) AS score
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE d.user_id = $2
         AND d.status = 'indexed'
         AND c.embedding IS NOT NULL
         AND 1 - (c.embedding <=> $1::vector) >= $3
         ${projectClause}
       ORDER BY c.embedding <=> $1::vector
       LIMIT $${params.length + 1}`,
      [...params, limit],
    );

    return result.rows.map((r) => ({
      documentId: r.document_id,
      chunkId: r.chunk_id,
      chunkIndex: r.chunk_index,
      content: r.content,
      score: Number(r.score),
      filename: r.filename,
      metadata: r.metadata,
    }));
  }

  async listDocuments(userId: string, projectId?: string | null): Promise<DocumentRecord[]> {
    const user = await ensureUser(this.db, userId);
    const result = await this.db.query(
      projectId
        ? `SELECT * FROM documents WHERE user_id = $1 AND project_id = $2 ORDER BY created_at DESC`
        : `SELECT * FROM documents WHERE user_id = $1 ORDER BY created_at DESC`,
      projectId ? [user.id, projectId] : [user.id],
    );
    return result.rows.map((r) => mapDoc(r as Parameters<typeof mapDoc>[0]));
  }

  async getDocument(userId: string, documentId: string): Promise<DocumentRecord | null> {
    const user = await ensureUser(this.db, userId);
    const result = await this.db.query(`SELECT * FROM documents WHERE id = $1 AND user_id = $2`, [
      documentId,
      user.id,
    ]);
    return result.rows[0] ? mapDoc(result.rows[0] as Parameters<typeof mapDoc>[0]) : null;
  }

  async deleteDocument(userId: string, documentId: string): Promise<boolean> {
    const user = await ensureUser(this.db, userId);
    const result = await this.db.query(`DELETE FROM documents WHERE id = $1 AND user_id = $2`, [
      documentId,
      user.id,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  buildProtectedContext(chunks: RetrievedChunk[]): string {
    if (chunks.length === 0) return "";
    let remaining = this.config.maxContextChars;
    const parts: string[] = [];

    for (const chunk of chunks) {
      const label = `DOC ${chunk.filename ?? chunk.documentId}#${chunk.chunkIndex} score=${chunk.score.toFixed(3)}`;
      const wrapped = wrapUntrustedContext(label, chunk.content);
      if (wrapped.length > remaining) break;
      parts.push(wrapped);
      remaining -= wrapped.length;
    }

    return parts.join("\n\n");
  }
}

function mapDoc(row: {
  id: string;
  user_id: string;
  project_id: string | null;
  filename: string;
  mime_type: string | null;
  size_bytes: string | number;
  status: DocumentRecord["status"];
  error: string | null;
  created_at: Date;
  updated_at: Date;
}): DocumentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** In-memory RAG when DB unavailable. */
export class InMemoryRagService implements RagService {
  private docs: DocumentRecord[] = [];
  private chunks: Array<RetrievedChunk & { userId: string; projectId?: string | null }> = [];

  constructor(private readonly config: RagConfig) {}

  async ingestDocument(input: {
    userId: string;
    filename: string;
    content: string;
    mimeType?: string;
    projectId?: string | null;
  }): Promise<DocumentRecord> {
    const secrets = detectSecrets(input.content);
    if (!secrets.safe) throw new Error(secrets.reason);

    const doc: DocumentRecord = {
      id: crypto.randomUUID(),
      userId: input.userId,
      projectId: input.projectId,
      filename: input.filename,
      mimeType: input.mimeType ?? "text/plain",
      sizeBytes: Buffer.byteLength(input.content, "utf8"),
      status: "indexed",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.docs.push(doc);

    const pieces = chunkText(input.content, this.config.chunkSize, this.config.chunkOverlap);
    pieces.forEach((content, chunkIndex) => {
      this.chunks.push({
        documentId: doc.id,
        chunkId: crypto.randomUUID(),
        chunkIndex,
        content,
        score: 1,
        filename: input.filename,
        userId: input.userId,
        projectId: input.projectId,
      });
    });

    return doc;
  }

  async search(options: RagSearchOptions): Promise<RetrievedChunk[]> {
    const q = options.query.toLowerCase();
    return this.chunks
      .filter((c) => c.userId === options.userId)
      .filter((c) => !options.projectId || c.projectId === options.projectId)
      .filter((c) => c.content.toLowerCase().includes(q) || q.split(/\s+/).some((t) => t.length > 2 && c.content.toLowerCase().includes(t)))
      .slice(0, options.limit ?? this.config.topK)
      .map(({ userId: _u, projectId: _p, ...rest }) => rest);
  }

  async listDocuments(userId: string, projectId?: string | null) {
    return this.docs.filter(
      (d) => d.userId === userId && (!projectId || d.projectId === projectId),
    );
  }

  async getDocument(userId: string, documentId: string) {
    return this.docs.find((d) => d.userId === userId && d.id === documentId) ?? null;
  }

  async deleteDocument(userId: string, documentId: string) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !(d.userId === userId && d.id === documentId));
    this.chunks = this.chunks.filter((c) => c.documentId !== documentId || c.userId !== userId);
    return this.docs.length < before;
  }

  buildProtectedContext(chunks: RetrievedChunk[]): string {
    if (chunks.length === 0) return "";
    let remaining = this.config.maxContextChars;
    const parts: string[] = [];
    for (const chunk of chunks) {
      const label = `DOC ${chunk.filename ?? chunk.documentId}#${chunk.chunkIndex}`;
      const wrapped = wrapUntrustedContext(label, chunk.content);
      if (wrapped.length > remaining) break;
      parts.push(wrapped);
      remaining -= wrapped.length;
    }
    return parts.join("\n\n");
  }
}
