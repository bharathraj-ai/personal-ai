import type { FastifyInstance } from "fastify";
import type { ConversationService, MemoryService, ProjectPlanStore, ProjectService } from "@personal-ai/memory";
import type { RagService } from "@personal-ai/rag";
import { AuthError, requireAuth } from "../auth/index.js";

/**
 * Knowledge routes — userId is ALWAYS derived from authenticated session.
 * AUTHENTICATED USER ID ≠ CLIENT-SUPPLIED userId
 */
export function registerKnowledgeRoutes(
  app: FastifyInstance,
  deps: {
    memory: MemoryService;
    rag: RagService;
    projects: ProjectService;
    conversations: ConversationService;
    projectPlanStore?: ProjectPlanStore;
  },
) {
  function rejectClientUserId(
    reply: { status: (c: number) => { send: (b: unknown) => unknown } },
    authUserId: string,
    clientUserId?: string,
  ): boolean {
    if (clientUserId && clientUserId !== authUserId) {
      reply.status(403).send({
        error: "Client userId does not match authenticated identity",
      });
      return true;
    }
    return false;
  }

  // ——— Memory ———
  app.get("/memory", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      const q = request.query as { userId?: string; projectId?: string };
      if (rejectClientUserId(reply, auth.userId, q.userId)) return;
      const items = await deps.memory.listMemories(auth.userId, q.projectId);
      return { memories: items };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get("/memory/search", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      const q = request.query as { userId?: string; query?: string; projectId?: string };
      if (rejectClientUserId(reply, auth.userId, q.userId)) return;
      if (!q.query?.trim()) return reply.status(400).send({ error: "query is required" });
      const results = await deps.memory.searchMemory({
        userId: auth.userId,
        query: q.query,
        projectId: q.projectId,
      });
      return { results };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{
    Body: {
      content: string;
      userId?: string;
      projectId?: string;
      memoryType?: string;
      importance?: number;
    };
  }>("/memory", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      const body = request.body;
      if (rejectClientUserId(reply, auth.userId, body.userId)) return;
      if (!body.content?.trim()) return reply.status(400).send({ error: "content is required" });
      const result = await deps.memory.createMemory({
        userId: auth.userId,
        content: body.content,
        projectId: body.projectId,
        memoryType: (body.memoryType as "preference" | "context" | undefined) ?? "context",
        importance: body.importance,
        userApproved: true,
      });
      if ("rejected" in result && result.rejected) {
        return reply.status(400).send({ error: result.reason });
      }
      return result;
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string }; Querystring: { userId?: string } }>(
    "/memory/:id",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        if (rejectClientUserId(reply, auth.userId, request.query.userId)) return;
        const ok = await deps.memory.deleteMemory(auth.userId, request.params.id);
        if (!ok) return reply.status(404).send({ error: "Memory not found" });
        return { deleted: true };
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.delete<{ Querystring: { userId?: string; projectId?: string; confirm?: string } }>(
    "/memory",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        if (rejectClientUserId(reply, auth.userId, request.query.userId)) return;
        if (request.query.confirm !== "yes") {
          return reply.status(400).send({ error: "Pass confirm=yes to clear all memory" });
        }
        const count = await deps.memory.deleteAllMemories(
          auth.userId,
          request.query.projectId,
        );
        return { deleted: count };
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // ——— Documents / RAG ———
  app.get("/documents", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      const q = request.query as { userId?: string; projectId?: string };
      if (rejectClientUserId(reply, auth.userId, q.userId)) return;
      const documents = await deps.rag.listDocuments(auth.userId, q.projectId);
      return { documents };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string }; Querystring: { userId?: string } }>(
    "/documents/:id",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        if (rejectClientUserId(reply, auth.userId, request.query.userId)) return;
        const doc = await deps.rag.getDocument(auth.userId, request.params.id);
        if (!doc) return reply.status(404).send({ error: "Document not found" });
        return doc;
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{
    Body: {
      userId?: string;
      projectId?: string;
      filename: string;
      content: string;
      mimeType?: string;
    };
  }>("/documents", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      const body = request.body;
      if (rejectClientUserId(reply, auth.userId, body.userId)) return;
      if (!body.filename || !body.content) {
        return reply.status(400).send({ error: "filename and content are required" });
      }
      try {
        const doc = await deps.rag.ingestDocument({
          userId: auth.userId,
          filename: body.filename,
          content: body.content,
          mimeType: body.mimeType,
          projectId: body.projectId,
        });
        return doc;
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string }; Querystring: { userId?: string } }>(
    "/documents/:id",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        if (rejectClientUserId(reply, auth.userId, request.query.userId)) return;
        const ok = await deps.rag.deleteDocument(auth.userId, request.params.id);
        if (!ok) return reply.status(404).send({ error: "Document not found" });
        return { deleted: true };
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{
    Body: { query: string; userId?: string; projectId?: string; limit?: number };
  }>("/rag/search", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      if (rejectClientUserId(reply, auth.userId, request.body.userId)) return;
      if (!request.body.query?.trim()) {
        return reply.status(400).send({ error: "query is required" });
      }
      const chunks = await deps.rag.search({
        userId: auth.userId,
        query: request.body.query,
        projectId: request.body.projectId,
        limit: request.body.limit,
      });
      return {
        chunks,
        context: deps.rag.buildProtectedContext(chunks),
      };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  // ——— Projects ———
  app.get("/projects", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      const q = request.query as { userId?: string };
      if (rejectClientUserId(reply, auth.userId, q.userId)) return;
      const projects = await deps.projects.list(auth.userId);
      return { projects };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{
    Body: {
      userId?: string;
      name: string;
      description?: string;
      workspaceId?: string;
    };
  }>("/projects", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      if (rejectClientUserId(reply, auth.userId, request.body.userId)) return;
      if (!request.body.name?.trim()) {
        return reply.status(400).send({ error: "name is required" });
      }
      const project = await deps.projects.create({
        userId: auth.userId,
        name: request.body.name,
        description: request.body.description,
        workspaceId: request.body.workspaceId,
      });
      return project;
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string }; Querystring: { userId?: string } }>(
    "/projects/:id/plan",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        if (rejectClientUserId(reply, auth.userId, request.query.userId)) return;
        if (!deps.projectPlanStore) {
          return reply.status(503).send({ error: "Project plan store not configured" });
        }
        const rec = await deps.projectPlanStore.getLatest({
          userId: auth.userId,
          projectId: request.params.id,
        });
        if (!rec) return reply.status(404).send({ error: "No project plan found" });
        return {
          projectId: rec.projectId,
          workspaceId: rec.workspaceId,
          classification: rec.classification,
          projectStatus: rec.projectStatus,
          plan: rec.plan,
          completeness: rec.verificationState,
          storageRefs: rec.storageRefs,
          updatedAt: rec.updatedAt,
        };
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { userId?: string } }>(
    "/projects/:id",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        if (rejectClientUserId(reply, auth.userId, request.query.userId)) return;
        const project = await deps.projects.get(auth.userId, request.params.id);
        if (!project) return reply.status(404).send({ error: "Project not found" });

        const memories = await deps.memory.listMemories(auth.userId, project.id);
        const documents = await deps.rag.listDocuments(auth.userId, project.id);

        return { project, memories, documents };
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      userId?: string;
      name?: string;
      description?: string;
      workspaceId?: string | null;
    };
  }>("/projects/:id", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      if (rejectClientUserId(reply, auth.userId, request.body.userId)) return;
      const project = await deps.projects.update(
        auth.userId,
        request.params.id,
        request.body,
      );
      if (!project) return reply.status(404).send({ error: "Project not found" });
      return project;
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string }; Querystring: { userId?: string } }>(
    "/projects/:id",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        if (rejectClientUserId(reply, auth.userId, request.query.userId)) return;
        const ok = await deps.projects.delete(auth.userId, request.params.id);
        if (!ok) return reply.status(404).send({ error: "Project not found" });
        return { deleted: true };
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );
}
