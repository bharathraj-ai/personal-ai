/** Personal memory store — Stage C. Backed by Postgres `memories` table. */
export interface MemoryEntry {
  id: string;
  userId: string;
  content: string;
  category: "preference" | "decision" | "context" | "instruction";
  approved: boolean;
  createdAt: Date;
}

export interface MemoryStore {
  search(userId: string, query: string, limit?: number): Promise<MemoryEntry[]>;
  store(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry>;
}

/** Stub until Postgres integration in Stage C. */
export class InMemoryMemoryStore implements MemoryStore {
  private entries: MemoryEntry[] = [];

  async search(userId: string, query: string, limit = 10): Promise<MemoryEntry[]> {
    return this.entries
      .filter((e) => e.userId === userId && e.approved && e.content.includes(query))
      .slice(0, limit);
  }

  async store(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry> {
    const stored: MemoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };
    this.entries.push(stored);
    return stored;
  }
}
