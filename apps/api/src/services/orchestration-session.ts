import type { ClarificationQuestion, ImplementationPlan, Message, ArchitectureConstraints, ProjectLifecycleState } from "@personal-ai/shared";
import type { OrchestratorResult } from "@personal-ai/shared";
import { isProjectResumeRequest } from "@personal-ai/orchestrator";

export interface OrchestrationSession {
  taskId: string;
  userId: string;
  goal: string;
  status:
    | "awaiting_clarification"
    | "awaiting_implementation_approval"
    | "waiting_provider"
    | "implementing";
  clarificationQuestions?: ClarificationQuestion[];
  implementationPlan?: ImplementationPlan;
  clarificationAnswers?: Record<string, string>;
  workspaceId?: string;
  projectId?: string;
  architectureConstraints?: ArchitectureConstraints;
  lifecycleState?: ProjectLifecycleState;
  createdAt: Date;
}

/** In-memory orchestration sessions — keyed by userId (one pending flow per user). */
export class OrchestrationSessionStore {
  private readonly byUser = new Map<string, OrchestrationSession>();
  private readonly byTask = new Map<string, OrchestrationSession>();

  save(session: OrchestrationSession): void {
    this.byUser.set(session.userId, session);
    this.byTask.set(session.taskId, session);
  }

  getByUser(userId: string): OrchestrationSession | undefined {
    return this.byUser.get(userId);
  }

  getByTask(taskId: string): OrchestrationSession | undefined {
    return this.byTask.get(taskId);
  }

  updateAnswers(userId: string, answers: Record<string, string>): OrchestrationSession | undefined {
    const s = this.byUser.get(userId);
    if (!s) return undefined;
    s.clarificationAnswers = { ...s.clarificationAnswers, ...answers };
    return s;
  }

  clear(userId: string): void {
    const s = this.byUser.get(userId);
    if (s) this.byTask.delete(s.taskId);
    this.byUser.delete(userId);
  }
}

const ACTION_RE = /^(approve|yes,?\s*proceed|proceed with implementation|start implementation|use defaults?)\b/i;

/** True when the message starts a new implementation project (not resume / gate follow-up). */
export function isDistinctImplementationGoal(message: string): boolean {
  const m = message.trim();
  if (m.length < 24) return false;
  if (isProjectResumeRequest(m)) return false;
  if (ACTION_RE.test(m)) return false;
  return (
    /\b(build|create|implement)\b/i.test(m) &&
    (/\bschool\s+management\b/i.test(m) ||
      /\bREST API\b/i.test(m) ||
      /\bphase-?\s*1\b/i.test(m) ||
      /\bpostgresql\b/i.test(m) ||
      /\bneon\b/i.test(m))
  );
}

export function goalsAreRelated(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (/\bschool\s+management\b/i.test(na) && /\bschool\s+management\b/i.test(nb)) return true;
  if (/\brest api\b/i.test(na) && /\brest api\b/i.test(nb)) return true;
  return false;
}

/**
 * Whether to reset active project/session pointers for a new unrelated goal.
 * Historical Neon projects are preserved — only the active pointer is cleared.
 */
export function shouldIsolateNewProject(input: {
  message: string;
  session?: OrchestrationSession;
  forceNewProject?: boolean;
  activeProjectId?: string;
}): boolean {
  if (input.forceNewProject) return true;
  if (isProjectResumeRequest(input.message)) return false;
  const action = parseOrchestrationAction(input.message);
  if (action.approve || action.useDefaults) return false;

  const distinct = isDistinctImplementationGoal(input.message);
  if (!distinct) return false;

  if (input.session) {
    if (goalsAreRelated(input.session.goal, input.message)) return false;
    return true;
  }

  return Boolean(input.activeProjectId);
}

function isProjectResumeMessage(message: string): boolean {
  return (
    /\b(continue|resume|pick up|keep going)\b/i.test(message) &&
    /\b(project|school|workspace|management)\b/i.test(message)
  );
}

/** Workspace created during orchestration (create_workspace tool / bootstrap). */
export function extractCreatedWorkspaceId(result: OrchestratorResult): string | undefined {
  return result.observations
    .map((o) => o.output as { output?: { workspaceId?: string }; workspaceId?: string } | null)
    .map((o) => {
      if (!o || typeof o !== "object") return undefined;
      if ("workspaceId" in o && typeof o.workspaceId === "string") return o.workspaceId;
      const nested = (o as { output?: { workspaceId?: string } }).output;
      return nested?.workspaceId;
    })
    .find((id): id is string => Boolean(id));
}

const RESUMABLE_LIFECYCLE: ProjectLifecycleState[] = [
  "APPROVED",
  "IMPLEMENTING",
  "WAITING_FOR_PROVIDER",
  "PARTIAL",
  "REPAIRING",
];

/** Keep session when project can be resumed (never clear on partial). */
export function shouldPersistOrchestrationSession(result: OrchestratorResult): boolean {
  if (result.status === "partial" || result.status === "waiting_provider") return true;
  const lifecycle = result.projectPlan?.implementationProgress?.lifecycleState;
  if (lifecycle && RESUMABLE_LIFECYCLE.includes(lifecycle)) return true;
  if (result.projectStatus && result.projectStatus !== "COMPLETE") return true;
  return false;
}

export function buildResumeOrchestrationSession(input: {
  result: OrchestratorResult;
  userId: string;
  goal: string;
  session?: OrchestrationSession;
  clarificationAnswers?: Record<string, string>;
  resolvedWorkspaceId?: string;
  resolvedProjectId?: string;
}): OrchestrationSession {
  const createdWs = extractCreatedWorkspaceId(input.result);
  const lifecycle =
    input.result.projectPlan?.implementationProgress?.lifecycleState ??
    (input.result.status === "partial"
      ? "PARTIAL"
      : input.result.status === "waiting_provider"
        ? "WAITING_FOR_PROVIDER"
        : "IMPLEMENTING");

  return {
    taskId: input.result.taskId,
    userId: input.userId,
    goal: input.goal,
    status:
      input.result.status === "waiting_provider" || lifecycle === "WAITING_FOR_PROVIDER"
        ? "waiting_provider"
        : "implementing",
    implementationPlan: input.result.implementationPlan,
    clarificationAnswers:
      input.clarificationAnswers ?? input.session?.clarificationAnswers,
    workspaceId:
      createdWs ?? input.resolvedWorkspaceId ?? input.session?.workspaceId,
    projectId: input.resolvedProjectId ?? input.session?.projectId,
    lifecycleState: lifecycle,
    architectureConstraints:
      input.result.projectPlan?.implementationProgress?.architectureConstraints ??
      input.session?.architectureConstraints,
    createdAt: input.session?.createdAt ?? new Date(),
  };
}

/** Resolve workspace/project for orchestrate — never reuse workspace on fresh approval. */
export function resolveOrchestrationIdentity(input: {
  message: string;
  bodyWorkspaceId?: string;
  bodyProjectId?: string;
  session?: OrchestrationSession;
  activeWorkspaceId?: string;
  activeProjectId?: string;
  implementationApproved?: boolean;
  forceNewProject?: boolean;
  persisted?: { projectId?: string | null; workspaceId?: string | null; taskId?: string | null } | null;
}): {
  isResume: boolean;
  workspaceId?: string;
  projectId?: string;
  forceNewWorkspace: boolean;
  forceNewProject: boolean;
} {
  const isResume = isProjectResumeRequest(input.message);
  const startingFreshImplementation = Boolean(input.implementationApproved && !isResume);
  const startingNewProject = Boolean(input.forceNewProject && !isResume);
  const persistedProjectId =
    input.persisted?.projectId ?? input.persisted?.taskId ?? undefined;
  const persistedWorkspaceId = input.persisted?.workspaceId ?? undefined;

  if (startingNewProject) {
    return {
      isResume,
      workspaceId: undefined,
      projectId: undefined,
      forceNewWorkspace: true,
      forceNewProject: true,
    };
  }

  if (startingFreshImplementation) {
    return {
      isResume,
      workspaceId: undefined,
      projectId: input.bodyProjectId ?? input.session?.projectId ?? persistedProjectId,
      forceNewWorkspace: true,
      forceNewProject: false,
    };
  }

  if (isResume) {
    return {
      isResume,
      workspaceId:
        input.bodyWorkspaceId ??
        input.session?.workspaceId ??
        persistedWorkspaceId ??
        undefined,
      projectId:
        input.bodyProjectId ??
        input.session?.projectId ??
        persistedProjectId ??
        undefined,
      forceNewWorkspace: false,
      forceNewProject: false,
    };
  }

  return {
    isResume,
    workspaceId:
      input.bodyWorkspaceId ??
      input.session?.workspaceId ??
      input.activeWorkspaceId,
    projectId:
      input.bodyProjectId ??
      input.session?.projectId ??
      input.activeProjectId,
    forceNewWorkspace: false,
    forceNewProject: false,
  };
}

/** Resolve the real goal when user sends a follow-up action ("approve", "use defaults"). */
export function resolveOrchestrationGoal(
  message: string,
  history: Message[],
  opts: {
    originalGoal?: string;
    session?: OrchestrationSession;
  },
): string {
  if (opts.session?.goal) return opts.session.goal;
  if (opts.originalGoal?.trim()) return opts.originalGoal.trim();
  if (!ACTION_RE.test(message.trim())) return message;

  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.role === "user" && h.content.length > 20 && !ACTION_RE.test(h.content.trim())) {
      return h.content;
    }
  }

  return message;
}

export function parseOrchestrationAction(message: string): {
  useDefaults: boolean;
  approve: boolean;
} {
  const m = message.trim().toLowerCase();
  return {
    useDefaults: /^use defaults?\b/.test(m),
    approve: /^(approve|yes,?\s*proceed|proceed with implementation|start implementation)\b/.test(m),
  };
}

/** Parse a user's free-text reply into per-question clarification answers. */
export function parseClarificationReply(
  message: string,
  questions: ClarificationQuestion[],
): Record<string, string> {
  const trimmed = message.trim();
  if (!trimmed || ACTION_RE.test(trimmed)) return {};

  const lines = trimmed
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
    .filter(Boolean);

  const out: Record<string, string> = {};

  if (lines.length >= questions.length) {
    questions.forEach((q, i) => {
      if (lines[i]) out[q.id] = lines[i]!;
    });
    return out;
  }

  if (lines.length === 1 && questions.length === 1) {
    out[questions[0]!.id] = lines[0]!;
    return out;
  }

  const blob = lines.join(" ");

  for (const q of questions) {
    const id = q.id.toLowerCase();
    const cat = (q.category ?? "").toLowerCase();

    if ((id === "auth" || cat === "security") && /jwt|password|sso|google|microsoft|auth|login/i.test(blob)) {
      out[q.id] = blob.match(/(?:jwt|email\/password|sso[^,.]*|google[^,.]*|microsoft[^,.]*)/i)?.[0] ?? blob;
      continue;
    }
    if ((id === "roles" || cat === "roles") && /admin|teacher|student|parent|role/i.test(blob)) {
      out[q.id] = blob.match(/(?:admin[^,.]*|teacher[^,.]*|student[^,.]*|parent[^,.]*|roles?[^,.]*)/i)?.[0] ?? blob;
      continue;
    }
    if ((id === "deployment" || cat === "deployment") && /local|cloud|vercel|docker|vps|deploy|neon/i.test(blob)) {
      out[q.id] = blob.match(/(?:local[^,.]*|cloud[^,.]*|vercel[^,.]*|docker[^,.]*|vps[^,.]*|deploy[^,.]*)/i)?.[0] ?? blob;
      continue;
    }
    if ((id === "stack" || cat === "architecture") && /next|fastify|node|postgres|react|python/i.test(blob)) {
      out[q.id] = blob;
      continue;
    }
    if (id === "scope" && blob.length > 8) {
      out[q.id] = blob;
      continue;
    }
    if ((id === "data_source" || id === "model_type") && blob.length > 8) {
      out[q.id] = blob;
    }
  }

  const answered = Object.keys(out).length;
  if (answered === 0) {
    out.__user_clarification = blob;
  } else if (answered < questions.length) {
    out.__user_clarification = blob;
  }

  return out;
}

export function parseOrchestrationContext(
  message: string,
  body: {
    clarificationAnswers?: Record<string, string>;
    implementationApproved?: boolean;
  },
  session?: OrchestrationSession,
): {
  clarificationAnswers?: Record<string, string>;
  implementationApproved?: boolean;
} {
  const action = parseOrchestrationAction(message);
  const out: {
    clarificationAnswers?: Record<string, string>;
    implementationApproved?: boolean;
  } = {};

  const merged = {
    ...session?.clarificationAnswers,
    ...body.clarificationAnswers,
  };

    if (session?.status === "awaiting_clarification" && !action.useDefaults && !action.approve) {
      const parsed = parseClarificationReply(message, session.clarificationQuestions ?? []);
      Object.assign(merged, parsed);
    }

    if (
      (session?.status === "waiting_provider" || session?.lifecycleState === "WAITING_FOR_PROVIDER") &&
      isProjectResumeMessage(message)
    ) {
      out.implementationApproved = true;
    }

    if (session?.lifecycleState === "PARTIAL" && isProjectResumeMessage(message)) {
      out.implementationApproved = true;
    }

    if (session?.status === "awaiting_implementation_approval" && !action.approve && !action.useDefaults) {
    merged.__plan_amendment = message.trim();
  }

  if (Object.keys(merged).length) out.clarificationAnswers = merged;

  if (body.implementationApproved || action.approve) out.implementationApproved = true;
  if (action.useDefaults) {
    out.clarificationAnswers = { ...out.clarificationAnswers, __use_defaults: "true" };
  }
  return out;
}
