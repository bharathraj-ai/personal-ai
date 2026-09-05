import type { FastifyInstance } from "fastify";
import type { StorageService } from "@personal-ai/storage";
import { isKeyOwnedByProject, userProjectKey } from "@personal-ai/storage";
import type { ProjectPersistenceService } from "@personal-ai/storage";
import { AuthError, requireAuth } from "../auth/index.js";

export function registerStorageRoutes(
  app: FastifyInstance,
  deps: {
    storage: StorageService | null;
    projectPersistence?: ProjectPersistenceService | null;
    getActiveProjectId?: (userId: string) => string | undefined;
  },
) {
  app.get("/storage/health", async () => {
    if (!deps.storage) {
      return { state: "NOT_CONFIGURED", message: "S3_BUCKET not set" };
    }
    return deps.storage.healthCheck();
  });

  app.post<{
    Body: {
      projectId: string;
      relativePath: string;
      content: string;
      contentType?: string;
    };
  }>("/storage/upload", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      if (!deps.storage) {
        return reply.status(503).send({ error: "S3 storage NOT_CONFIGURED" });
      }
      const { projectId, relativePath, content, contentType } = request.body;
      if (!projectId || !relativePath) {
        return reply.status(400).send({ error: "projectId and relativePath required" });
      }
      const meta = await deps.storage.upload(
        auth.userId,
        projectId,
        relativePath,
        content,
        contentType,
      );
      return { ok: true, metadata: meta };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get<{ Querystring: { projectId: string; path: string } }>(
    "/storage/download",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        if (!deps.storage) {
          return reply.status(503).send({ error: "S3 storage NOT_CONFIGURED" });
        }
        const { projectId, path } = request.query;
        if (!projectId || !path) {
          return reply.status(400).send({ error: "projectId and path required" });
        }
        const buf = await deps.storage.download(auth.userId, projectId, path);
        reply.header("Content-Type", "application/octet-stream");
        return buf;
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get<{ Querystring: { projectId: string; prefix?: string } }>(
    "/storage/list",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        if (!deps.storage) {
          return reply.status(503).send({ error: "S3 storage NOT_CONFIGURED" });
        }
        const { projectId, prefix } = request.query;
        if (!projectId) {
          return reply.status(400).send({ error: "projectId required" });
        }
        const items = await deps.storage.list(auth.userId, projectId, prefix);
        return { items };
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{
    Body: { projectId: string; workspaceId: string };
  }>("/projects/sync", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      if (!deps.projectPersistence) {
        return reply.status(503).send({ error: "S3 project persistence NOT_CONFIGURED" });
      }
      const { projectId, workspaceId } = request.body;
      if (!projectId || !workspaceId) {
        return reply.status(400).send({ error: "projectId and workspaceId required" });
      }
      const result = await deps.projectPersistence.syncWorkspaceToS3(
        auth.userId,
        projectId,
        workspaceId,
      );
      return result;
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{
    Body: {
      projectId: string;
      projectName: string;
      sourceWorkspaceId: string;
    };
  }>("/projects/restore", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      if (!deps.projectPersistence) {
        return reply.status(503).send({ error: "S3 project persistence NOT_CONFIGURED" });
      }
      const { projectId, projectName, sourceWorkspaceId } = request.body;
      if (!projectId || !projectName || !sourceWorkspaceId) {
        return reply.status(400).send({
          error: "projectId, projectName, and sourceWorkspaceId required",
        });
      }
      const result = await deps.projectPersistence.restoreProjectFromS3(
        auth.userId,
        projectId,
        projectName,
        sourceWorkspaceId,
      );
      return result;
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get<{ Querystring: { projectId: string; path: string } }>(
    "/storage/presign-download",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        if (!deps.storage) {
          return reply.status(503).send({ error: "S3 storage NOT_CONFIGURED" });
        }
        const { projectId, path } = request.query;
        if (!projectId || !path) {
          return reply.status(400).send({ error: "projectId and path required" });
        }
        const key = userProjectKey(auth.userId, projectId, path);
        if (!isKeyOwnedByProject(key, auth.userId, projectId)) {
          return reply.status(403).send({ error: "Access denied" });
        }
        const presigned = await deps.storage.presignedDownload(auth.userId, projectId, path);
        return presigned;
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );
}
