import type { FastifyInstance } from "fastify";
import type { DatabaseClient } from "@personal-ai/db";

export async function registerConnectorsRoutes(app: FastifyInstance, options: { db: DatabaseClient }) {
  app.get("/api/connectors", async (_request, _reply) => {
    const result = await options.db.query(
      `SELECT * FROM personal_ai.external_connections ORDER BY created_at DESC`
    );
    return { connectors: result.rows };
  });

  app.post("/api/connectors/:provider/revoke", async (request: any, _reply) => {
    const { provider } = request.params;
    await options.db.query(
      `UPDATE personal_ai.external_connections SET status = 'revoked' WHERE provider = $1`,
      [provider]
    );
    return { success: true, message: `Revoked ${provider}` };
  });

  app.get("/api/permissions", async (_request, _reply) => {
    const result = await options.db.query(
      `SELECT * FROM personal_ai.external_action_permissions ORDER BY created_at DESC`
    );
    return { permissions: result.rows };
  });

  app.get("/api/audit", async (_request, _reply) => {
    const result = await options.db.query(
      `SELECT * FROM personal_ai.external_actions ORDER BY created_at DESC LIMIT 100`
    );
    return { audit: result.rows };
  });
}
