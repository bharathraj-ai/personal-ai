import type { FastifyInstance } from "fastify";
import type { AuditLogService } from "@personal-ai/audit";
import { AuthError, requireAuth } from "../auth/index.js";

export function registerAuditRoutes(
  app: FastifyInstance,
  deps: { audit: AuditLogService },
) {
  app.get<{ Querystring: { projectId?: string; taskId?: string; limit?: string } }>(
    "/audit",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        const entries = await deps.audit.list({
          userId: auth.userId,
          projectId: request.query.projectId,
          taskId: request.query.taskId,
          limit: request.query.limit ? Number(request.query.limit) : 100,
        });
        return { entries };
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );
}
