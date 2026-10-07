import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import EventEmitter from "events";
import { 
  MasterOrchestrator, 
  TaskManager
} from "@personal-ai/orchestrator";
import { type Task, type UserContext, TaskState, TaskClassification, ToolPermissionLevel } from "@personal-ai/shared";

// Create a global event emitter for task events
export const taskEvents = new EventEmitter();

export async function registerTasksRoutes(
  app: FastifyInstance,
  options: {
    orchestrator: MasterOrchestrator;
    taskManager: TaskManager;
  }
) {
  const { orchestrator, taskManager } = options;

  app.post("/tasks", async (req: FastifyRequest<{ Body: { goal: string, priority?: string, riskLevel?: string, userId?: string } }>, reply: FastifyReply) => {
    const { goal, priority = "MEDIUM", riskLevel = ToolPermissionLevel.READ, userId = "default-user" } = req.body;
    
    if (!goal) {
      return reply.code(400).send({ error: "Goal is required" });
    }

    const task: Task = {
      id: "task-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9),
      userId,
      goal,
      status: TaskState.PENDING,
      type: TaskClassification.MULTI_STEP,
      priority: priority as any,
      riskLevel: riskLevel as any,
      context: { userId, sessionId: "sess", currentDirectory: process.cwd() } as UserContext,
      createdAt: new Date(),
    };

    // Run in background
    orchestrator.orchestrate(task, {
      onEvent: (event: string, detail: any) => {
        taskEvents.emit("task-event", { taskId: task.id, event, detail });
      }
    }).catch((err: any) => {
      app.log.error({ err, taskId: task.id }, "Orchestration failed");
    });

    return reply.send({ task });
  });

  app.get("/tasks", async (_req, reply) => {
    const tasks = await taskManager.listTasks({ userId: "default-user" });
    return reply.send({ tasks });
  });

  app.get("/tasks/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const task = await taskManager.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: "Task not found" });
    return reply.send({ task });
  });

  app.get("/tasks/:id/observations", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const observations = await taskManager.listObservations(req.params.id);
    return reply.send({ observations });
  });

  app.get("/tasks/:id/events", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { id } = req.params;
    
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");

    const onEvent = (data: { taskId: string, event: string, detail: any }) => {
      if (data.taskId === id) {
        reply.raw.write(`event: ${data.event}\ndata: ${JSON.stringify(data.detail)}\n\n`);
      }
    };

    taskEvents.on("task-event", onEvent);

    req.raw.on("close", () => {
      taskEvents.removeListener("task-event", onEvent);
    });
  });

  app.post("/tasks/:id/cancel", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const task = await taskManager.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: "Task not found" });
    
    // Use the orchestrator's state machine or cancellation manager directly
    // Assuming orchestrator has cancellation injected
    if (orchestrator.cancellation) {
      orchestrator.cancellation.cancelTask(task, "User requested cancellation");
      task.status = TaskState.CANCELLED;
      await taskManager.updateTask(task);
      taskEvents.emit("task-event", { taskId: task.id, event: "TASK_CANCELLED", detail: { task } });
    }
    
    return reply.send({ task });
  });

  app.post("/tasks/:id/approve", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const task = await taskManager.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: "Task not found" });
    
    if (orchestrator.approval) {
      // Find latest pending approval for this task
      const res = await (taskManager as any).db.query(
        `SELECT id FROM personal_ai.task_approvals WHERE task_id = $1 AND status = 'PENDING' ORDER BY requested_at DESC LIMIT 1`,
        [task.id]
      );
      if (res.rows.length > 0) {
        await orchestrator.approval.handleApprovalResponse(task, res.rows[0].id, true);
        await taskManager.updateTask(task);
      }
    }
    
    return reply.send({ task });
  });

  app.post("/tasks/:id/reject", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const task = await taskManager.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: "Task not found" });
    
    if (orchestrator.approval) {
      const res = await (taskManager as any).db.query(
        `SELECT id FROM personal_ai.task_approvals WHERE task_id = $1 AND status = 'PENDING' ORDER BY requested_at DESC LIMIT 1`,
        [task.id]
      );
      if (res.rows.length > 0) {
        await orchestrator.approval.handleApprovalResponse(task, res.rows[0].id, false);
        task.status = TaskState.FAILED;
        task.error = "Task rejected by user";
        await taskManager.updateTask(task);
      }
    }
    
    return reply.send({ task });
  });
}
