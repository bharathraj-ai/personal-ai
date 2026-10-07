import type { FastifyInstance } from "fastify";
import type { DatabaseClient } from "@personal-ai/db";

export async function registerNotificationRoutes(app: FastifyInstance, options: { db: DatabaseClient }) {
  app.get("/api/notifications", async (_request, _reply) => {
    const result = await options.db.query(
      `SELECT * FROM personal_ai.notifications ORDER BY created_at DESC LIMIT 50`
    );
    return { notifications: result.rows };
  });

  app.post("/api/notifications/:id/read", async (request: any, _reply) => {
    const { id } = request.params;
    await options.db.query(
      `UPDATE personal_ai.notifications SET read = TRUE WHERE id = $1`,
      [id]
    );
    return { success: true };
  });

  app.post("/api/notifications/notify", async (request: any, _reply) => {
    const { userId, type, title, message, actionLink } = request.body;
    const id = crypto.randomUUID();
    await options.db.query(
      `INSERT INTO personal_ai.notifications (id, user_id, type, title, message, action_link) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userId, type, title, message, actionLink || null]
    );
    return { success: true, id };
  });
}
