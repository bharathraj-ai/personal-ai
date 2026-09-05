/** Legacy in-memory chunk store — prefer PostgresRagService / InMemoryRagService. */
export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, string>;
}

export interface RagStore {
  ingest(documentId: string, chunks: Omit<DocumentChunk, "id" | "documentId">[]): Promise<void>;
  search(query: string, limit?: number): Promise<DocumentChunk[]>;
}

export class InMemoryRagStore implements RagStore {
  private chunks: DocumentChunk[] = [];

  async ingest(documentId: string, chunks: Omit<DocumentChunk, "id" | "documentId">[]): Promise<void> {
    for (const chunk of chunks) {
      this.chunks.push({ ...chunk, id: crypto.randomUUID(), documentId });
    }
  }

  async search(query: string, limit = 5): Promise<DocumentChunk[]> {
    return this.chunks
      .filter((c) => c.content.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit);
  }
}
