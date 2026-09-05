import type { FastifyInstance } from "fastify";
import type { CodingAgent, LocalWorkspaceManager } from "@personal-ai/coding-agent";
import type { Orchestrator } from "@personal-ai/orchestrator";
import { ToolPermissionLevel, type OrchestratorResult } from "@personal-ai/shared";
import type { PermissionManager } from "@personal-ai/tools";
import { AuthError, requireAuth } from "../auth/index.js";

interface OwnedTask {
  ownerUserId: string;
  result: OrchestratorResult;
}

const taskStore = new Map<string, OwnedTask>();

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  deps: {
    workspaces: LocalWorkspaceManager;
    codingAgent: CodingAgent;
    orchestrator: Orchestrator;
    permissions: PermissionManager;
    getActiveWorkspaceId: (userId: string) => string | undefined;
    setActiveWorkspaceId: (userId: string, id: string | undefined) => void;
  },
) {
  app.post<{ Body: { projectName?: string; userId?: string } }>(
    "/workspaces",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        // Ignore body.userId — AUTHENTICATED USER ID ≠ CLIENT-SUPPLIED userId
        if (request.body?.userId && request.body.userId !== auth.userId) {
          return reply.status(403).send({
            error: "Client userId does not match authenticated identity",
          });
        }
        const ws = await deps.workspaces.create(
          auth.userId,
          request.body?.projectName ?? "project",
        );
        deps.setActiveWorkspaceId(auth.userId, ws.id);
        return {
          id: ws.id,
          projectName: ws.projectName,
          expiresAt: ws.expiresAt,
          sandboxProvider: ws.sandboxProvider,
          status: ws.status,
          // LOCAL WORKSPACE ≠ CLOUD SANDBOX
          isolation: "path-boundary-only",
        };
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get("/workspaces", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      return {
        activeWorkspaceId: deps.getActiveWorkspaceId(auth.userId),
        workspaces: deps.workspaces.list(auth.userId).map((w) => ({
          id: w.id,
          projectName: w.projectName,
          expiresAt: w.expiresAt,
          status: w.status,
          sandboxProvider: w.sandboxProvider,
          createdAt: w.createdAt,
        })),
        note: "LOCAL WORKSPACE ≠ CLOUD SANDBOX — self-hosted path boundary only",
      };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>("/workspaces/:id", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      const ws = deps.workspaces.getOwned(request.params.id, auth.userId);
      if (!ws) {
        // Consistent 404 — do not leak existence of other users' workspaces
        return reply.status(404).send({ error: "Workspace not found" });
      }
      const files = ws.status === "active" ? await deps.workspaces.listFiles(ws.id) : [];
      return {
        id: ws.id,
        projectName: ws.projectName,
        expiresAt: ws.expiresAt,
        sandboxProvider: ws.sandboxProvider,
        status: ws.status,
        createdAt: ws.createdAt,
        userId: ws.userId,
        files,
      };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/workspaces/:id", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      const ws = deps.workspaces.getOwned(request.params.id, auth.userId);
      if (!ws) {
        return reply.status(404).send({ error: "Workspace not found" });
      }
      await deps.workspaces.destroy(ws.id);
      if (deps.getActiveWorkspaceId(auth.userId) === ws.id) {
        deps.setActiveWorkspaceId(auth.userId, undefined);
      }
      return { deleted: true };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/workspaces/:id/activate", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      const ws = deps.workspaces.getOwned(request.params.id, auth.userId);
      if (!ws || ws.status !== "active") {
        return reply.status(404).send({ error: "Workspace not found or inactive" });
      }
      deps.setActiveWorkspaceId(auth.userId, ws.id);
      return { activeWorkspaceId: ws.id };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  /**
   * Workspace exec — MUST pass auth, ownership, and EXECUTE permission.
   * LOCAL WORKSPACE ≠ CLOUD SANDBOX
   */
  app.post<{
    Params: { id: string };
    Body: { command: string };
  }>("/workspaces/:id/exec", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      const ws = deps.workspaces.getOwned(request.params.id, auth.userId);
      if (!ws || ws.status !== "active") {
        return reply.status(404).send({ error: "Workspace not found" });
      }

      const command = request.body?.command;
      if (!command || typeof command !== "string" || !command.trim()) {
        return reply.status(400).send({ error: "command is required" });
      }

      // Central permission check — EXECUTE (not HIGH_RISK bypass)
      await deps.permissions.assertAllowed(
        {
          name: "run_command",
          description: "Workspace HTTP exec",
          parameters: {},
          permissionLevel: ToolPermissionLevel.EXECUTE,
        },
        { command, workspaceId: ws.id },
      );

      const result = await deps.workspaces.exec(ws.id, command);
      return result;
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : String(err);
      if (/Permission denied|requires approval/i.test(message)) {
        return reply.status(403).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  });

  /**
   * Build/test verify + bounded auto-fix inside the workspace.
   * Maps pipeline outcomes through VerificationEngine.verifyGeneratedCode.
   * Generation success ≠ verification; NO_TESTS ≠ TESTS_PASSED.
   */
  app.post<{
    Params: { id: string };
    Body: { description?: string };
  }>("/workspaces/:id/verify", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      const ws = deps.workspaces.getOwned(request.params.id, auth.userId);
      if (!ws || ws.status !== "active") {
        return reply.status(404).send({ error: "Workspace not found" });
      }

      const coding = await deps.codingAgent.execute({
        workspaceId: ws.id,
        description: request.body?.description ?? "Verify workspace project",
      });

      const engineResult = deps.orchestrator.verificationEngine.verifyGeneratedCode({
        steps: (coding.verification?.steps ?? []).map((s) => ({
          name: s.name,
          passed: s.passed,
          details: s.details,
          outcome: s.outcome,
        })),
        passed: coding.verification?.passed,
        report: coding.verification?.report,
      });

      return {
        coding,
        verification: {
          status: engineResult.status,
          reason: engineResult.reason,
          checks: engineResult.checks,
          report: coding.verification?.report,
        },
        note: "CODE_EXECUTION_SUCCESS ≠ MODEL_QUALITY verified; security may be NOT_IMPLEMENTED",
      };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  app.get<{ Params: { id: string } }>("/tasks/:id", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      const task = taskStore.get(request.params.id);
      if (!task || task.ownerUserId !== auth.userId) {
        return reply.status(404).send({ error: "Task not found" });
      }
      return task.result;
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/cancel", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      const task = taskStore.get(request.params.id);
      if (!task || task.ownerUserId !== auth.userId) {
        return reply.status(404).send({ error: "Task not found" });
      }
      deps.orchestrator.cancel(request.params.id);
      return { cancelled: true, taskId: request.params.id };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });
}

export function storeTaskResult(result: OrchestratorResult, ownerUserId: string): void {
  taskStore.set(result.taskId, { ownerUserId, result });
}
