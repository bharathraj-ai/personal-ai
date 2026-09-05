import type { ModelAdapter } from "@personal-ai/ai-core";
import type { ProviderManager } from "@personal-ai/providers";
import {
  OrchestratorPhase,
  ToolPermissionLevel,
  type ApprovalRequest,
  type Evidence,
  type Message,
  type OrchestrationEvent,
  type OrchestratorResult,
  type Plan,
  type PlanStep,
  type ProviderCapability,
  type RequestScale,
  type StepObservation,
  type ToolDefinition,
  type UserContext,
  type VerificationResult,
} from "@personal-ai/shared";
import type { ToolRegistry } from "@personal-ai/tools";
import {
  classifyEvidenceNeed,
  requiresExternalEvidence,
  specialistCapabilityFor,
  type EvidenceNeed,
} from "./verification/evidence-need.js";
import { VerificationEngine, UNVERIFIED_NOTICE } from "./verification/engine.js";
import { hasAdequateEvidence } from "./verification/evidence.js";
import { evidenceFromToolResult, mergeEvidence } from "./verification/from-tools.js";
import { enrichWebEvidence } from "./verification/internet-collector.js";
import {
  applyVerificationPolicy,
  extractLeadAnswer,
  formatEvidenceAnswerWithoutModel,
  formatEvidenceForModel,
  isUnusableAssistantAnswer,
  sanitizeUserFacingAnswer,
} from "./verification/policy.js";
import { analyzeConversation } from "./conversation-intent.js";
import {
  extractProjectName,
  inferRevisionBootstrapKind,
  isProjectResumeRequest,
  isProjectRevisionRequest,
  isWebsiteGoal,
  normalizeWebsiteGoalTypos,
  oceanTemperatureProjectFiles,
  resolveBootstrapKind,
  shouldCodingBootstrap,
  shouldUseTemplateBootstrap,
  websiteProjectFiles,
  schoolManagementProjectFiles,
  type BootstrapKind,
} from "./coding-bootstrap.js";
import {
  analyzeRequirements,
  buildImplementationPlan,
  formatImplementationPlanForUser,
  formatClarificationAnswersForPlan,
  hasClarificationAnswers,
  isLargeImplementationRequest,
  mergeClarificationAnswers,
} from "./requirement-analysis.js";
import type {
  ArchitectureDecisions,
  ClarificationQuestion,
  CompletenessReport,
  ImplementationPlan,
  ProjectPlan,
} from "@personal-ai/shared";
import { classifyRequest } from "./request-classification.js";
import {
  classifyCodingTask,
  codingAgentPlanReasoning,
} from "./coding-task.js";
import { requiresFullImplementationPipeline } from "./implementation-gate.js";
import { budgetPlanningUserContent, SHORT_PLANNING_PROMPT } from "./context-budget.js";
import { buildProjectPlan } from "./project-plan.js";
import { evaluateCompleteness, orchestratorStatusFor } from "./completeness-guard.js";
import { evaluateRequirementEvidence } from "./requirement-evidence.js";
import { formatProjectCompletionReport } from "./project-report.js";
import { formatPlanSummaryForCoding } from "./coding-plan-context.js";
import {
  buildImplementationSchedule,
  manifestFromPlan,
} from "./implementation-schedule.js";
import {
  applyConstraintsToArchitecture,
  deriveArchitectureConstraints,
  constraintsSummary,
} from "./architecture-constraints.js";
import {
  freezeApprovedPlan,
  canResumeStoredProject,
  resolveApprovedPlanForRun,
  validateProjectPlan,
} from "./plan-validation.js";
import { decideFramework, formatFrameworkNotice } from "./framework-decision.js";
import { runSearchPipeline } from "./search-pipeline.js";
import { analyzeSearchIntent } from "./search-intent.js";
import type { SearchDebugTrace } from "@personal-ai/shared";

export interface OrchestratorConfig {
  maxRetries: number;
  stepTimeoutMs?: number;
  planningSystemPrompt?: string;
}

export interface OrchestratorDependencies {
  model: ModelAdapter;
  tools: ToolRegistry;
  /** Optional — when set, specialist tasks route through ProviderManager (never bypass Orchestrator). */
  providerManager?: ProviderManager;
  verificationEngine?: VerificationEngine;
  onPhaseChange?: (phase: OrchestratorPhase, detail?: string) => void;
  onEvent?: (event: OrchestrationEvent) => void;
  onApprovalRequired?: (request: ApprovalRequest) => Promise<boolean>;
  /** Resume: load persisted framework/language so the Orchestrator does not ask again. */
  getStoredArchitecture?: (ctx: UserContext) => Promise<ArchitectureDecisions | undefined>;
  /** CodingAgent on the hot path for FULL_APPLICATION (not static templates). */
  codingAgent?: {
    implement(input: {
      workspaceId: string;
      goal: string;
      overwriteExisting?: boolean;
      planSummary?: string;
      requestScale?: RequestScale;
      resume?: boolean;
      schedule?: Array<{
        id: string;
        name: string;
        dependsOn: string[];
        requirements: string[];
        fileHints: string[];
        acceptance: string[];
      }>;
      fileManifest?: {
        project: string;
        files: Array<{ path: string; purpose: string; module: string }>;
      };
      completedModuleIds?: string[];
    }): Promise<{
      success: boolean;
      summary: string;
      filesCreated?: string[];
      errors?: string[];
      patchesApplied?: string[];
      moduleProgress?: Array<{ id: string; name: string; status: string; files: string[] }>;
      inspection?: { summary?: string; files?: string[]; framework?: string };
      verification?: {
        passed: boolean;
        steps: Array<{ name: string; passed: boolean; details?: string; outcome?: string }>;
        report?: { status?: string; build?: string; tests?: string; security?: string };
      };
      waitingForProvider?: { retryAt?: string; reason: string };
      repairHistory?: Array<{
        repairAttempt: number;
        provider?: string;
        filesChanged: string[];
        error: string;
        result: "PASSED" | "FAILED" | "PARTIAL" | "NO_PATCH";
      }>;
    }>;
  };
  persistProjectPlan?: (input: {
    context: UserContext;
    taskId: string;
    workspaceId?: string;
    plan: ProjectPlan;
    classification: RequestScale;
    completeness?: CompletenessReport;
  }) => Promise<void>;
  getStoredProject?: (ctx: UserContext) => Promise<{
    workspaceId?: string | null;
    plan: ProjectPlan;
    projectId?: string | null;
  } | null>;
  /** Restore workspace files from durable storage into the same workspace id. */
  restoreProjectWorkspace?: (input: {
    userId: string;
    projectId: string;
    projectName: string;
    sourceWorkspaceId: string;
  }) => Promise<{
    workspaceId: string;
    restored: number;
    errors: string[];
    status: "RESTORED" | "REUSED_LOCAL" | "RESTORE_FAILED";
  }>;
  isWorkspaceActive?: (userId: string, workspaceId: string) => boolean;
  artifactStorageLabel?: string;
}

export interface RunOptions {
  goal: string;
  /** Original user message — used for resume detection before goal resolution. */
  triggerMessage?: string;
  context: UserContext;
  history?: Message[];
  taskId?: string;
  signal?: AbortSignal;
  /** Skip clarify/plan gate (internal/testing only) */
  skipImplementationGate?: boolean;
}

const PLACEHOLDER_TOOLS = new Set([
  "optional_tool_name",
  "tool_name",
  "toolname",
  "none",
  "null",
  "undefined",
]);

/**
 * Core orchestrator: Goal -> Plan -> Execute -> Observe -> Verify -> Retry/Fix -> Result
 * Evidence-required questions collect search/fetch/RAG evidence before answering.
 */
export class Orchestrator {
  private readonly cancelled = new Set<string>();
  private readonly engine: VerificationEngine;
  private lastSearchDebug: SearchDebugTrace | undefined;
  private conversationEntity?: string;

  constructor(
    private readonly deps: OrchestratorDependencies,
    private readonly config: OrchestratorConfig = { maxRetries: 3, stepTimeoutMs: 120_000 },
  ) {
    this.engine = deps.verificationEngine ?? new VerificationEngine();
  }

  get verificationEngine(): VerificationEngine {
    return this.engine;
  }

  getLastSearchDebug(): SearchDebugTrace | undefined {
    return this.lastSearchDebug;
  }

  getConversationEntity(): string | undefined {
    return this.conversationEntity ?? this.lastSearchDebug?.resolved_entity;
  }

  setConversationEntity(entity?: string): void {
    const t = entity?.trim();
    if (t) this.conversationEntity = t;
  }

  cancel(taskId: string): void {
    this.cancelled.add(taskId);
  }

  /** Intent → generated queries → DuckDuckGo → extract_content → evidence. */
  async gatherEvidenceForQuery(
    query: string,
    opts?: {
      forceWeb?: boolean;
      history?: Array<{ role: string; content: string }>;
      lastEntity?: string;
    },
  ): Promise<Evidence[]> {
    const analysis = analyzeConversation(query, {
      history: opts?.history,
      lastEntity: opts?.lastEntity ?? this.conversationEntity,
      modelReady: true,
    });
    const q = analysis.resolvedQuery || query;
    if (analysis.entity) this.conversationEntity = analysis.entity;

    const need = classifyEvidenceNeed(q);
    let evidence: Evidence[] = [];

    if (need.web || need.timeSensitive || opts?.forceWeb) {
      const pipeline = await runSearchPipeline(q, this.deps.tools, {
        forceWeb: opts?.forceWeb,
        context: {
          history: opts?.history,
          lastEntity: opts?.lastEntity ?? this.conversationEntity,
        },
      });
      this.lastSearchDebug = pipeline.debug;
      evidence = mergeEvidence(evidence, pipeline.evidence);
      const preview = extractLeadAnswer(q, evidence);
      if (this.lastSearchDebug) {
        this.lastSearchDebug.final_answer_preview = preview?.slice(0, 240);
      }
      if (pipeline.debug.resolved_entity) {
        this.conversationEntity = pipeline.debug.resolved_entity;
      }
    }
    if (need.rag && this.deps.tools.get("search_documents")) {
      const rag = await this.deps.tools.execute("search_documents", { query });
      evidence = mergeEvidence(evidence, evidenceFromToolResult("search_documents", rag));
    }
    if (need.memory && this.deps.tools.get("search_memory")) {
      const mem = await this.deps.tools.execute("search_memory", { query });
      evidence = mergeEvidence(evidence, evidenceFromToolResult("search_memory", mem));
    }

    return evidence;
  }

  async run(options: RunOptions): Promise<OrchestratorResult> {
    const { history = [], triggerMessage } = options;
    const goal = normalizeWebsiteGoalTypos(options.goal);
    let context = { ...options.context };
    if (context.forceNewProject) {
      context = {
        ...context,
        workspaceId: undefined,
        projectId: undefined,
        architecture: undefined,
        clarificationAnswers: undefined,
        implementationApproved: context.implementationApproved,
      };
    }
    const taskId = options.taskId ?? crypto.randomUUID();
    const observations: StepObservation[] = [];
    const verifications: VerificationResult[] = [];
    const events: OrchestrationEvent[] = [];
    let retriesUsed = 0;
    let status: OrchestratorResult["status"] = "completed";
    const need = classifyEvidenceNeed(goal);
    const evidenceRequired = requiresExternalEvidence(goal);

    const pushEvent = (partial: Omit<OrchestrationEvent, "taskId" | "timestamp">) => {
      const event: OrchestrationEvent = {
        taskId,
        timestamp: new Date(),
        ...partial,
      };
      events.push(event);
      this.deps.onEvent?.(event);
    };

    // Resume persisted project instead of starting over (state-based — never re-clarify approved work)
    const resumeMessage = triggerMessage ?? goal;
    const resumeRequested =
      isProjectResumeRequest(resumeMessage) &&
      Boolean(this.deps.getStoredProject) &&
      !context.forceNewProject;

    if (resumeRequested) {
      const stored = await this.deps.getStoredProject!({
        ...context,
        projectId: context.projectId,
      });
      const canResume = stored
        ? canResumeStoredProject(stored.plan.implementationProgress, {
            hasWorkspace: Boolean(stored.workspaceId ?? context.workspaceId),
          })
        : false;

      if (stored && canResume) {
        let workspaceId = stored.workspaceId ?? context.workspaceId ?? undefined;
        const projectId = stored.projectId ?? context.projectId ?? taskId;
        const projectName =
          stored.plan.project.name || extractProjectName(stored.plan.goal ?? goal);
        const storedWsId = stored.workspaceId ?? undefined;

        if (
          storedWsId &&
          (this.deps.isWorkspaceActive?.(context.userId, storedWsId) ?? false)
        ) {
          workspaceId = storedWsId;
          pushEvent({
            phase: OrchestratorPhase.EXECUTE,
            event: "TOOL_EXECUTED",
            tool: "restore_workspace",
            status: "completed",
            detail: `Reusing active local workspace ${storedWsId}`,
          });
        } else if (this.deps.restoreProjectWorkspace && storedWsId) {
          pushEvent({
            phase: OrchestratorPhase.EXECUTE,
            event: "TOOL_SELECTED",
            tool: "restore_workspace",
            status: "started",
            detail: `Restoring from storage (source workspace ${storedWsId})`,
          });
          const restored = await this.deps.restoreProjectWorkspace({
            userId: context.userId,
            projectId,
            projectName,
            sourceWorkspaceId: storedWsId,
          });
          workspaceId = restored.workspaceId;
          if (restored.status === "RESTORE_FAILED") {
            pushEvent({
              phase: OrchestratorPhase.EXECUTE,
              event: "TOOL_EXECUTED",
              tool: "restore_workspace",
              status: "failed",
              detail: restored.errors.join("; ") || "RESTORE_FAILED",
            });
            return {
              taskId,
              goal: resumeMessage,
              plan: { goal: resumeMessage, steps: [], reasoning: "RESTORE_FAILED" },
              observations,
              verifications,
              events,
              finalResponse:
                restored.errors.join("; ") ||
                "RESTORE_FAILED: workspace artifacts could not be restored",
              retriesUsed: 0,
              status: "failed",
              completedAt: new Date(),
            };
          }
          pushEvent({
            phase: OrchestratorPhase.EXECUTE,
            event: "TOOL_EXECUTED",
            tool: "restore_workspace",
            status: restored.errors.length ? "failed" : "completed",
            detail:
              restored.status === "REUSED_LOCAL"
                ? `Reused local workspace ${storedWsId}`
                : `Restored ${restored.restored} file(s) into ${storedWsId}${restored.errors.length ? ` (${restored.errors.length} errors)` : ""}`,
          });
        }

        if (!workspaceId) {
          return {
            taskId,
            goal: resumeMessage,
            plan: { goal: resumeMessage, steps: [], reasoning: "RESUME_INCOMPLETE" },
            observations,
            verifications,
            events,
            finalResponse:
              "RESUME_INCOMPLETE: persisted project has no workspaceId and workspace could not be restored.",
            retriesUsed: 0,
            status: "failed",
            completedAt: new Date(),
          };
        }

        if (!this.deps.codingAgent) {
          return {
            taskId,
            goal: resumeMessage,
            plan: { goal: resumeMessage, steps: [], reasoning: "RESUME_NO_CODING_AGENT" },
            observations,
            verifications,
            events,
            finalResponse:
              "RESUME_FAILED: CodingAgent is not wired — cannot continue implementation.",
            retriesUsed: 0,
            status: "failed",
            completedAt: new Date(),
          };
        }

        context = {
          ...context,
          workspaceId,
          projectId,
          architecture: stored.plan.architecture ?? context.architecture,
          implementationApproved: true,
        };
        const resumeGoal =
          stored.plan.goal?.trim() ||
          stored.plan.project.description?.trim() ||
          stored.plan.project.name ||
          goal;
        const resolvedPlan = resolveApprovedPlanForRun(stored.plan);
        const approved = resolvedPlan.plan.implementationProgress?.approvedPlan;
        const implementationPlan: ImplementationPlan = {
          objective: resumeGoal,
          architecture: stored.plan.architecture
            ? `${stored.plan.architecture.framework} + ${stored.plan.architecture.language}`
            : "Resume existing project",
          components: resolvedPlan.plan.modules.map((m) => m.name),
          scope: classifyRequest(resumeGoal),
          projectPlan: resolvedPlan.plan,
          architectureDecisions: stored.plan.architecture,
          ...(approved?.implementationPlan
            ? { ...approved.implementationPlan, projectPlan: resolvedPlan.plan }
            : {}),
        };
        pushEvent({
          phase: OrchestratorPhase.EXECUTE,
          event: "APPROVAL_GRANTED",
          status: "completed",
          detail: "Resume — using frozen approved plan (no re-planning)",
        });
        return this.runCodingAgentImplementation({
          taskId,
          goal: resumeGoal,
          plan: {
            goal: resumeGoal,
            steps: [],
            reasoning: "Resume existing project via CodingAgent",
          },
          observations,
          verifications,
          events,
          context,
          pushEvent,
          implementationPlan,
          resume: true,
        });
      }

      const reason = !stored
        ? "RESUME_NOT_FOUND: no persisted project for the requested projectId."
        : "RESUME_NOT_READY: persisted project lacks approved plan and is not in a resumable lifecycle state.";
      return {
        taskId,
        goal: resumeMessage,
        plan: { goal: resumeMessage, steps: [], reasoning: reason },
        observations,
        verifications,
        events,
        finalResponse: reason,
        retriesUsed: 0,
        status: "failed",
        completedAt: new Date(),
      };
    }

    // Revise an existing workspace
    if (context.workspaceId && isProjectRevisionRequest(goal)) {
      const revisionKind = inferRevisionBootstrapKind(goal, history);
      if (this.deps.codingAgent && (!revisionKind || !shouldUseTemplateBootstrap(revisionKind, goal, context.clarificationAnswers))) {
        return this.runCodingAgentImplementation({
          taskId,
          goal,
          plan: { goal, steps: [], reasoning: "Project revision via CodingAgent" },
          observations,
          verifications,
          events,
          context,
          pushEvent,
          implementationPlan: undefined,
        });
      }
      if (revisionKind && shouldUseTemplateBootstrap(revisionKind, goal, context.clarificationAnswers)) {
        return this.codingBootstrapResult({
          taskId,
          goal: history.find((h) => isLargeImplementationRequest(h.content))?.content ?? goal,
          plan: { goal, steps: [], reasoning: "Project revision in existing workspace" },
          observations,
          verifications,
          events,
          context,
          pushEvent,
          bootstrapKind: revisionKind,
          clarificationAnswers: context.clarificationAnswers,
        });
      }
    }

    if (
      (isLargeImplementationRequest(goal) || requiresFullImplementationPipeline(goal)) &&
      !options.skipImplementationGate
    ) {
      return this.runLargeImplementationFlow({
        taskId,
        goal,
        history,
        context,
        events,
        pushEvent,
      });
    }

    const codingClass = classifyCodingTask(goal);
    if (codingClass && codingClass !== "FULL_APPLICATION" && this.deps.codingAgent) {
      this.emitPhase(OrchestratorPhase.PLAN);
      const plan = {
        goal,
        steps: [
          {
            id: "implement",
            description: "CodingAgent implements validated structured files",
            successCriteria: "Workspace files exist and build/tests run",
          },
        ],
        reasoning: codingAgentPlanReasoning(codingClass),
      };
      pushEvent({
        phase: OrchestratorPhase.PLAN,
        event: "PLAN_CREATED",
        status: "completed",
        detail: plan.reasoning,
      });
      return this.runCodingAgentImplementation({
        taskId,
        goal,
        plan,
        observations,
        verifications,
        events,
        context,
        pushEvent,
        implementationPlan: undefined,
      });
    }

    this.emitPhase(OrchestratorPhase.PLAN);
    pushEvent({
      phase: OrchestratorPhase.PLAN,
      event: "PLAN_CREATED",
      status: "started",
      detail: goal,
    });

    const plan = await this.createPlan(goal, history, context, need);
    pushEvent({
      phase: OrchestratorPhase.PLAN,
      event: "PLAN_CREATED",
      status: plan.reasoning?.startsWith("Model unavailable") ? "failed" : "completed",
      detail: plan.reasoning?.startsWith("Model unavailable")
        ? plan.reasoning
        : `${plan.steps.length} steps`,
    });

    const specialistCap = specialistCapabilityFor(goal);

    if (plan.reasoning?.startsWith("Model unavailable")) {
      if (need.localTime && this.deps.tools.get("get_current_time")) {
        return this.localTimeOnlyResult({
          taskId,
          goal,
          plan,
          observations,
          verifications,
          events,
          pushEvent,
        });
      }
      if (evidenceRequired) {
        return this.evidenceOnlyResult({
          taskId,
          goal,
          plan,
          observations,
          verifications,
          events,
          need,
          evidenceRequired,
          pushEvent,
        });
      }
      if (shouldUseTemplateBootstrap(resolveBootstrapKind(goal, context.clarificationAnswers), goal, context.clarificationAnswers)) {
        return this.codingBootstrapResult({
          taskId,
          goal,
          plan,
          observations,
          verifications,
          events,
          context,
          pushEvent,
        });
      }
      if (this.deps.codingAgent && (need.coding || classifyRequest(goal) === "FULL_APPLICATION")) {
        return this.runCodingAgentImplementation({
          taskId,
          goal,
          plan,
          observations,
          verifications,
          events,
          context,
          pushEvent,
          implementationPlan: undefined,
        });
      }
      if (shouldCodingBootstrap(goal, need)) {
        return this.codingBootstrapResult({
          taskId,
          goal,
          plan,
          observations,
          verifications,
          events,
          context,
          pushEvent,
        });
      }
      status = "failed";
      pushEvent({
        phase: OrchestratorPhase.FAILED,
        event: "TASK_FAILED",
        status: "failed",
        error: plan.reasoning,
      });
      return {
        taskId,
        goal,
        plan,
        observations,
        verifications,
        events,
        finalResponse:
          "Orchestrate needs Bharath model weights loaded. Switch to Chat for search and local file actions, or load a checkpoint under Documents/model.",
        retriesUsed: 0,
        status,
        completedAt: new Date(),
      };
    }

    // Auto-provision workspace for coding goals before tool steps
    if ((need.coding || need.localAction) && !context.workspaceId && this.deps.tools.get("create_workspace")) {
      const projectName = extractProjectName(goal);
      const created = await this.deps.tools.execute("create_workspace", { projectName });
      observations.push({
        stepId: "ensure-workspace",
        output: created,
        durationMs: 0,
        timestamp: new Date(),
      });
      const out = created.output as { workspaceId?: string } | null;
      if (created.success && out?.workspaceId) {
        context = { ...context, workspaceId: out.workspaceId };
        pushEvent({
          phase: OrchestratorPhase.EXECUTE,
          event: "TOOL_EXECUTED",
          tool: "create_workspace",
          status: "completed",
          detail: `workspace ${out.workspaceId} (${projectName})`,
        });
      }
    }

    // Specialist routing (code_review / code_fix / coding) — never for normal chat
    if (specialistCap && this.deps.providerManager) {
      const specialistObs = await this.runSpecialist(
        goal,
        specialistCap,
        context,
        history,
        pushEvent,
      );
      observations.push(specialistObs.observation);
      verifications.push(specialistObs.verification);
      if (!specialistObs.verification.passed && specialistObs.fatal) {
        status = "failed";
      }
    }

    for (const step of this.topologicalSort(plan.steps)) {
      if (this.cancelled.has(taskId) || options.signal?.aborted) {
        status = "cancelled";
        pushEvent({ phase: OrchestratorPhase.FAILED, stepId: step.id, status: "failed", error: "Cancelled" });
        break;
      }

      let verified = false;
      const toolArgs = {
        ...(step.toolArgs ?? {}),
        ...(context.workspaceId && !step.toolArgs?.workspaceId
          ? { workspaceId: context.workspaceId }
          : {}),
      };
      const stepWithArgs = { ...step, toolArgs };

      while (!verified && retriesUsed <= this.config.maxRetries) {
        this.emitPhase(OrchestratorPhase.EXECUTE, step.description);
        pushEvent({
          phase: OrchestratorPhase.EXECUTE,
          event: step.toolName ? "TOOL_SELECTED" : undefined,
          stepId: step.id,
          tool: step.toolName,
          status: "started",
          detail: step.description,
          retryCount: retriesUsed,
        });

        const observation = await this.executeStep(stepWithArgs, pushEvent, {
          specialistCap,
          goal,
          history,
        });
        observations.push(observation);
        pushEvent({
          phase: OrchestratorPhase.EXECUTE,
          event: step.toolName ? "TOOL_EXECUTED" : undefined,
          stepId: step.id,
          tool: step.toolName,
          status: "completed",
          detail: step.description,
          durationMs: observation.durationMs,
          retryCount: retriesUsed,
        });

        this.emitPhase(OrchestratorPhase.OBSERVE);
        this.emitPhase(OrchestratorPhase.VERIFY, step.successCriteria);
        pushEvent({
          phase: OrchestratorPhase.VERIFY,
          event: "VERIFICATION_STARTED",
          stepId: step.id,
          tool: step.toolName,
          status: "started",
          detail: step.successCriteria,
        });
        const verification = this.engine.verifyToolResult(step, observation);
        verifications.push(verification);

        pushEvent({
          phase: OrchestratorPhase.VERIFY,
          event: verification.passed ? "VERIFICATION_PASSED" : "VERIFICATION_FAILED",
          stepId: step.id,
          tool: step.toolName,
          status: verification.passed ? "completed" : "failed",
          detail: verification.details ?? verification.reason,
          durationMs: observation.durationMs,
          retryCount: retriesUsed,
          error: verification.passed ? undefined : verification.details,
        });

        const fatal =
          typeof observation.output === "object" &&
          observation.output !== null &&
          (observation.output as { fatal?: boolean }).fatal === true;

        if (verification.passed) {
          verified = true;
        } else if (!fatal && retriesUsed < this.config.maxRetries) {
          // Coding build/test failures: attempt specialist-backed auto-fix once per retry
          if (
            (step.toolName === "run_build" || step.toolName === "run_tests") &&
            this.deps.providerManager &&
            context.workspaceId
          ) {
            const fixed = await this.attemptCodeFix(
              context.workspaceId,
              observation,
              retriesUsed + 1,
              pushEvent,
            );
            if (fixed) {
              observations.push(fixed);
            }
          }
          this.emitPhase(OrchestratorPhase.RETRY, verification.details);
          pushEvent({
            phase: OrchestratorPhase.RETRY,
            event: "RETRY_STARTED",
            stepId: step.id,
            status: "retry",
            detail: verification.details,
            retryCount: retriesUsed,
          });
          retriesUsed++;
        } else {
          break;
        }
      }

      if (!verifications.at(-1)?.passed) {
        // Evidence-required search failures should not invent an answer; continue to policy.
        if (!(evidenceRequired && step.toolName === "search_web")) {
          this.emitPhase(OrchestratorPhase.FAILED, step.id);
          status = "failed";
          pushEvent({
            phase: OrchestratorPhase.FAILED,
            stepId: step.id,
            status: "failed",
            error: verifications.at(-1)?.details ?? "Step failed",
          });
          break;
        }
      }
    }

    let evidence = collectEvidenceFromObservations(observations, plan.steps);
    if (need.web || need.timeSensitive) {
      this.emitPhase(OrchestratorPhase.VERIFY, "fetch source pages");
      evidence = await enrichWebEvidence(evidence, this.deps.tools);
      if (!hasAdequateEvidence(evidence)) {
        const pipeline = await runSearchPipeline(goal, this.deps.tools);
        this.lastSearchDebug = pipeline.debug;
        evidence = mergeEvidence(evidence, pipeline.evidence);
      }
    }
    pushEvent({
      phase: OrchestratorPhase.VERIFY,
      event: "EVIDENCE_COLLECTED",
      status: "completed",
      detail: `${evidence.length} evidence items`,
    });

    const preCheck = this.engine.verifyFactualClaims({
      question: goal,
      evidence,
      evidenceRequired,
      timeSensitive: need.timeSensitive,
    });

    // COMPLETE only after final answer verification (never before VERIFY)
    let finalResponse: string;
    let answerVerification: VerificationResult;

    pushEvent({
      phase: OrchestratorPhase.VERIFY,
      event: "VERIFICATION_STARTED",
      status: "started",
      detail: "final answer verification",
    });

    if (evidenceRequired && !hasAdequateEvidence(evidence)) {
      finalResponse = UNVERIFIED_NOTICE;
      answerVerification = this.engine.verifyFactualClaims({
        question: goal,
        draftAnswer: finalResponse,
        evidence,
        evidenceRequired,
        timeSensitive: need.timeSensitive,
      });
    } else {
      finalResponse = await this.synthesizeResult(
        goal,
        plan,
        observations,
        verifications,
        status,
        evidence,
        preCheck,
        evidenceRequired,
      );
      answerVerification = this.engine.verifyFactualClaims({
        question: goal,
        draftAnswer: finalResponse,
        evidence,
        evidenceRequired,
        timeSensitive: need.timeSensitive,
      });
      finalResponse = applyVerificationPolicy(finalResponse, answerVerification, evidenceRequired);
    }

    pushEvent({
      phase: OrchestratorPhase.VERIFY,
      event:
        answerVerification.status === "failed" || answerVerification.status === "uncertain"
          ? "VERIFICATION_FAILED"
          : "VERIFICATION_PASSED",
      status: answerVerification.status === "failed" ? "failed" : "completed",
      detail: `answer ${answerVerification.status}: ${answerVerification.reason}`,
    });

    if (status === "completed") {
      this.emitPhase(OrchestratorPhase.COMPLETE);
      pushEvent({
        phase: OrchestratorPhase.COMPLETE,
        event: "TASK_COMPLETED",
        status: "completed",
        detail: answerVerification.status,
      });
    } else if (status === "failed") {
      pushEvent({
        phase: OrchestratorPhase.FAILED,
        event: "TASK_FAILED",
        status: "failed",
        detail: answerVerification.reason,
      });
    }

    return {
      taskId,
      goal,
      plan,
      observations,
      verifications,
      events,
      finalResponse,
      retriesUsed,
      status,
      completedAt: new Date(),
      evidence,
      answerVerification,
    };
  }

  private async localTimeOnlyResult(input: {
    taskId: string;
    goal: string;
    plan: Plan;
    observations: StepObservation[];
    verifications: VerificationResult[];
    events: OrchestrationEvent[];
    pushEvent: (e: Omit<OrchestrationEvent, "taskId" | "timestamp">) => void;
  }): Promise<OrchestratorResult> {
    input.pushEvent({
      phase: OrchestratorPhase.EXECUTE,
      event: "TOOL_SELECTED",
      tool: "get_current_time",
      status: "started",
      detail: "Local clock — no web search",
    });
    const toolResult = await this.deps.tools.execute("get_current_time", {});
    const observation: StepObservation = {
      stepId: "local-time",
      output: toolResult,
      durationMs: 0,
      timestamp: new Date(),
    };
    input.observations.push(observation);
    const verification = this.engine.verifyToolResult(
      {
        id: "local-time",
        description: "Get current time",
        toolName: "get_current_time",
        successCriteria: "time retrieved",
      },
      observation,
    );
    input.verifications.push(verification);
    input.pushEvent({
      phase: OrchestratorPhase.EXECUTE,
      event: "TOOL_EXECUTED",
      tool: "get_current_time",
      status: toolResult.success ? "completed" : "failed",
    });
    input.pushEvent({
      phase: OrchestratorPhase.VERIFY,
      event: "VERIFICATION_STARTED",
      status: "started",
      detail: "local time answer",
    });
    const iso =
      typeof toolResult.output === "object" &&
      toolResult.output !== null &&
      "time" in (toolResult.output as object)
        ? String((toolResult.output as { time: string }).time)
        : new Date().toISOString();
    const finalResponse = toolResult.success
      ? `Current date/time (local tool): ${iso}\n\nVerification: not_verified for claims beyond the clock reading. Source: get_current_time (local).`
      : `Failed to read local time: ${toolResult.error ?? "unknown"}`;
    const answerVerification = this.engine.verifyFactualClaims({
      question: input.goal,
      draftAnswer: finalResponse,
      evidence: evidenceFromToolResult("get_current_time", toolResult),
      evidenceRequired: false,
    });
    input.pushEvent({
      phase: OrchestratorPhase.VERIFY,
      event: "VERIFICATION_PASSED",
      status: "completed",
      detail: answerVerification.status,
    });
    this.emitPhase(OrchestratorPhase.COMPLETE);
    input.pushEvent({
      phase: OrchestratorPhase.COMPLETE,
      event: "TASK_COMPLETED",
      status: "completed",
      detail: "local time",
    });
    return {
      taskId: input.taskId,
      goal: input.goal,
      plan: {
        ...input.plan,
        steps: [
          {
            id: "local-time",
            description: "Get current local date/time",
            toolName: "get_current_time",
            successCriteria: "time retrieved",
          },
        ],
        reasoning: "Local time tool — Bharath weights not required",
      },
      observations: input.observations,
      verifications: input.verifications,
      events: input.events,
      finalResponse,
      retriesUsed: 0,
      status: toolResult.success ? "completed" : "failed",
      completedAt: new Date(),
      evidence: evidenceFromToolResult("get_current_time", toolResult),
      answerVerification,
    };
  }

  private async codingBootstrapResult(input: {
    taskId: string;
    goal: string;
    plan: Plan;
    observations: StepObservation[];
    verifications: VerificationResult[];
    events: OrchestrationEvent[];
    context: UserContext;
    pushEvent: (e: Omit<OrchestrationEvent, "taskId" | "timestamp">) => void;
    bootstrapKind?: BootstrapKind;
    clarificationAnswers?: Record<string, string>;
  }): Promise<OrchestratorResult> {
    const kind =
      input.bootstrapKind ??
      resolveBootstrapKind(input.goal, input.clarificationAnswers ?? input.context.clarificationAnswers);
    const projectName = extractProjectName(input.goal);
    let workspaceId = input.context.workspaceId;

    input.pushEvent({
      phase: OrchestratorPhase.EXECUTE,
      event: "TOOL_SELECTED",
      tool: "create_workspace",
      status: "started",
      detail: projectName,
    });

    if (!workspaceId && this.deps.tools.get("create_workspace")) {
      const created = await this.deps.tools.execute("create_workspace", {
        projectName,
        forceNew: Boolean(input.context.forceNewWorkspace || input.context.forceNewProject),
      });
      input.observations.push({
        stepId: "create_workspace",
        output: created,
        durationMs: 0,
        timestamp: new Date(),
      });
      const out = created.output as { workspaceId?: string } | null;
      if (!created.success || !out?.workspaceId) {
        input.pushEvent({
          phase: OrchestratorPhase.FAILED,
          event: "TASK_FAILED",
          status: "failed",
          error: created.error ?? "create_workspace failed",
        });
        return {
          taskId: input.taskId,
          goal: input.goal,
          plan: input.plan,
          observations: input.observations,
          verifications: input.verifications,
          events: input.events,
          finalResponse: `Could not create workspace: ${created.error ?? "unknown"}`,
          retriesUsed: 0,
          status: "failed",
          completedAt: new Date(),
        };
      }
      workspaceId = out.workspaceId;
      input.pushEvent({
        phase: OrchestratorPhase.EXECUTE,
        event: "TOOL_EXECUTED",
        tool: "create_workspace",
        status: "completed",
        detail: workspaceId,
      });
    }

    if (!workspaceId) {
      return {
        taskId: input.taskId,
        goal: input.goal,
        plan: input.plan,
        observations: input.observations,
        verifications: input.verifications,
        events: input.events,
        finalResponse:
          "No workspace available. Create one via Spaces or ensure create_workspace is registered.",
        retriesUsed: 0,
        status: "failed",
        completedAt: new Date(),
      };
    }

    // Optional evidence collection for Project O (best-effort; may be empty if DDG blocked)
    if (kind === "project_o" && this.deps.tools.get("search_web")) {
      const search = await this.deps.tools.execute("search_web", {
        query: "ocean sea surface temperature prediction dataset",
        limit: 3,
      });
      input.observations.push({
        stepId: "search_web",
        output: search,
        durationMs: 0,
        timestamp: new Date(),
      });
      input.pushEvent({
        phase: OrchestratorPhase.EXECUTE,
        event: "EVIDENCE_COLLECTED",
        tool: "search_web",
        status: search.success ? "completed" : "failed",
        detail: "ocean temperature sources (best-effort)",
      });
    }

    const files =
      kind === "website"
        ? websiteProjectFiles(projectName)
        : kind === "school_management"
          ? schoolManagementProjectFiles()
          : oceanTemperatureProjectFiles();
    const contents: Record<string, string> = {};
    for (const file of files) {
      contents[file.path] = file.content;
      const written = await this.deps.tools.execute("create_file", {
        workspaceId,
        path: file.path,
        content: file.content,
      });
      input.observations.push({
        stepId: `write:${file.path}`,
        output: written,
        durationMs: 0,
        timestamp: new Date(),
      });
      if (!written.success) {
        input.pushEvent({
          phase: OrchestratorPhase.FAILED,
          event: "TASK_FAILED",
          status: "failed",
          error: written.error ?? `Failed writing ${file.path}`,
        });
        return {
          taskId: input.taskId,
          goal: input.goal,
          plan: input.plan,
          observations: input.observations,
          verifications: input.verifications,
          events: input.events,
          finalResponse: `Failed writing ${file.path}: ${written.error}`,
          retriesUsed: 0,
          status: "failed",
          completedAt: new Date(),
        };
      }
    }

    const run =
      kind === "website"
        ? await this.deps.tools.execute("run_command", {
            workspaceId,
            command:
              "test -f index.html && test -f about.html && test -f contact.html && test -f styles.css && echo SITE_SCAFFOLD_OK",
          })
        : kind === "school_management"
          ? await this.deps.tools.execute("run_command", {
              workspaceId,
              command: "node --test test/",
            })
          : await this.deps.tools.execute("run_command", {
              workspaceId,
              command: "python3 model.py",
            });
    input.observations.push({
      stepId: kind === "website" ? "verify_scaffold" : kind === "school_management" ? "run_tests_phase" : "run_model",
      output: run,
      durationMs: 0,
      timestamp: new Date(),
    });

    const tests =
      kind === "website"
        ? await this.deps.tools.execute("run_tests", { workspaceId })
        : kind === "school_management"
          ? await this.deps.tools.execute("run_command", {
              workspaceId,
              command: "node --test test/",
            })
          : await this.deps.tools.execute("run_tests", {
              workspaceId,
              command: "python3 -m unittest test_model.py -v",
            });
    input.observations.push({
      stepId: "run_tests",
      output: tests,
      durationMs: 0,
      timestamp: new Date(),
    });

    const listed = this.deps.tools.get("list_files")
      ? await this.deps.tools.execute("list_files", { workspaceId, path: "." })
      : { success: true, output: { files: files.map((f) => f.path) } };
    const listedFiles: string[] = Array.isArray((listed.output as { files?: string[] })?.files)
      ? ((listed.output as { files: string[] }).files)
      : [];
    const workspaceFiles = [...new Set([...files.map((f) => f.path), ...listedFiles])];

    const scale = classifyRequest(input.goal);
    const projectPlan: ProjectPlan = buildProjectPlan(input.goal, scale, 1);
    if (input.context.architecture) {
      projectPlan.architecture = input.context.architecture;
    }

    const runtimeOk = run.success === true;
    const testsOk = tests.success === true || (kind === "website" && runtimeOk);
    const inScopeTests = projectPlan.tests.filter((t) => t.status !== "deferred").length;
    const completeness = evaluateCompleteness({
      classification: scale,
      plan: projectPlan,
      files: workspaceFiles,
      contents,
      testsPassed: testsOk ? Math.max(inScopeTests, kind === "website" ? 0 : 1) : 0,
      testsTotal: kind === "website" ? 0 : Math.max(inScopeTests, 1),
      verificationPassed: runtimeOk && testsOk ? Math.max(inScopeTests, 1) : 0,
      verificationTotal: Math.max(inScopeTests, kind === "website" ? 1 : 1),
      runtimeOk,
      buildFailed: !runtimeOk && kind !== "website",
    });
    completeness.storage = ["workspace"];

    const codeVerification = this.engine.verifyGeneratedCode({
      steps: [
        {
          name: "runtime",
          passed: runtimeOk,
          details: JSON.stringify(run.output).slice(0, 400),
          outcome: runtimeOk ? "PASSED" : "FAILED",
        },
        {
          name: "unit_tests",
          passed: testsOk,
          details: JSON.stringify(tests.output).slice(0, 400),
          outcome: testsOk ? "PASSED" : "FAILED",
        },
        {
          name: "completeness_guard",
          passed: completeness.status !== "PROJECT_INCOMPLETE" && completeness.status !== "FAILED",
          details: completeness.reason,
          outcome:
            completeness.status === "COMPLETE"
              ? "PASSED"
              : completeness.status === "FAILED"
                ? "FAILED"
                : "NOT_RUN",
        },
        {
          name: "security_checks",
          passed: true,
          details: kind === "school_management" ? "RBAC API tests included; SCA NOT_IMPLEMENTED" : "NOT_IMPLEMENTED",
          outcome: "NOT_IMPLEMENTED",
        },
      ],
      report: {
        status:
          completeness.status === "FAILED"
            ? "FAILED"
            : completeness.status === "PROJECT_INCOMPLETE"
              ? "NOT_VERIFIED"
              : runtimeOk && testsOk
                ? completeness.status === "COMPLETE"
                  ? "VERIFIED"
                  : "UNCERTAIN"
                : "FAILED",
        build: "SKIPPED",
        tests: testsOk ? "PASSED" : "FAILED",
        runtime: runtimeOk ? "PASSED" : "FAILED",
        security: "NOT_IMPLEMENTED",
        attempts: 1,
        modelQuality: "MODEL_QUALITY_NOT_VERIFIED",
      },
    });
    input.verifications.push(codeVerification);

    input.pushEvent({
      phase: OrchestratorPhase.VERIFY,
      event:
        codeVerification.status === "verified"
          ? "VERIFICATION_PASSED"
          : "VERIFICATION_FAILED",
      status: codeVerification.status === "failed" ? "failed" : "completed",
      detail: `${completeness.status}: ${codeVerification.reason}`,
    });

    const extraNotes =
      kind === "website"
        ? [
            `Wrote multi-page static scaffold: index.html, about.html, contact.html, styles.css, script.js.`,
            `Scaffold check: ${runtimeOk ? "SITE_SCAFFOLD_OK" : "SCAFFOLD_CHECK_FAILED"}.`,
            `Open index.html in a browser, or run: python3 -m http.server 8080`,
          ]
        : kind === "school_management"
          ? [
              `Phase 1 written: auth, dashboards, students, teachers, attendance, classes — multiple pages + APIs + file-backed store + tests.`,
              `Run: node src/server.js then open http://localhost:3456/login.html`,
              `Demo login SEED_DATA: admin@school.local / admin123`,
              `This request was classified as ${scale}. CompletenessGuard forbids treating a one-page render as a completed full application.`,
            ]
          : [
              `Wrote Project O ocean-temperature demo (stdlib Python).`,
              `MODEL_QUALITY_NOT_VERIFIED — synthetic bundled data only; not scientifically validated on real ocean observations.`,
              `Security: NOT_IMPLEMENTED.`,
            ];

    const finalResponse = formatProjectCompletionReport({
      plan: projectPlan,
      report: completeness,
      workspaceId,
      runtimeOk,
      testsOk,
      extraNotes,
    });

    const orchStatus = orchestratorStatusFor(completeness);
    const failed = orchStatus === "failed" || !runtimeOk;
    this.emitPhase(failed ? OrchestratorPhase.FAILED : OrchestratorPhase.COMPLETE);
    input.pushEvent({
      phase: failed ? OrchestratorPhase.FAILED : OrchestratorPhase.COMPLETE,
      event: failed ? "TASK_FAILED" : "TASK_COMPLETED",
      status: failed ? "failed" : "completed",
      detail: completeness.status,
    });

    return {
      taskId: input.taskId,
      goal: input.goal,
      plan: {
        goal: input.goal,
        reasoning: `Coding bootstrap (${kind}) with CompletenessGuard — ${completeness.status}`,
        steps: [
          {
            id: "create_workspace",
            description: `Create workspace ${projectName}`,
            toolName: "create_workspace",
            successCriteria: "workspace exists",
          },
          {
            id: "write_files",
            description:
              kind === "website"
                ? "Write multi-page website files"
                : kind === "school_management"
                  ? "Write Phase 1 school management project (pages, API, store, tests)"
                  : "Write Project O files",
            toolName: "create_file",
            successCriteria: "files written",
          },
          {
            id: "run",
            description:
              kind === "website"
                ? "Verify multi-page scaffold"
                : kind === "school_management"
                  ? "Run Phase 1 tests"
                  : "Run model.py",
            toolName: "run_command",
            successCriteria: kind === "website" ? "SITE_SCAFFOLD_OK" : "script/tests exit 0",
          },
          {
            id: "test",
            description: "Run tests",
            toolName: "run_tests",
            successCriteria: kind === "website" ? "NO_TESTS or pass" : "tests pass",
          },
          {
            id: "completeness",
            description: "CompletenessGuard vs requested scope",
            successCriteria: "not a silent one-page demo for FULL_APPLICATION",
          },
        ],
      },
      observations: input.observations,
      verifications: input.verifications,
      events: input.events,
      finalResponse,
      retriesUsed: 0,
      status: orchStatus,
      completedAt: new Date(),
      answerVerification: codeVerification,
      requestScale: scale,
      projectPlan,
      projectStatus: completeness.status,
      completeness,
      architecture: input.context.architecture,
    };
  }

  private async evidenceOnlyResult(input: {
    taskId: string;
    goal: string;
    plan: Plan;
    observations: StepObservation[];
    verifications: VerificationResult[];
    events: OrchestrationEvent[];
    need: EvidenceNeed;
    evidenceRequired: boolean;
    pushEvent: (e: Omit<OrchestrationEvent, "taskId" | "timestamp">) => void;
  }): Promise<OrchestratorResult> {
    input.pushEvent({
      phase: OrchestratorPhase.EXECUTE,
      status: "started",
      detail: "Collecting evidence without model weights",
    });
    const evidence = await this.gatherEvidenceForQuery(input.goal);
    const answerVerification = this.engine.verifyFactualClaims({
      question: input.goal,
      evidence,
      evidenceRequired: input.evidenceRequired,
      timeSensitive: input.need.timeSensitive,
    });
    const finalResponse = formatEvidenceAnswerWithoutModel(
      input.goal,
      evidence,
      answerVerification,
    );
    input.pushEvent({
      phase: OrchestratorPhase.VERIFY,
      status: answerVerification.status === "verified" ? "completed" : "failed",
      detail: answerVerification.reason,
    });
    this.emitPhase(OrchestratorPhase.COMPLETE);
    return {
      taskId: input.taskId,
      goal: input.goal,
      plan: input.plan,
      observations: input.observations,
      verifications: input.verifications,
      events: input.events,
      finalResponse,
      retriesUsed: 0,
      status: "completed",
      completedAt: new Date(),
      evidence,
      answerVerification,
    };
  }

  private async createPlan(
    goal: string,
    history: Message[],
    context: UserContext,
    need: EvidenceNeed,
  ): Promise<Plan> {
    const toolDefs = this.deps.tools.listDefinitions();
    const knownTools = new Set(toolDefs.map((t) => t.name));
    const result = await this.deps.model.generate({
      messages: [
        {
          role: "system",
          content: this.config.planningSystemPrompt ?? SHORT_PLANNING_PROMPT,
        },
        {
          role: "user",
          content: budgetPlanningUserContent({
            goal,
            workspaceId: context.workspaceId,
            needSummary: [
              need.coding ? "coding" : "",
              need.web ? "web" : "",
              need.localTime ? "time" : "",
            ]
              .filter(Boolean)
              .join(",") || "chat",
            toolNames: toolDefs.map((t) => t.name),
            history,
            providerId: this.deps.model.id,
          }),
        },
      ],
      temperature: 0.3,
    });

    if (/\[Model not loaded\]/i.test(result.content)) {
      return {
        goal,
        steps: [],
        reasoning: "Model unavailable — weights not loaded",
      };
    }

    try {
      const parsed = JSON.parse(extractJson(result.content)) as Omit<Plan, "goal">;
      const steps = sanitizeSteps(parsed.steps ?? [], knownTools);
      const planned: Plan =
        steps.length === 0
          ? {
              goal,
              steps: [
                {
                  id: "step-1",
                  description: `Answer the user goal: ${goal}`,
                  successCriteria: "User receives a helpful response",
                },
              ],
              reasoning: parsed.reasoning ?? "Fallback single-step plan",
            }
          : { goal, steps, reasoning: parsed.reasoning };
      return ensureEvidenceSteps(planned, goal, need, knownTools);
    } catch {
      return ensureEvidenceSteps(
        {
          goal,
          steps: [
            {
              id: "step-1",
              description: `Answer the user goal: ${goal}`,
              successCriteria: "User receives a helpful response",
            },
          ],
          reasoning: "Fallback single-step plan",
        },
        goal,
        need,
        knownTools,
      );
    }
  }

  private async executeStep(
    step: PlanStep,
    pushEvent: (e: Omit<OrchestrationEvent, "taskId" | "timestamp">) => void,
    _ctx?: {
      specialistCap?: ProviderCapability;
      goal?: string;
      history?: Message[];
    },
  ): Promise<StepObservation> {
    const start = Date.now();

    if (!step.toolName) {
      // Non-tool reasoning steps stay on Bharath unless this is a specialist-only plan step
      const result = await this.deps.model.generate({
        messages: [{ role: "user", content: step.description }],
      });
      const cleaned = sanitizeUserFacingAnswer(result.content);
      const output = isUnusableAssistantAnswer(cleaned)
        ? `Working on: ${step.description.replace(/^Answer the user goal:\s*/i, "").trim()}`
        : cleaned;
      return {
        stepId: step.id,
        output,
        durationMs: Date.now() - start,
        timestamp: new Date(),
      };
    }

    const tool = this.deps.tools.get(step.toolName);
    if (!tool) {
      return {
        stepId: step.id,
        output: {
          success: false,
          error: `Unknown tool: ${step.toolName}`,
          fatal: true,
        },
        durationMs: Date.now() - start,
        timestamp: new Date(),
      };
    }

    if (tool.definition.permissionLevel === ToolPermissionLevel.HIGH_RISK) {
      this.emitPhase(OrchestratorPhase.AWAIT_APPROVAL, step.toolName);
      pushEvent({
        phase: OrchestratorPhase.AWAIT_APPROVAL,
        stepId: step.id,
        tool: step.toolName,
        status: "awaiting_approval",
        detail: step.toolName,
      });
    }

    const toolResult = await this.deps.tools.execute(
      step.toolName,
      step.toolArgs ?? {},
    );

    return {
      stepId: step.id,
      output: toolResult,
      durationMs: Date.now() - start,
      timestamp: new Date(),
    };
  }

  /**
   * Route a specialist capability through ProviderManager (bounded fallback).
   * Bharath remains the primary brain for planning/synthesis — specialists only for capability work.
   */
  private async runSpecialist(
    goal: string,
    capability: ProviderCapability,
    context: UserContext,
    history: Message[],
    pushEvent: (e: Omit<OrchestrationEvent, "taskId" | "timestamp">) => void,
  ): Promise<{
    observation: StepObservation;
    verification: VerificationResult;
    fatal: boolean;
  }> {
    const pm = this.deps.providerManager!;
    const start = Date.now();
    const selection = await pm.selectFor({
      capability,
      preferOwnModel: false,
      taskType:
        capability === "code_fix"
          ? "fix"
          : capability === "code_review"
            ? "review"
            : "code",
    });

    pushEvent({
      phase: OrchestratorPhase.EXECUTE,
      event: "PROVIDER_SELECTED",
      provider: selection.providerId,
      status: selection.status === "NO_ELIGIBLE_PROVIDER" ? "failed" : "started",
      detail: selection.reason,
    });

    if (selection.status === "NO_ELIGIBLE_PROVIDER") {
      const observation: StepObservation = {
        stepId: "specialist",
        output: {
          success: false,
          error: selection.reason,
          fatal: false,
        },
        durationMs: Date.now() - start,
        timestamp: new Date(),
      };
      return {
        observation,
        verification: this.engine.verifyToolResult(
          {
            id: "specialist",
            description: `Specialist ${capability}`,
            successCriteria: "Specialist completes",
          },
          observation,
        ),
        fatal: false,
      };
    }

    const executed = await pm.executeWithFallback(
      {
        capability,
        preferOwnModel: false,
        preferredProvider: selection.providerId,
        taskType:
          capability === "code_fix"
            ? "fix"
            : capability === "code_review"
              ? "review"
              : "code",
      },
      {
        messages: [
          {
            role: "system",
            content:
              "You are a coding specialist. Provide concrete, actionable output. Do not claim verification. Never request or echo API keys.",
          },
          ...history.slice(-6),
          {
            role: "user",
            content: `Capability: ${capability}\nWorkspace: ${context.workspaceId ?? "none"}\nTask: ${goal}`,
          },
        ],
        temperature: 0.2,
      },
    );

    if (executed.error || !executed.result) {
      pushEvent({
        phase: OrchestratorPhase.EXECUTE,
        event: "PROVIDER_FAILED",
        provider: executed.selection.providerId,
        status: "failed",
        detail: executed.error ?? "Specialist failed",
        error: executed.error,
      });
      const observation: StepObservation = {
        stepId: "specialist",
        output: {
          success: false,
          error: executed.error ?? "Specialist failed",
          fatal: false,
        },
        durationMs: Date.now() - start,
        timestamp: new Date(),
      };
      return {
        observation,
        verification: this.engine.verifyToolResult(
          {
            id: "specialist",
            description: `Specialist ${capability}`,
            successCriteria: "Specialist completes",
          },
          observation,
        ),
        fatal: false,
      };
    }

    pushEvent({
      phase: OrchestratorPhase.EXECUTE,
      event: "PROVIDER_SELECTED",
      provider: executed.selection.providerId,
      status: "completed",
      detail: `Specialist ${executed.selection.providerId} completed (${executed.attempted.join("→")})`,
      durationMs: Date.now() - start,
    });

    const observation: StepObservation = {
      stepId: "specialist",
      output: {
        success: true,
        output: {
          provider: executed.selection.providerId,
          capability,
          content: executed.result.content,
          fallbackUsed: executed.fallbackUsed,
          attempted: executed.attempted,
        },
      },
      durationMs: Date.now() - start,
      timestamp: new Date(),
    };
    return {
      observation,
      verification: this.engine.verifyToolResult(
        {
          id: "specialist",
          description: `Specialist ${capability}`,
          toolName: undefined,
          successCriteria: "Specialist response received",
        },
        {
          ...observation,
          output: executed.result.content,
        },
      ),
      fatal: false,
    };
  }

  /**
   * Bounded auto-fix: capture error → specialist patch suggestion → edit_file in workspace.
   */
  private async attemptCodeFix(
    workspaceId: string,
    failedObservation: StepObservation,
    attempt: number,
    pushEvent: (e: Omit<OrchestrationEvent, "taskId" | "timestamp">) => void,
  ): Promise<StepObservation | null> {
    const pm = this.deps.providerManager;
    if (!pm || !this.deps.tools.get("edit_file")) return null;

    const errText =
      typeof failedObservation.output === "object" && failedObservation.output !== null
        ? JSON.stringify(failedObservation.output).slice(0, 4000)
        : String(failedObservation.output).slice(0, 4000);

    pushEvent({
      phase: OrchestratorPhase.RETRY,
      event: "RETRY_STARTED",
      status: "retry",
      detail: `code_fix attempt ${attempt}`,
      retryCount: attempt,
    });

    const executed = await pm.executeWithFallback(
      {
        capability: "code_fix",
        preferOwnModel: false,
        taskType: "fix",
      },
      {
        messages: [
          {
            role: "system",
            content: `You suggest a single-file patch for a coding workspace.
Return ONLY JSON: {"path":"relative/path","content":"full new file content","reason":"why this fixes the error"}
No markdown. Paths must be workspace-relative. Never include secrets.`,
          },
          {
            role: "user",
            content: `Attempt ${attempt}. Workspace ${workspaceId}. Error/output:\n${errText}`,
          },
        ],
        temperature: 0.1,
      },
    );

    if (!executed.result?.content) {
      pushEvent({
        phase: OrchestratorPhase.RETRY,
        event: "PROVIDER_FAILED",
        provider: executed.selection.providerId,
        status: "failed",
        detail: executed.error ?? "No patch from specialist",
      });
      return null;
    }

    pushEvent({
      phase: OrchestratorPhase.RETRY,
      event: "PATCH_GENERATED",
      provider: executed.selection.providerId,
      status: "completed",
      detail: `Patch candidate from ${executed.selection.providerId}`,
    });

    let patch: { path?: string; content?: string; reason?: string };
    try {
      patch = JSON.parse(extractJson(executed.result.content)) as {
        path?: string;
        content?: string;
        reason?: string;
      };
    } catch {
      return null;
    }
    if (!patch.path || typeof patch.content !== "string") return null;
    if (patch.path.includes("..") || patch.path.startsWith("/") || patch.path.includes("\0")) {
      return null;
    }

    // Bharath reviews patch briefly (no secrets in prompt)
    const review = await this.deps.model.generate({
      messages: [
        {
          role: "system",
          content:
            'Review this patch for safety. Reply ONLY JSON: {"apply":true|false,"reason":"..."}. Reject path escapes or secrets.',
        },
        {
          role: "user",
          content: JSON.stringify({
            path: patch.path,
            reason: patch.reason,
            contentPreview: patch.content.slice(0, 1500),
          }),
        },
      ],
      temperature: 0,
    });

    let apply = true;
    try {
      const parsed = JSON.parse(extractJson(review.content)) as { apply?: boolean };
      if (parsed.apply === false) apply = false;
    } catch {
      // If Bharath weights missing, still apply path-safe patches from specialist
      apply = !/\[Model not loaded\]/i.test(review.content);
    }
    if (!apply) return null;

    const toolResult = await this.deps.tools.execute("edit_file", {
      workspaceId,
      path: patch.path,
      content: patch.content,
    });

    pushEvent({
      phase: OrchestratorPhase.RETRY,
      event: "PATCH_APPLIED",
      status: toolResult.success ? "completed" : "failed",
      detail: patch.reason ?? patch.path,
      tool: "edit_file",
    });

    return {
      stepId: `auto-fix-${attempt}`,
      output: toolResult,
      durationMs: 0,
      timestamp: new Date(),
    };
  }

  private async synthesizeResult(
    goal: string,
    plan: Plan,
    observations: StepObservation[],
    verifications: VerificationResult[],
    status: string,
    evidence: Evidence[],
    preCheck: VerificationResult,
    evidenceRequired: boolean,
  ): Promise<string> {
    const allPassed = status === "completed" && verifications.every((v) => v.passed);
    const failures = observations
      .map((o) => {
        const out = o.output as { error?: string } | string;
        return typeof out === "object" && out?.error ? out.error : null;
      })
      .filter(Boolean);

    if (evidenceRequired && !hasAdequateEvidence(evidence)) {
      return UNVERIFIED_NOTICE;
    }

    const result = await this.deps.model.generate({
      messages: [
        {
          role: "system",
          content: evidenceRequired
            ? formatEvidenceForModel(evidence, preCheck, goal)
            : "Summarize what was accomplished for the user. Be concise and actionable. Mention failures clearly. Never present an unverified claim as verified.",
        },
        {
          role: "user",
          content: JSON.stringify({
            goal,
            plan: { goal: plan.goal, reasoning: plan.reasoning, steps: plan.steps.map((s) => s.description) },
            allPassed,
            status,
            verification: { status: preCheck.status, reason: preCheck.reason },
          }),
        },
      ],
    });

    if (/\[Model not loaded\]/i.test(result.content)) {
      if (evidenceRequired) {
        return formatEvidenceAnswerWithoutModel(goal, evidence, preCheck);
      }
      if (status === "failed") {
        return failures.length
          ? `Orchestration failed: ${failures[0]}. Load Bharath model weights to use Orchestrate, or switch to Chat.`
          : "Orchestration failed. Load Bharath model weights to use Orchestrate, or switch to Chat.";
      }
      const lastUseful = [...observations]
        .reverse()
        .map((o) => (typeof o.output === "string" ? o.output : null))
        .find((t) => t && !/\[Model not loaded\]/i.test(t) && !isUnusableAssistantAnswer(t));
      return lastUseful ?? "Done. (Model weights not loaded — limited summary available.)";
    }

    const cleaned = sanitizeUserFacingAnswer(result.content);
    if (!isUnusableAssistantAnswer(cleaned)) return cleaned;
    if (isWebsiteGoal(goal)) {
      return [
        "I can build a website for that.",
        "Say **use defaults** then **approve** to start the implementation plan,",
        "or reply with any scope preferences (pages, branding, contact form).",
      ].join(" ");
    }
    const lastUseful = [...observations]
      .reverse()
      .map((o) => (typeof o.output === "string" ? o.output : null))
      .find((t) => t && !isUnusableAssistantAnswer(t));
    return (
      lastUseful ??
      "I couldn’t produce a clear answer for that. Please rephrase or try again."
    );
  }

  private topologicalSort(steps: PlanStep[]): PlanStep[] {
    const sorted: PlanStep[] = [];
    const visited = new Set<string>();
    const stepMap = new Map(steps.map((s) => [s.id, s]));

    const visit = (step: PlanStep) => {
      if (visited.has(step.id)) return;
      for (const depId of step.dependsOn ?? []) {
        const dep = stepMap.get(depId);
        if (dep) visit(dep);
      }
      visited.add(step.id);
      sorted.push(step);
    };

    for (const step of steps) visit(step);
    return sorted;
  }

  private emitPhase(phase: OrchestratorPhase, detail?: string): void {
    this.deps.onPhaseChange?.(phase, detail);
  }

  /**
   * ANALYZE → CLARIFY → DECIDE → PLAN → AWAIT_IMPLEMENTATION_APPROVAL
   * Stops before modifying workspace until user approves.
   */
  private async runLargeImplementationFlow(input: {
    taskId: string;
    goal: string;
    history: Message[];
    context: UserContext;
    events: OrchestrationEvent[];
    pushEvent: (e: Omit<OrchestrationEvent, "taskId" | "timestamp">) => void;
  }): Promise<OrchestratorResult> {
    const { taskId, goal, history, events, pushEvent } = input;
    let context = input.context;
    const emptyPlan: Plan = { goal, steps: [], reasoning: "Awaiting implementation approval" };

    this.emitPhase(OrchestratorPhase.ANALYZE, goal);
    pushEvent({
      phase: OrchestratorPhase.ANALYZE,
      status: "started",
      detail: goal,
    });

    const architecture = await this.resolveArchitecture(goal, context);
    context = { ...context, architecture };

    const analysis = await analyzeRequirements(this.deps.model, goal, history, architecture);
    pushEvent({
      phase: OrchestratorPhase.ANALYZE,
      status: "completed",
      detail: analysis.analysisSummary,
    });

    const answers = context.clarificationAnswers ?? {};
    const useDefaults = answers.__use_defaults === "true";
    const hasAnswers = hasClarificationAnswers(answers);

    if (analysis.needsClarification && analysis.questions.length > 0 && !hasAnswers && !context.implementationApproved) {
      this.emitPhase(OrchestratorPhase.CLARIFY);
      pushEvent({
        phase: OrchestratorPhase.CLARIFY,
        event: "CLARIFICATION_REQUESTED",
        status: "awaiting_approval",
        detail: `${analysis.questions.length} question(s)`,
      });

      const response = this.formatClarificationResponse(
        analysis.questions,
        analysis.analysisSummary,
        architecture,
      );

      return {
        taskId,
        goal,
        plan: emptyPlan,
        observations: [],
        verifications: [],
        events,
        finalResponse: response,
        retriesUsed: 0,
        status: "awaiting_clarification",
        completedAt: new Date(),
        clarificationQuestions: analysis.questions,
        analysisSummary: analysis.analysisSummary,
        requestScale: classifyRequest(goal),
        architecture,
      };
    }

    this.emitPhase(OrchestratorPhase.DECIDE);
    const resolvedAnswers = useDefaults
      ? mergeClarificationAnswers(analysis.questions, { __use_defaults: "true" })
      : mergeClarificationAnswers(analysis.questions, answers);

    const architectureConstraints = deriveArchitectureConstraints(goal, resolvedAnswers);

    const decided = decideFramework({
      goal,
      inspection: await this.inspectWorkspaceStack(context.workspaceId),
      prior: context.forceNewProject ? undefined : architecture,
      clarificationAnswers: resolvedAnswers,
    });
    context = { ...context, architecture: applyConstraintsToArchitecture(decided, architectureConstraints) };

    this.emitPhase(OrchestratorPhase.PLAN);
    pushEvent({
      phase: OrchestratorPhase.PLAN,
      event: "PLAN_CREATED",
      status: "started",
    });

    const implementationPlan = await buildImplementationPlan(
      this.deps.model,
      goal,
      resolvedAnswers,
      history,
      decided,
    );
    const requestScale = implementationPlan.scope ?? classifyRequest(goal);
    if (!implementationPlan.projectPlan) {
      implementationPlan.projectPlan = buildProjectPlan(goal, requestScale, 1);
      implementationPlan.phases = implementationPlan.projectPlan.phases;
      implementationPlan.scope = requestScale;
    }
    implementationPlan.architectureDecisions = context.architecture;
    implementationPlan.projectPlan.architecture = context.architecture;

    const planValidation = validateProjectPlan(
      implementationPlan.projectPlan,
      architectureConstraints,
      implementationPlan,
    );
    if (planValidation.status === "PLAN_INVALID") {
      pushEvent({
        phase: OrchestratorPhase.PLAN,
        event: "PLAN_INVALID",
        status: "failed",
        detail: planValidation.violations.join("; "),
      });
      return {
        taskId,
        goal,
        plan: emptyPlan,
        observations: [],
        verifications: [],
        events,
        finalResponse:
          `PLAN_INVALID — the generated plan contradicts approved architecture constraints (${constraintsSummary(architectureConstraints)}).\n\n` +
          planValidation.violations.map((v) => `- ${v}`).join("\n") +
          "\n\nReply with an amended approval or updated clarification answers.",
        retriesUsed: 0,
        status: "plan_invalid" as OrchestratorResult["status"],
        completedAt: new Date(),
        implementationPlan,
        analysisSummary: analysis.analysisSummary,
        requestScale,
        projectPlan: implementationPlan.projectPlan,
        architecture: context.architecture,
      };
    }

    implementationPlan.projectPlan.implementationProgress = {
      ...(implementationPlan.projectPlan.implementationProgress ?? {
        completedModuleIds: [],
        failedModuleIds: [],
        partialModuleIds: [],
        providersUsed: [],
        attemptCount: 0,
      }),
      lifecycleState: "AWAITING_APPROVAL",
      architectureConstraints,
    };

    pushEvent({
      phase: OrchestratorPhase.PLAN,
      event: "PLAN_CREATED",
      status: "completed",
      detail: implementationPlan.objective,
    });

    if (!context.implementationApproved) {
      this.emitPhase(OrchestratorPhase.AWAIT_APPROVAL, "implementation");
      pushEvent({
        phase: OrchestratorPhase.AWAIT_APPROVAL,
        event: "APPROVAL_REQUESTED",
        status: "awaiting_approval",
        detail: "AWAITING_IMPLEMENTATION_APPROVAL",
      });

      const planText =
        formatImplementationPlanForUser(implementationPlan) +
        formatClarificationAnswersForPlan(resolvedAnswers);
      return {
        taskId,
        goal,
        plan: emptyPlan,
        observations: [],
        verifications: [],
        events,
        finalResponse: planText,
        retriesUsed: 0,
        status: "awaiting_implementation_approval",
        completedAt: new Date(),
        implementationPlan,
        analysisSummary: analysis.analysisSummary,
        clarificationQuestions: analysis.questions,
        requestScale,
        projectPlan: implementationPlan.projectPlan,
        architecture: decided,
      };
    }

    pushEvent({
      phase: OrchestratorPhase.AWAIT_APPROVAL,
      event: "APPROVAL_GRANTED",
      status: "completed",
      detail: "Implementation approved — proceeding",
    });

    const frozenPlan = freezeApprovedPlan({
      plan: implementationPlan.projectPlan!,
      constraints: architectureConstraints,
      implementationPlan,
      clarificationAnswers: resolvedAnswers,
    });
    implementationPlan.projectPlan = frozenPlan;

    // Templates only for website / Project O / explicit demo — FULL_APPLICATION uses CodingAgent
    const bootstrapKind = resolveBootstrapKind(goal, resolvedAnswers);
    if (shouldUseTemplateBootstrap(bootstrapKind, goal, resolvedAnswers)) {
      return this.codingBootstrapResult({
        taskId,
        goal,
        plan: emptyPlan,
        observations: [],
        verifications: [],
        events,
        context: { ...context, clarificationAnswers: resolvedAnswers },
        pushEvent,
        bootstrapKind: bootstrapKind ?? undefined,
        clarificationAnswers: resolvedAnswers,
      });
    }

    if (this.deps.codingAgent) {
      return this.runCodingAgentImplementation({
        taskId,
        goal,
        plan: emptyPlan,
        observations: [],
        verifications: [],
        events,
        context: { ...context, clarificationAnswers: resolvedAnswers },
        pushEvent,
        implementationPlan,
      });
    }

    const execPlan = await this.createPlan(
      `${goal}\n\nApproved implementation plan:\n${JSON.stringify(implementationPlan)}`,
      history,
      context,
      classifyEvidenceNeed(goal),
    );

    return this.runApprovedImplementation({
      taskId,
      goal,
      plan: execPlan,
      context,
      history,
      events,
      pushEvent,
      implementationPlan,
      signal: undefined,
    });
  }

  private formatClarificationResponse(
    questions: ClarificationQuestion[],
    summary: string,
    architecture?: ArchitectureDecisions,
  ): string {
    const notice = architecture ? `${formatFrameworkNotice(architecture)}\n` : "";
    const lines = [
      notice,
      summary,
      "",
      "Before I create an implementation plan, please answer these questions:",
      "",
      ...questions.map(
        (q, i) =>
          `${i + 1}. **${q.question}**${q.defaultDecision ? `\n   _(Default if you skip: ${q.defaultDecision})_` : ""}`,
      ),
      "",
      "Reply with your answers, or say **use defaults** to proceed with reasonable assumptions.",
    ];
    return lines.join("\n");
  }

  private async resolveArchitecture(
    goal: string,
    context: UserContext,
  ): Promise<ArchitectureDecisions> {
    const inspection = await this.inspectWorkspaceStack(context.workspaceId);
    let prior = context.architecture;
    if (!prior && !context.forceNewProject && this.deps.getStoredArchitecture) {
      try {
        prior = await this.deps.getStoredArchitecture(context);
      } catch {
        prior = undefined;
      }
    }
    return decideFramework({
      goal,
      inspection,
      prior,
      clarificationAnswers: context.clarificationAnswers,
    });
  }

  /** Inspect package.json / next.config / vite.config / app / pages before creating a project. */
  private async inspectWorkspaceStack(
    workspaceId?: string,
  ): Promise<{ files: string[]; packageJson?: string }> {
    if (!workspaceId || !this.deps.tools.get("list_files")) {
      return { files: [] };
    }
    const files: string[] = [];
    const listed = await this.deps.tools.execute("list_files", { workspaceId, path: "." });
    const root = Array.isArray((listed.output as { files?: string[] })?.files)
      ? (listed.output as { files: string[] }).files
      : [];
    files.push(...root);

    for (const dir of ["src", "app", "pages", "components", "lib", "services", "api", "database", "tests", "test"]) {
      if (!root.some((f) => f === dir || f === `${dir}/`)) continue;
      const inner = await this.deps.tools.execute("list_files", { workspaceId, path: dir });
      const innerFiles = Array.isArray((inner.output as { files?: string[] })?.files)
        ? (inner.output as { files: string[] }).files
        : [];
      files.push(...innerFiles.map((f) => (f.startsWith(`${dir}/`) ? f : `${dir}/${f}`)));
    }

    let packageJson: string | undefined;
    if (this.deps.tools.get("read_file") && files.some((f) => /(^|\/)package\.json$/.test(f))) {
      const read = await this.deps.tools.execute("read_file", {
        workspaceId,
        path: "package.json",
      });
      if (read.success) {
        packageJson = String((read.output as { content?: string })?.content ?? "");
      }
    }
    return { files, packageJson };
  }

  private async runCodingAgentImplementation(input: {
    taskId: string;
    goal: string;
    plan: Plan;
    observations: StepObservation[];
    verifications: VerificationResult[];
    events: OrchestrationEvent[];
    context: UserContext;
    pushEvent: (e: Omit<OrchestrationEvent, "taskId" | "timestamp">) => void;
    implementationPlan?: ImplementationPlan;
    resume?: boolean;
  }): Promise<OrchestratorResult> {
    const agent = this.deps.codingAgent;
    if (!agent) {
      return {
        taskId: input.taskId,
        goal: input.goal,
        plan: input.plan,
        observations: input.observations,
        verifications: input.verifications,
        events: input.events,
        finalResponse:
          "CodingAgent is not wired. Refusing to dump a static FULL_APPLICATION template.",
        retriesUsed: 0,
        status: "failed",
        completedAt: new Date(),
        implementationPlan: input.implementationPlan,
      };
    }

    let workspaceId = input.context.workspaceId;
    const needsFreshWorkspace =
      !input.resume &&
      (input.context.forceNewWorkspace ||
        Boolean(input.implementationPlan?.projectPlan?.implementationProgress?.approvedPlan));
    if (needsFreshWorkspace) {
      workspaceId = undefined;
    }
    if (!workspaceId && this.deps.tools.get("create_workspace")) {
      const created = await this.deps.tools.execute("create_workspace", {
        projectName: extractProjectName(input.goal),
        forceNew: needsFreshWorkspace,
      });
      const out = created.output as { workspaceId?: string } | null;
      input.observations.push({
        stepId: "create_workspace",
        output: created,
        durationMs: 0,
        timestamp: new Date(),
      });
      if (created.success && out?.workspaceId) {
        workspaceId = out.workspaceId;
        input.pushEvent({
          phase: OrchestratorPhase.EXECUTE,
          event: "TOOL_EXECUTED",
          tool: "create_workspace",
          status: "completed",
          detail: workspaceId,
        });
      }
    }

    if (!workspaceId) {
      return {
        taskId: input.taskId,
        goal: input.goal,
        plan: input.plan,
        observations: input.observations,
        verifications: input.verifications,
        events: input.events,
        finalResponse: "No workspace available for CodingAgent.",
        retriesUsed: 0,
        status: "failed",
        completedAt: new Date(),
      };
    }

    input.pushEvent({
      phase: OrchestratorPhase.EXECUTE,
      event: "TOOL_SELECTED",
      tool: "coding_agent",
      status: "started",
      detail: "UNDERSTAND → IMPLEMENT → BUILD → TEST → FIX",
    });

    const planSummary = formatPlanSummaryForCoding(
      input.implementationPlan?.projectPlan,
      input.implementationPlan,
    );
    const codingClass = classifyCodingTask(input.goal);
    const scale =
      input.implementationPlan?.scope ?? classifyRequest(input.goal);
    const implementScale =
      codingClass === "SMALL_PROJECT" || codingClass === "BUG_FIX" ? "MVP" : scale;
    const resolved = resolveApprovedPlanForRun(
      input.implementationPlan?.projectPlan ?? buildProjectPlan(input.goal, scale, 1),
    );
    const projectPlanForRun = resolved.plan;
    const scheduleConstraints = resolved.constraints ?? projectPlanForRun.implementationProgress?.architectureConstraints;
    const schedule =
      implementScale === "FULL_APPLICATION" || implementScale === "LARGE_SYSTEM"
        ? buildImplementationSchedule(projectPlanForRun, scheduleConstraints)
        : [];
    const fileManifest =
      schedule.length > 0 ? manifestFromPlan(projectPlanForRun, schedule) : undefined;
    const completedModuleIds =
      projectPlanForRun.implementationProgress?.completedModuleIds ?? [];

    const result = await agent.implement({
      workspaceId,
      goal: input.goal,
      overwriteExisting: false,
      planSummary: planSummary || undefined,
      requestScale: implementScale,
      resume: input.resume,
      schedule: schedule.length ? schedule : undefined,
      fileManifest,
      completedModuleIds,
    });

    input.observations.push({
      stepId: "coding_agent",
      output: {
        success: result.success,
        output: {
          workspaceId,
          summary: result.summary,
          files: result.filesCreated?.slice(0, 80),
          inspection: result.inspection?.summary,
        },
        error: result.errors?.join("; "),
      },
      durationMs: 0,
      timestamp: new Date(),
    });

    const files = result.filesCreated ?? [];
    const projectPlan = projectPlanForRun;
    if (input.context.architecture) {
      projectPlan.architecture = input.context.architecture;
    }
    if (result.moduleProgress?.length) {
      const byId = new Map(result.moduleProgress.map((m) => [m.id, m]));
      projectPlan.modules = projectPlan.modules.map((mod) => {
        const p = byId.get(mod.id);
        if (!p) return mod;
        const status =
          p.status === "verified"
            ? "verified"
            : p.status === "waiting"
              ? "in_progress"
              : p.status === "blocked"
                ? "failed"
                : p.status === "failed"
                ? "failed"
                : p.status === "partial"
                  ? "partial"
                  : mod.status;
        return { ...mod, status };
      });
      const prev = projectPlan.implementationProgress;
      const verifiedNow = result.moduleProgress.filter((m) => m.status === "verified").map((m) => m.id);
      const waitingNow = result.moduleProgress.filter((m) => m.status === "waiting").map((m) => m.id);
      projectPlan.implementationProgress = {
        ...(prev ?? {
          completedModuleIds: [],
          failedModuleIds: [],
          partialModuleIds: [],
          providersUsed: [],
          attemptCount: 0,
        }),
        fileManifest,
        completedModuleIds: [...new Set([...(prev?.completedModuleIds ?? []), ...verifiedNow])],
        failedModuleIds: result.moduleProgress.filter((m) => m.status === "failed").map((m) => m.id),
        partialModuleIds: result.moduleProgress
          .filter((m) => m.status === "partial")
          .map((m) => m.id),
        waitingModuleIds: waitingNow,
        providersUsed: [
          ...new Set([
            ...(prev?.providersUsed ?? []),
            this.deps.providerManager?.getLastStructuredTrace?.()?.selectedProvider ?? "unknown",
          ]),
        ],
        attemptCount:
          (prev?.attemptCount ?? 0) +
          (this.deps.providerManager?.getLastStructuredTrace?.()?.attemptCount ?? 1),
        retryAt: result.waitingForProvider?.retryAt,
        waitReason: result.waitingForProvider?.reason,
        approvedPlan: prev?.approvedPlan,
        architectureConstraints: prev?.architectureConstraints ?? scheduleConstraints,
        lifecycleState: result.waitingForProvider ? "WAITING_FOR_PROVIDER" : prev?.lifecycleState ?? "IMPLEMENTING",
        queue: (schedule.length ? schedule : []).map((m) => {
          const p = result.moduleProgress?.find((x) => x.id === m.id);
          const done = (prev?.completedModuleIds ?? []).includes(m.id) || p?.status === "verified";
          const state =
            p?.status === "waiting"
              ? "WAITING_PROVIDER"
              : p?.status === "blocked"
                ? "BLOCKED"
                : done
                ? "VERIFIED"
                : p?.status === "failed"
                  ? "FAILED"
                  : p?.status === "partial"
                    ? "IMPLEMENTED"
                    : "PENDING";
          return {
            id: `task-${m.id}`,
            moduleId: m.id,
            state,
            retryAt: p?.status === "waiting" ? result.waitingForProvider?.retryAt : undefined,
            failure: p?.status === "waiting" ? result.waitingForProvider?.reason : undefined,
          };
        }),
      };
    }

    const prevProgress = projectPlan.implementationProgress;
    if (result.repairHistory?.length || prevProgress?.repairHistory?.length) {
      projectPlan.implementationProgress = {
        ...(prevProgress ?? {
          completedModuleIds: [],
          failedModuleIds: [],
          partialModuleIds: [],
          providersUsed: [],
          attemptCount: 0,
        }),
        repairHistory: [
          ...(prevProgress?.repairHistory ?? []),
          ...(result.repairHistory ?? []),
        ],
      };
    }

    const report = result.verification?.report;
    const buildOk = report?.build !== "FAILED";
    const testsOk = report?.tests === "PASSED";
    const verificationPassed =
      testsOk && buildOk && report?.status === "VERIFIED" ? projectPlan.requirements.filter((r) => r.status !== "deferred").length : 0;
    const completeness = evaluateCompleteness({
      classification: scale,
      plan: projectPlan,
      files,
      testsPassed: testsOk
        ? Math.max(projectPlan.tests.filter((t) => t.status !== "deferred").length, 1)
        : 0,
      testsTotal: Math.max(projectPlan.tests.filter((t) => t.status !== "deferred").length, 1),
      verificationPassed,
      verificationTotal: Math.max(
        projectPlan.requirements.filter((r) => r.status !== "deferred").length,
        1,
      ),
      runtimeOk: result.success && buildOk,
      buildFailed: !buildOk,
    });
    completeness.storage = [
      this.deps.artifactStorageLabel ??
        (process.env.S3_BUCKET ? "s3" : "S3 NOT CONFIGURED"),
    ];

    const requirementEvidence = evaluateRequirementEvidence({
      requirements: projectPlan.requirements,
      files,
      testsPassed: testsOk,
      buildPassed: buildOk,
    });
    const verifiedCount = requirementEvidence.filter((e) => e.status === "VERIFIED").length;
    completeness.counts.requirements.verified = verifiedCount;
    completeness.counts.verification.verified = verifiedCount;
    completeness.counts.verification.total = Math.max(requirementEvidence.length, 1);

    const waiting = Boolean(result.waitingForProvider);
    if (waiting) {
      completeness.status = "WAITING_FOR_PROVIDER";
      completeness.reason = result.waitingForProvider?.reason ?? "WAITING_FOR_PROVIDER";
    }

    const orchStatus = waiting
      ? "waiting_provider"
      : result.errors?.includes("NO_IMPLEMENTATION_FILES") || !buildOk
        ? "failed"
        : orchestratorStatusFor(completeness);

    const extraNotes = [
      `Engine: CodingAgent (not a static FULL_APPLICATION template).`,
      input.plan.reasoning ?? "",
      (() => {
        const trace = this.deps.providerManager?.getLastStructuredTrace?.();
        if (!trace) return "";
        return `Provider routing: selected=${trace.selectedProvider} validation=${trace.validation} attempts=${trace.attemptCount} fallback=${trace.fallbackReason ?? "none"} attempted=${trace.attempted.join(",")}`;
      })(),
      `Sandbox: CodingWorkspace (local host exec in development, Docker container in production when Docker is available). Never cloudSandbox unless e2b/daytona/modal.`,
      result.inspection?.summary ? `Inspection: ${result.inspection.summary}` : "",
      result.inspection?.framework
        ? `Detected framework: ${result.inspection.framework}`
        : "Default new web apps: Next.js + TypeScript unless an existing stack was detected.",
      `Build: ${report?.build ?? "NOT_RUN"}`,
      `Tests: ${report?.tests ?? "NOT_RUN"}`,
      `Security: ${report?.security ?? "NOT_IMPLEMENTED"}`,
      "Requirement evidence (VERIFIED only with implementation + passing tests):",
      ...requirementEvidence.slice(0, 20).map(
        (e) => `- ${e.requirement}: ${e.status} | impl=${e.implementationEvidence} | tests=${e.testEvidence}`,
      ),
      result.waitingForProvider
        ? `WAITING_FOR_PROVIDER reason=${result.waitingForProvider.reason} retryAt=${result.waitingForProvider.retryAt ?? "unknown"}`
        : "",
      result.moduleProgress?.length
        ? `Modules: ${result.moduleProgress.map((m) => `${m.name}=${m.status}`).join("; ")}`
        : "",
      result.errors?.length ? `Errors: ${result.errors.join("; ")}` : "",
      "A passing build is not equivalent to verified features.",
    ].filter(Boolean);

    const finalResponse = formatProjectCompletionReport({
      plan: projectPlan,
      report: completeness,
      workspaceId,
      runtimeOk: result.success,
      testsOk,
      extraNotes,
    });

    if (this.deps.persistProjectPlan) {
      await this.deps.persistProjectPlan({
        context: { ...input.context, workspaceId },
        taskId: input.taskId,
        workspaceId,
        plan: projectPlan,
        classification: scale,
        completeness,
      });
    }

    input.pushEvent({
      phase:
        orchStatus === "failed"
          ? OrchestratorPhase.FAILED
          : orchStatus === "waiting_provider"
            ? OrchestratorPhase.WAITING_PROVIDER
            : OrchestratorPhase.COMPLETE,
      event:
        orchStatus === "failed"
          ? "TASK_FAILED"
          : orchStatus === "waiting_provider"
            ? "TASK_COMPLETED"
            : "TASK_COMPLETED",
      status: orchStatus === "failed" ? "failed" : "completed",
      detail: completeness.status,
    });

    return {
      taskId: input.taskId,
      goal: input.goal,
      plan: {
        ...input.plan,
        reasoning: `CodingAgent path — ${completeness.status}`,
        steps: [
          {
            id: "coding_agent",
            description: "Inspect, implement, build, test, fix (max 3)",
            toolName: "create_file",
            successCriteria: "multi-file implementation with requirement-based completeness",
          },
        ],
      },
      observations: input.observations,
      verifications: input.verifications,
      events: input.events,
      finalResponse,
      retriesUsed: result.patchesApplied?.length ?? 0,
      status: orchStatus,
      completedAt: new Date(),
      requestScale: scale,
      projectPlan,
      projectStatus: completeness.status,
      completeness,
      architecture: input.context.architecture,
      implementationPlan: input.implementationPlan,
    };
  }

  /** Continue execution after implementation approval. */
  private async runApprovedImplementation(input: {
    taskId: string;
    goal: string;
    plan: Plan;
    context: UserContext;
    history: Message[];
    events: OrchestrationEvent[];
    pushEvent: (e: Omit<OrchestrationEvent, "taskId" | "timestamp">) => void;
    implementationPlan: ImplementationPlan;
    signal?: AbortSignal;
  }): Promise<OrchestratorResult> {
    const need = classifyEvidenceNeed(input.goal);
    let context = { ...input.context };
    const observations: StepObservation[] = [];
    const verifications: VerificationResult[] = [];
    let retriesUsed = 0;
    let status: OrchestratorResult["status"] = "completed";

    if (input.plan.reasoning?.startsWith("Model unavailable")) {
      if (
        this.deps.codingAgent &&
        !shouldUseTemplateBootstrap(
          resolveBootstrapKind(input.goal, input.context.clarificationAnswers),
          input.goal,
          input.context.clarificationAnswers,
        )
      ) {
        return this.runCodingAgentImplementation({
          ...input,
          observations,
          verifications,
        });
      }
      if (shouldCodingBootstrap(input.goal, need) && shouldUseTemplateBootstrap(resolveBootstrapKind(input.goal), input.goal)) {
        return this.codingBootstrapResult({
          taskId: input.taskId,
          goal: input.goal,
          plan: input.plan,
          observations,
          verifications,
          events: input.events,
          context,
          pushEvent: input.pushEvent,
        });
      }
      return {
        taskId: input.taskId,
        goal: input.goal,
        plan: input.plan,
        observations,
        verifications,
        events: input.events,
        finalResponse:
          "Implementation approved but Bharath model weights are NOT_LOADED. Coding bootstrap may still apply for supported templates.",
        retriesUsed: 0,
        status: "failed",
        completedAt: new Date(),
        implementationPlan: input.implementationPlan,
      };
    }

    if ((need.coding || need.localAction) && !context.workspaceId && this.deps.tools.get("create_workspace")) {
      const projectName = extractProjectName(input.goal);
      const created = await this.deps.tools.execute("create_workspace", { projectName });
      const out = created.output as { workspaceId?: string } | null;
      if (created.success && out?.workspaceId) {
        context = { ...context, workspaceId: out.workspaceId };
        input.pushEvent({
          phase: OrchestratorPhase.EXECUTE,
          event: "TOOL_EXECUTED",
          tool: "create_workspace",
          status: "completed",
          detail: out.workspaceId,
        });
      }
    }

    for (const step of this.topologicalSort(input.plan.steps)) {
      if (this.cancelled.has(input.taskId) || input.signal?.aborted) {
        status = "cancelled";
        break;
      }
      const toolArgs = {
        ...(step.toolArgs ?? {}),
        ...(context.workspaceId && !step.toolArgs?.workspaceId
          ? { workspaceId: context.workspaceId }
          : {}),
      };
      const stepWithArgs = { ...step, toolArgs };
      let verified = false;
      while (!verified && retriesUsed <= this.config.maxRetries) {
        this.emitPhase(OrchestratorPhase.EXECUTE, step.description);
        input.pushEvent({
          phase: OrchestratorPhase.EXECUTE,
          event: step.toolName ? "TOOL_SELECTED" : undefined,
          stepId: step.id,
          tool: step.toolName,
          status: "started",
          detail: step.description,
          retryCount: retriesUsed,
        });
        const observation = await this.executeStep(stepWithArgs, input.pushEvent);
        observations.push(observation);
        this.emitPhase(OrchestratorPhase.OBSERVE);
        this.emitPhase(OrchestratorPhase.VERIFY, step.successCriteria);
        const verification = this.engine.verifyToolResult(step, observation);
        verifications.push(verification);
        input.pushEvent({
          phase: OrchestratorPhase.VERIFY,
          event: verification.passed ? "VERIFICATION_PASSED" : "VERIFICATION_FAILED",
          stepId: step.id,
          status: verification.passed ? "completed" : "failed",
          detail: verification.details ?? verification.reason,
        });
        if (verification.passed) {
          verified = true;
        } else if (retriesUsed < this.config.maxRetries) {
          retriesUsed++;
        } else {
          status = "failed";
          break;
        }
      }
      if (status !== "completed") break;
    }

    const scale = input.implementationPlan.scope ?? classifyRequest(input.goal);
    const projectPlan =
      input.implementationPlan.projectPlan ?? buildProjectPlan(input.goal, scale, 1);
    if (input.implementationPlan.architectureDecisions) {
      projectPlan.architecture = input.implementationPlan.architectureDecisions;
    }
    if (input.context.architecture && !projectPlan.architecture) {
      projectPlan.architecture = input.context.architecture;
    }

    let workspaceFiles: string[] = [];
    if (context.workspaceId && this.deps.tools.get("list_files")) {
      const listed = await this.deps.tools.execute("list_files", {
        workspaceId: context.workspaceId,
        path: ".",
      });
      workspaceFiles = Array.isArray((listed.output as { files?: string[] })?.files)
        ? (listed.output as { files: string[] }).files
        : [];
    }

    let completeness = evaluateCompleteness({
      classification: scale,
      plan: projectPlan,
      files: workspaceFiles,
      testsPassed: verifications.filter((v) => v.passed).length,
      testsTotal: Math.max(verifications.length, 1),
      verificationPassed: verifications.filter((v) => v.status === "verified").length,
      verificationTotal: Math.max(verifications.length, 1),
      runtimeOk: status === "completed",
      buildFailed: status === "failed",
    });

    // FULL_APPLICATION must never silently remain a one-page demo.
    const bootstrapKind = resolveBootstrapKind(input.goal, context.clarificationAnswers);
    if (
      completeness.singlePageDemo &&
      this.deps.codingAgent &&
      context.workspaceId &&
      !shouldUseTemplateBootstrap(bootstrapKind, input.goal, context.clarificationAnswers)
    ) {
      return this.runCodingAgentImplementation({
        ...input,
        observations,
        verifications,
        context,
      });
    }
    if (
      completeness.singlePageDemo &&
      shouldUseTemplateBootstrap(bootstrapKind, input.goal, context.clarificationAnswers) &&
      context.workspaceId &&
      status === "completed"
    ) {
      return this.codingBootstrapResult({
        taskId: input.taskId,
        goal: input.goal,
        plan: input.plan,
        observations,
        verifications,
        events: input.events,
        context,
        pushEvent: input.pushEvent,
        bootstrapKind: bootstrapKind ?? undefined,
        clarificationAnswers: context.clarificationAnswers,
      });
    }

    if (status === "completed") {
      status = orchestratorStatusFor(completeness);
    }

    const synthesized = await this.synthesizeResult(
      input.goal,
      input.plan,
      observations,
      verifications,
      status,
      [],
      {
        passed: status !== "failed",
        criteria: "implementation",
        status: status === "failed" ? "failed" : "not_verified",
        evidence: [],
        checks: [],
        reason: completeness.reason,
      },
      false,
    );

    const finalResponse = [
      formatProjectCompletionReport({
        plan: projectPlan,
        report: completeness,
        workspaceId: context.workspaceId,
        runtimeOk: status !== "failed",
        testsOk: completeness.counts.tests.passed > 0,
      }),
      "",
      synthesized,
    ].join("\n");

    this.emitPhase(status === "failed" ? OrchestratorPhase.FAILED : OrchestratorPhase.COMPLETE);
    input.pushEvent({
      phase: status === "failed" ? OrchestratorPhase.FAILED : OrchestratorPhase.COMPLETE,
      event: status === "failed" ? "TASK_FAILED" : "TASK_COMPLETED",
      status: status === "failed" ? "failed" : "completed",
      detail: completeness.status,
    });

    return {
      taskId: input.taskId,
      goal: input.goal,
      plan: input.plan,
      observations,
      verifications,
      events: input.events,
      finalResponse,
      retriesUsed,
      status,
      completedAt: new Date(),
      implementationPlan: input.implementationPlan,
      requestScale: scale,
      projectPlan,
      projectStatus: completeness.status,
      completeness,
      architecture:
        input.implementationPlan.architectureDecisions ?? input.context.architecture,
    };
  }
}

function collectEvidenceFromObservations(
  observations: StepObservation[],
  steps: PlanStep[],
): Evidence[] {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  let evidence: Evidence[] = [];
  for (const obs of observations) {
    const toolName = stepMap.get(obs.stepId)?.toolName;
    if (!toolName) continue;
    evidence = mergeEvidence(evidence, evidenceFromToolResult(toolName, obs.output, obs.timestamp));
  }
  return evidence;
}

function ensureEvidenceSteps(
  plan: Plan,
  goal: string,
  need: EvidenceNeed,
  knownTools: Set<string>,
): Plan {
  if (need.coding || need.localAction) return plan;
  const names = new Set(plan.steps.map((s) => s.toolName).filter(Boolean) as string[]);
  const extra: PlanStep[] = [];

  // Current date/time → local tool only (never force web search)
  if (need.localTime && knownTools.has("get_current_time") && !names.has("get_current_time")) {
    extra.push({
      id: "local-time",
      description: "Get the current local date and time",
      toolName: "get_current_time",
      toolArgs: {},
      successCriteria: "Current date/time retrieved from local clock",
    });
    return { ...plan, steps: [...extra, ...plan.steps] };
  }

  if (need.timeSensitive && knownTools.has("get_current_time") && !names.has("get_current_time")) {
    extra.push({
      id: "evidence-time",
      description: "Record current time for freshness checks",
      toolName: "get_current_time",
      toolArgs: {},
      successCriteria: "Current time retrieved",
    });
  }
  if ((need.web || need.timeSensitive) && knownTools.has("search_web") && !names.has("search_web")) {
    const intent = analyzeSearchIntent(goal);
    const query = intent.generatedQueries[0] ?? goal;
    extra.push({
      id: "evidence-search",
      description: `Search the web for: ${query}`,
      toolName: "search_web",
      toolArgs: { query, limit: 5 },
      successCriteria: "Search returns candidate sources",
    });
  }
  if (need.rag && knownTools.has("search_documents") && !names.has("search_documents")) {
    extra.push({
      id: "evidence-rag",
      description: `Search indexed documents for: ${goal}`,
      toolName: "search_documents",
      toolArgs: { query: goal },
      successCriteria: "Document evidence retrieved",
    });
  }
  if (need.memory && knownTools.has("search_memory") && !names.has("search_memory")) {
    extra.push({
      id: "evidence-memory",
      description: `Search personal memory for: ${goal}`,
      toolName: "search_memory",
      toolArgs: { query: goal },
      successCriteria: "Memory evidence retrieved",
    });
  }

  if (extra.length === 0) return plan;
  return { ...plan, steps: [...extra, ...plan.steps] };
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const matches = trimmed.match(/\{[\s\S]*?\}(?=\s*(?:\{|$))/g);
  if (matches && matches.length > 0) {
    return matches[matches.length - 1]!;
  }
  const greedy = trimmed.match(/\{[\s\S]*\}/);
  return greedy?.[0] ?? trimmed;
}

function sanitizeSteps(steps: PlanStep[], knownTools: Set<string>): PlanStep[] {
  return steps
    .filter((s) => s && typeof s.description === "string" && s.description.trim().length > 0)
    .filter((s) => {
      const desc = s.description.trim().toLowerCase();
      return desc !== "what to do" && desc !== "description";
    })
    .map((s, i) => {
      const rawName = s.toolName?.trim();
      const toolName =
        rawName &&
        !PLACEHOLDER_TOOLS.has(rawName.toLowerCase()) &&
        knownTools.has(rawName)
          ? rawName
          : undefined;
      return {
        ...s,
        id: s.id || `step-${i + 1}`,
        toolName,
        toolArgs: toolName ? (s.toolArgs ?? {}) : undefined,
        successCriteria: s.successCriteria || "Step completes successfully",
      };
    });
}

export type { ToolDefinition };
