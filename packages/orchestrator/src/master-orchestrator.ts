import type { Task, OrchestratorResult } from "@personal-ai/shared";
import { TaskState } from "@personal-ai/shared";
import type { DatabaseClient } from "@personal-ai/db";
import type { ProviderManager } from "@personal-ai/providers";
import { TaskStateMachine } from "./state-machine.js";
import { TaskManager } from "./task-manager.js";
import { AgentRouter, AgentRegistry } from "./router.js";
import { ContextManager } from "./context.js";
import { TaskPlanner } from "./planner.js";
import { TaskExecutor } from "./executor.js";
import { TaskVerifier } from "./verifier.js";
import { RecoveryManager } from "./recovery.js";
import { ApprovalManager } from "./approval.js";
import { CancellationManager } from "./cancellation.js";
import { BudgetManager, type BudgetConfig } from "./budget.js";
import type { ToolRegistry } from "@personal-ai/tools";
import type { AuditLogService } from "@personal-ai/audit";
import type { ContextEngine } from "@personal-ai/memory";

export class MasterOrchestrator {
  public stateMachine: TaskStateMachine;
  public taskManager: TaskManager;
  public agentRegistry: AgentRegistry;
  public router: AgentRouter;
  public contextManager: ContextManager;
  public planner: TaskPlanner;
  public executor: TaskExecutor;
  public verifier: TaskVerifier;
  public recovery: RecoveryManager;
  public approval: ApprovalManager;
  public cancellation: CancellationManager;
  public budget: BudgetManager;
  public audit: AuditLogService;

  constructor(registry: ToolRegistry, budgetConfig: BudgetConfig, db: DatabaseClient, providerManager: ProviderManager, audit: AuditLogService, contextEngine?: ContextEngine) {
    this.taskManager = new TaskManager(db);
    this.stateMachine = new TaskStateMachine(this.taskManager);
    this.agentRegistry = new AgentRegistry();
    this.router = new AgentRouter(this.agentRegistry);
    this.contextManager = new ContextManager(registry, contextEngine);
    this.planner = new TaskPlanner(providerManager);
    this.executor = new TaskExecutor(registry, providerManager);
    this.verifier = new TaskVerifier(providerManager);
    this.budget = new BudgetManager(budgetConfig);
    this.recovery = new RecoveryManager(this.budget);
    this.approval = new ApprovalManager(this.stateMachine, db);
    this.cancellation = new CancellationManager(this.stateMachine);
    this.audit = audit;
  }

  async orchestrate(task: Task, options?: { onEvent?: (event: string, detail: any) => void }): Promise<OrchestratorResult> {
    const emit = (event: string, detail: any = {}) => {
      if (options?.onEvent) options.onEvent(event, detail);
    };
    
    // This is the new cleanly isolated execution loop for Phase 1.
    // Core states: PENDING -> ANALYZING -> PLANNING -> EXECUTING -> VERIFYING -> COMPLETED/FAILED
    
    await this.taskManager.createTask(task);
    emit("TASK_CREATED", { task });
    let attemptCount = 0;

    try {
      await this.stateMachine.transition(task, TaskState.ANALYZING);
      emit("TASK_ANALYZING", { task });
      await this.taskManager.updateTask(task);
      
      const routeResult = await this.router.route(task);
      const agentContext = await this.contextManager.buildAgentContext(task, task.context);
      agentContext.signal = this.cancellation.getSignal(task.id);
      
      if (!routeResult.agent) {
        // Fallback to internal planning if no specialized agent
        await this.stateMachine.transition(task, TaskState.PLANNING);
        emit("TASK_PLANNING", { task });
        await this.taskManager.updateTask(task);
        
        task.plan = await this.planner.createPlan(agentContext);
        const valid = await this.planner.validatePlan(task.plan);
        if (!valid) {
          throw new Error("Plan validation failed");
        }
      } else {
        // Agent handles planning
        await this.stateMachine.transition(task, TaskState.PLANNING);
        emit("TASK_PLANNING", { task });
        await this.taskManager.updateTask(task);
        task.plan = await routeResult.agent.plan(agentContext);
      }
      
      await this.audit.record({
        userId: task.userId,
        taskId: task.id,
        event: "PLAN_CREATED",
        detail: { plan: task.plan, routingReason: routeResult.reason }
      });
      emit("PLAN_CREATED", { plan: task.plan });
      
      await this.stateMachine.transition(task, TaskState.EXECUTING);
      emit("TASK_EXECUTING", { task });
      await this.taskManager.updateTask(task);
      
      for (const step of task.plan.steps) {
        if (task.status === TaskState.CANCELLED) break;
        
        const result = await this.executor.executeStep(agentContext, step);
        if (!result.success && result.error === "Approval required") {
          await this.stateMachine.transition(task, TaskState.WAITING_FOR_APPROVAL);
          await this.taskManager.updateTask(task);
          emit("APPROVAL_REQUESTED", { task, step });
          return {
            taskId: task.id,
            goal: task.goal,
            plan: task.plan!,
            observations: [],
            verifications: [],
            events: [],
            finalResponse: "Waiting for user approval",
            retriesUsed: attemptCount,
            status: "waiting_for_approval",
            completedAt: new Date()
          };
        }

        await this.audit.record({
          userId: task.userId,
          taskId: task.id,
          event: "TOOL_EXECUTED",
          detail: { step, success: result.success }
        });
        emit("TOOL_EXECUTED", { step, success: result.success });

        emit("VERIFICATION_STARTED", { step });
        const verification = await this.verifier.verifyResult(agentContext, result);
        await this.audit.record({
          userId: task.userId,
          taskId: task.id,
          event: verification.passed ? "VERIFICATION_PASSED" : "VERIFICATION_FAILED",
          detail: { verification }
        });
        emit(verification.passed ? "VERIFICATION_PASSED" : "VERIFICATION_FAILED", { verification });
        
        if (!verification.passed) {
          emit("RECOVERY_STARTED", { reason: verification.reason });
          task.status = await this.recovery.attemptRecovery(task, verification.reason, attemptCount++);
          if (task.status === TaskState.RETRYING) {
             emit("RETRY_STARTED", { attempt: attemptCount });
          }
          if (task.status === TaskState.FAILED) {
            throw new Error(`Task failed at step: ${step.description}`);
          }
        }
      }
      
      if (task.status !== TaskState.CANCELLED) {
        await this.stateMachine.transition(task, TaskState.VERIFYING);
        emit("TASK_VERIFYING", { task });
        await this.taskManager.updateTask(task);
        
        await this.stateMachine.transition(task, TaskState.COMPLETED);
        await this.audit.record({
          userId: task.userId,
          taskId: task.id,
          event: "TASK_COMPLETED",
          detail: { success: true }
        });
        emit("TASK_COMPLETED", { task });
      } else {
        emit("TASK_CANCELLED", { task });
      }
      
    } catch (err: any) {
      if (task.status !== TaskState.CANCELLED) {
         task.error = err.message;
         task.status = TaskState.FAILED;
         await this.audit.record({
           userId: task.userId,
           taskId: task.id,
           event: "TASK_FAILED",
           detail: { error: err.message }
         });
         emit("TASK_FAILED", { error: err.message, task });
      } else {
        emit("TASK_CANCELLED", { task });
      }
    } finally {
      this.cancellation.cleanup(task.id);
    }
    
    await this.taskManager.updateTask(task);
    
    return {
      taskId: task.id,
      goal: task.goal,
      plan: task.plan!,
      observations: [],
      verifications: [],
      events: [],
      finalResponse: task.status === TaskState.COMPLETED ? "Success" : (task.error || "Failed"),
      retriesUsed: attemptCount,
      status: task.status === TaskState.COMPLETED ? "completed" : (task.status === TaskState.CANCELLED ? "cancelled" : "failed"),
      completedAt: new Date()
    };
  }
}
