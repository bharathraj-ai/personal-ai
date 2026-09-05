import type { ArchitectureConstraints, ArchitectureDecisions } from "@personal-ai/shared";
import { isSchoolManagementGoal, isWebsiteGoal } from "./coding-bootstrap.js";

const POSTGRES_RE =
  /\b(postgres(?:ql)?|neon|DATABASE_URL|sql\s+persist|relational\s+db)\b/i;
const FILE_JSON_RE = /\b(file[- ]?json|db\.json|json\s+file|file-backed)\b/i;
const LOCAL_STORAGE_RE = /\b(localstorage|redux\s+persist|in-memory\s+production)\b/i;
const SESSION_RE = /\b(session|email\/password|cookie|signed\s+session)\b/i;
const JWT_RE = /\b(jwt|bearer\s+token)\b/i;
const SSO_RE = /\b(sso|google|microsoft|oauth)\b/i;
const S3_RE = /\b(s3|S3_BUCKET|storage-service)\b/i;
const EXPLICIT_RBAC_RE =
  /\b(rbac|role[- ]based|admin\s+role|teacher\s+role|student\s+role|user\s+roles?)\b/i;

function extractListedRoles(text: string): string[] {
  const roles: string[] = [];
  if (/\badmin\b/i.test(text)) roles.push("ADMIN");
  if (/\bteacher\b/i.test(text)) roles.push("TEACHER");
  if (/\bstudent\b/i.test(text)) roles.push("STUDENT");
  if (/\bparent\b/i.test(text)) roles.push("PARENT");
  return roles;
}

/**
 * Roles are only frozen when the user explicitly chose them, the goal is a
 * school/management system, or the goal clearly asks for RBAC.
 * Do NOT scrape "Admin" out of unrelated clarification prose for marketing websites.
 */
function normalizeRoles(
  goal: string,
  answers: Record<string, string>,
  authentication: ArchitectureConstraints["authentication"],
): string[] {
  if (authentication === "none" && !isSchoolManagementGoal(goal) && !EXPLICIT_RBAC_RE.test(goal)) {
    // Public brochure / company website — no login means no frozen RBAC roles.
    if (isWebsiteGoal(goal) && !answers.roles?.trim()) return [];
  }

  if (answers.roles?.trim()) {
    const listed = extractListedRoles(answers.roles);
    if (listed.length) return listed;
  }

  const goalRoles = extractListedRoles(goal);
  if (goalRoles.length && (EXPLICIT_RBAC_RE.test(goal) || isSchoolManagementGoal(goal))) {
    return goalRoles;
  }

  if (isSchoolManagementGoal(goal)) return ["ADMIN", "TEACHER", "STUDENT"];
  return [];
}

/** Derive immutable architecture constraints from goal + clarification answers. */
export function deriveArchitectureConstraints(
  goal: string,
  answers: Record<string, string> = {},
): ArchitectureConstraints {
  const blob = [
    goal,
    answers.scope,
    answers.roles,
    answers.auth,
    answers.deployment,
    answers.__plan_amendment,
    answers.__user_clarification,
  ]
    .filter(Boolean)
    .join(" ");

  const database = POSTGRES_RE.test(blob)
    ? "postgresql"
    : FILE_JSON_RE.test(blob)
      ? "file-json"
      : isSchoolManagementGoal(goal)
        ? "postgresql"
        : "none";

  const databaseProvider = /neon/i.test(blob)
    ? "neon"
    : database === "postgresql"
      ? "generic"
      : database === "none"
        ? undefined
        : "local-file";

  const authentication = SSO_RE.test(blob) && !SESSION_RE.test(blob)
    ? "sso"
    : JWT_RE.test(blob) && !SESSION_RE.test(blob)
      ? "jwt"
      : SESSION_RE.test(blob) || (/\bemail\/password\b/i.test(blob) && !isWebsiteGoal(goal))
        ? "session"
        : isSchoolManagementGoal(goal)
          ? "session"
          : "none";

  // Simple company/marketing websites should not inherit session auth from
  // generic "authentication" wording in scope defaults.
  const authFinal =
    isWebsiteGoal(goal) &&
    !isSchoolManagementGoal(goal) &&
    !SESSION_RE.test(answers.auth ?? "") &&
    !SSO_RE.test(answers.auth ?? "") &&
    !JWT_RE.test(answers.auth ?? "") &&
    !/\b(login|sign[- ]?in|accounts?)\b/i.test(goal)
      ? "none"
      : authentication;

  const roles = normalizeRoles(goal, answers, authFinal);
  const storage = S3_RE.test(blob) ? "storage-service" : "storage-service";

  return {
    database,
    databaseProvider,
    authentication: authFinal,
    roles,
    storage,
    storageFallback: "local-file",
  };
}

/** Apply approved constraints onto architecture decisions (does not weaken user choices). */
export function applyConstraintsToArchitecture(
  architecture: ArchitectureDecisions,
  constraints: ArchitectureConstraints,
): ArchitectureDecisions {
  const database =
    constraints.database === "postgresql"
      ? constraints.databaseProvider === "neon"
        ? "neon-postgresql"
        : "postgresql"
      : constraints.database;

  return {
    ...architecture,
    database,
    storage: constraints.storage === "storage-service" ? "storage-service" : architecture.storage,
    deployment: constraints.database === "postgresql" ? "postgresql-via-env" : architecture.deployment,
  };
}

export function constraintsSummary(constraints: ArchitectureConstraints): string {
  return [
    `database=${constraints.database}${constraints.databaseProvider ? ` (${constraints.databaseProvider})` : ""}`,
    `auth=${constraints.authentication}`,
    `roles=${constraints.roles.join(",")}`,
    `storage=${constraints.storage}${constraints.storageFallback ? ` fallback=${constraints.storageFallback}` : ""}`,
  ].join("; ");
}

/** Detect forbidden persistence patterns in plan text or file paths. */
export function planTextViolatesConstraints(
  text: string,
  constraints: ArchitectureConstraints,
): string[] {
  const violations: string[] = [];
  const lower = text.toLowerCase();

  if (constraints.database === "postgresql") {
    if (FILE_JSON_RE.test(lower) || /\bdata\/db\.json\b/.test(lower)) {
      violations.push("plan specifies file-json persistence but PostgreSQL was approved");
    }
    if (LOCAL_STORAGE_RE.test(lower)) {
      violations.push("plan specifies client/localStorage persistence but PostgreSQL was approved");
    }
    if (/\bsrc\/store\.js\b.*json/i.test(lower)) {
      violations.push("plan hardcodes src/store.js JSON store");
    }
  }

  if (constraints.authentication === "session" && /\bsso only\b/i.test(lower)) {
    violations.push("plan specifies SSO-only auth but email/password sessions were approved");
  }

  return violations;
}
