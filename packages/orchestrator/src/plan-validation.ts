import type {
  ArchitectureConstraints,
  ImplementationPlan,
  PlanValidationResult,
  ProjectPlan,
} from "@personal-ai/shared";
import { planTextViolatesConstraints } from "./architecture-constraints.js";

const FORBIDDEN_PRODUCTION_PATTERNS = [
  /\blocalstorage\b/i,
  /\bredux\s+persist\b/i,
  /\bin-memory\s+(?:production|store)\b/i,
  /\bconst\s+(students|teachers|users)\s*=\s*\[/i,
  /\bdata\/db\.json\b/i,
];

/** Ignore negated mentions such as "no localStorage" or "not file-json". */
function matchesAffirmativePattern(text: string, re: RegExp): boolean {
  for (const line of text.split("\n")) {
    const normalized = line.replace(/\b(?:no|not|never|without|avoid|reject|forbidden)\s+/gi, "");
    if (re.test(normalized)) return true;
  }
  return false;
}

function collectPlanText(plan: ProjectPlan, impl?: ImplementationPlan): string {
  const parts: string[] = [
    plan.goal,
    plan.architecture?.database ?? "",
    ...(plan.modules ?? []).map((m) => `${m.id} ${m.name} ${m.description ?? ""} ${(m.files ?? []).join(" ")}`),
    ...(plan.requirements ?? []).map((r) => `${r.id} ${r.name} ${r.description ?? ""}`),
    ...(plan.database ?? []).map((d) => `${d.name} ${d.description ?? ""}`),
  ];
  if (impl) {
    parts.push(
      impl.objective,
      impl.architecture,
      impl.database ?? "",
      impl.authentication ?? "",
      ...(impl.files ?? []),
      ...(impl.components ?? []),
    );
  }
  return parts.join("\n");
}

function requiredModuleIds(constraints: ArchitectureConstraints, goal: string): string[] {
  const base = ["MODULE-AUTH", "MODULE-ROLES", "MODULE-DATABASE"];
  if (/student/i.test(goal)) base.push("MODULE-STUDENT");
  if (/teacher/i.test(goal)) base.push("MODULE-TEACHER");
  if (/class/i.test(goal)) base.push("MODULE-CLASS");
  if (/attendance/i.test(goal)) base.push("MODULE-ATTENDANCE");
  if (/dashboard/i.test(goal)) base.push("MODULE-DASHBOARD");
  if (constraints.database === "postgresql") {
    if (!base.includes("MODULE-DATABASE")) base.unshift("MODULE-DATABASE");
  }
  return base;
}

function hasHardcodedFakeStore(plan: ProjectPlan, impl?: ImplementationPlan): boolean {
  const paths = [
    ...(plan.modules ?? []).flatMap((m) => m.files ?? []),
    ...(impl?.files ?? []),
  ];
  if (paths.some((p) => /store\.js$/i.test(p) && !/redux/i.test(p))) {
    const text = collectPlanText(plan, impl);
    if (/file-json|db\.json|json store/i.test(text)) return true;
  }
  return false;
}

/**
 * Validate a ProjectPlan against approved ArchitectureConstraints.
 * Returns PLAN_INVALID with explicit violations — never proceeds silently.
 */
export function validateProjectPlan(
  plan: ProjectPlan,
  constraints: ArchitectureConstraints,
  impl?: ImplementationPlan,
): PlanValidationResult {
  const violations: string[] = [];
  const text = collectPlanText(plan, impl);

  violations.push(...planTextViolatesConstraints(text, constraints));

  for (const re of FORBIDDEN_PRODUCTION_PATTERNS) {
    if (constraints.database === "postgresql" && matchesAffirmativePattern(text, re)) {
      violations.push(`forbidden persistence pattern matched: ${re.source}`);
    }
  }

  if (constraints.database === "postgresql") {
    if (impl?.database && /file[- ]?json|db\.json/i.test(impl.database)) {
      violations.push("implementation plan database field specifies file-json");
    }
    if (plan.architecture?.database === "file-json") {
      violations.push("project plan architecture.database is file-json");
    }
  }

  if (hasHardcodedFakeStore(plan, impl)) {
    violations.push("plan hardcodes JSON store file paths");
  }

  const roleText = text.toLowerCase();
  // Role constraints only apply when auth/RBAC is part of the approved architecture.
  // Marketing/brochure websites with auth=none must not fail for missing ADMIN.
  const enforceRoles =
    constraints.roles.length > 0 &&
    (constraints.authentication !== "none" ||
      /school|management|student|teacher|attendance|rbac|role[- ]based/i.test(plan.goal));
  if (enforceRoles && !constraints.roles.some((r) => roleText.includes(r.toLowerCase()))) {
    violations.push(`approved roles missing from plan: ${constraints.roles.join(", ")}`);
  }

  const moduleIds = new Set((plan.modules ?? []).map((m) => m.id));
  for (const reqId of requiredModuleIds(constraints, plan.goal)) {
    if (!moduleIds.has(reqId) && /school|management|student|teacher|attendance|class|dashboard/i.test(plan.goal)) {
      /* MODULE-DATABASE may be embedded in AUTH for small plans */
      if (reqId === "MODULE-DATABASE" && moduleIds.has("MODULE-AUTH")) continue;
      if (reqId.startsWith("MODULE-") && !moduleIds.has(reqId)) {
        violations.push(`missing required module ${reqId}`);
      }
    }
  }

  const unique = [...new Set(violations)];
  return {
    status: unique.length ? "PLAN_INVALID" : "VALID_PLAN",
    violations: unique,
  };
}

export function freezeApprovedPlan(input: {
  plan: ProjectPlan;
  constraints: ArchitectureConstraints;
  implementationPlan?: ImplementationPlan;
  clarificationAnswers?: Record<string, string>;
}): ProjectPlan {
  const approvalId = crypto.randomUUID();
  const approvedAt = new Date().toISOString();
  const frozen: ProjectPlan = structuredClone(input.plan);
  frozen.implementationProgress = {
    ...(frozen.implementationProgress ?? {
      completedModuleIds: [],
      failedModuleIds: [],
      partialModuleIds: [],
      providersUsed: [],
      attemptCount: 0,
    }),
    lifecycleState: "APPROVED",
    architectureConstraints: input.constraints,
    approvedPlan: {
      approvalId,
      approvedAt,
      plan: structuredClone(input.plan),
      requirements: [...(input.plan.requirements ?? [])],
      constraints: input.constraints,
      implementationPlan: input.implementationPlan
        ? structuredClone(input.implementationPlan)
        : undefined,
      clarificationAnswers: input.clarificationAnswers
        ? { ...input.clarificationAnswers }
        : undefined,
    },
  };
  return frozen;
}

/** Whether persisted project state is sufficient to resume without re-planning. */
export function canResumeStoredProject(
  progress: ProjectPlan["implementationProgress"] | undefined,
  opts?: { hasWorkspace?: boolean },
): boolean {
  if (!progress) return false;
  if (progress.approvedPlan) return true;
  if (progress.architectureConstraints) return true;
  if (progress.waitReason || progress.lifecycleState === "WAITING_FOR_PROVIDER") return true;
  if (opts?.hasWorkspace && (progress.completedModuleIds?.length ?? 0) > 0) return true;
  return ["APPROVED", "IMPLEMENTING", "WAITING_FOR_PROVIDER", "PARTIAL", "REPAIRING"].includes(
    progress.lifecycleState ?? "",
  );
}

/** Resume must use frozen approved plan — never silently mutate architecture. */
export function resolveApprovedPlanForRun(plan: ProjectPlan): {
  plan: ProjectPlan;
  constraints?: ArchitectureConstraints;
  frozen: boolean;
} {
  const approved = plan.implementationProgress?.approvedPlan;
  if (approved) {
    const runPlan = structuredClone(approved.plan);
    runPlan.implementationProgress = {
      ...(plan.implementationProgress ?? {
        completedModuleIds: [],
        failedModuleIds: [],
        partialModuleIds: [],
        providersUsed: [],
        attemptCount: 0,
      }),
      approvedPlan: approved,
      architectureConstraints: approved.constraints,
      lifecycleState: plan.implementationProgress?.lifecycleState ?? "IMPLEMENTING",
    };
    return {
      plan: runPlan,
      constraints: approved.constraints,
      frozen: true,
    };
  }
  return {
    plan,
    constraints: plan.implementationProgress?.architectureConstraints,
    frozen: false,
  };
}

export function lifecycleFromOrchestratorStatus(
  status: string,
): import("@personal-ai/shared").ProjectLifecycleState {
  switch (status) {
    case "awaiting_clarification":
      return "CLARIFYING";
    case "awaiting_implementation_approval":
      return "AWAITING_APPROVAL";
    case "waiting_provider":
      return "WAITING_FOR_PROVIDER";
    case "plan_invalid":
      return "PLANNED";
    case "completed":
      return "COMPLETE";
    case "failed":
      return "FAILED";
    default:
      return "IMPLEMENTING";
  }
}
