import type { MemoryRecord, MemoryService } from "./memory-service.js";

export interface ContextQuery {
  userId: string;
  query: string;
  projectId?: string | null;
  taskType?: string;
  limit?: number;
  threshold?: number;
}

export interface ContextEngine {
  retrieveContext(query: ContextQuery): Promise<MemoryRecord[]>;
}

export class DefaultContextEngine implements ContextEngine {
  constructor(private readonly memoryService: MemoryService) {}

  async retrieveContext(query: ContextQuery): Promise<MemoryRecord[]> {
    // 1. Retrieve raw semantically similar memories
    const memories = await this.memoryService.searchMemory({
      userId: query.userId,
      query: query.query,
      projectId: query.projectId, // Will fetch project + personal unless projectOnly is specified
      limit: (query.limit ?? 20) * 2, // over-fetch for re-ranking
      similarityThreshold: query.threshold ?? 0.6,
      status: "active", // only retrieve active memories, exclude superseded/rejected
    });

    // 2. Rank
    const ranked = memories.map((m) => {
      let finalScore = m.score ?? 0; // Semantic score: 0 to 1

      // Importance modifier: importance is 0.0 to 1.0. Let's add up to 0.2
      finalScore += m.importance * 0.2;

      // Project relevance: exact match gives a boost
      if (query.projectId && m.projectId === query.projectId) {
        finalScore += 0.15;
      }

      // Recency: slight boost for newer memories (e.g. within last 7 days)
      const daysOld = (Date.now() - m.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysOld < 7) {
        finalScore += 0.1 * (1 - daysOld / 7);
      }

      // Profile/Career memories might get a slight constant boost for personal queries
      if (m.memoryType === "profile" || m.memoryType === "career") {
        finalScore += 0.05;
      }

      return { memory: m, score: finalScore };
    });

    // Sort descending by final score
    ranked.sort((a, b) => b.score - a.score);

    // 3. Deduplicate (exact content)
    const seen = new Set<string>();
    const deduped: MemoryRecord[] = [];
    
    for (const { memory } of ranked) {
      const hash = memory.content.toLowerCase().trim();
      if (!seen.has(hash)) {
        seen.add(hash);
        deduped.push(memory);
      }
    }

    // 4. Budget / Limit
    return deduped.slice(0, query.limit ?? 10);
  }
}
