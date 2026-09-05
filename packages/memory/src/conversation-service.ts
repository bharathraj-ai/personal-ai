import type { DatabaseClient } from "@personal-ai/db";
import { ensureUser } from "@personal-ai/db";

export interface ConversationService {
  getOrCreateConversation(input: {
    userId: string;
    conversationId?: string;
    projectId?: string | null;
    title?: string;
  }): Promise<{ id: string }>;
  addMessage(input: {
    conversationId: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    model?: string;
    provider?: string;
  }): Promise<void>;
}

export class PostgresConversationService implements ConversationService {
  constructor(private readonly db: DatabaseClient) {}

  async getOrCreateConversation(input: {
    userId: string;
    conversationId?: string;
    projectId?: string | null;
    title?: string;
  }): Promise<{ id: string }> {
    const user = await ensureUser(this.db, input.userId);

    if (input.conversationId) {
      const existing = await this.db.query(
        `SELECT id FROM personal_ai.conversations WHERE id = $1 AND user_id = $2`,
        [input.conversationId, user.id],
      );
      if (existing.rows[0]) return { id: input.conversationId };
    }

    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO personal_ai.conversations (user_id, project_id, title)
       VALUES ($1, $2, $3) RETURNING id`,
      [user.id, input.projectId ?? null, input.title ?? "Chat"],
    );
    return { id: inserted.rows[0].id };
  }

  async addMessage(input: {
    conversationId: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    model?: string;
    provider?: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO messages (conversation_id, role, content, model, provider)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.conversationId,
        input.role,
        input.content,
        input.model ?? null,
        input.provider ?? null,
      ],
    );
    await this.db.query(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      [input.conversationId],
    );
  }
}

export class NoopConversationService implements ConversationService {
  async getOrCreateConversation() {
    return { id: crypto.randomUUID() };
  }
  async addMessage() {}
}
