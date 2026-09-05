import type {
  ArchitectureDecisions,
  ArchitectureLanguage,
  ArchitectureSource,
  ClarificationQuestion,
  FrameworkDecision,
  FrameworkId,
} from "@personal-ai/shared";
import { isProjectOGoal, isSchoolManagementGoal, isSimpleRestApiGoal, isWebsiteGoal } from "./coding-bootstrap.js";
import {
  deriveArchitectureConstraints,
  constraintsSummary,
} from "./architecture-constraints.js";

export interface WorkspaceInspection {
  files: string[];
  packageJson?: string;
}

export interface FrameworkDecisionInput {
  goal: string;
  inspection?: WorkspaceInspection;
  prior?: ArchitectureDecisions;
  clarificationAnswers?: Record<string, string>;
}

const OPTIONAL_QUESTION_IDS = new Set([
  "stack",
  "framework",
  "language",
  "typescript",
  "folder",
  "lint",
  "testing_framework",
  "frontend_framework",
]);

const OPTIONAL_TECHNICAL_RE =
  /next\.?\s*js\s+or\s+react|react\.?\s*js\s+or\s+next|should i use (next|react)|which framework|what framework|preferred stack|frontend framework|vite\s+or\s+next|next\s+or\s+vite|typescript vs|javascript vs|folder structure|lint(ing)? config|jest or vitest|prettier/i;

const STACK_CHANGE_RE =
  /\b(migrat(?:e|ion)|switch(?:ing)?\s+to|instead\s+use|use\s+(?:next\.?js|vite|react|fastapi)\s+instead|don't\s+use\s+next|do\s+not\s+use\s+next|change\s+(?:the\s+)?(?:stack|framework))\b/i;

/**
 * Select the web stack automatically.
 * Priority: explicit user requirement → existing project → stored plan → constraints → Personal AI default (Next.js + TypeScript).
 * Never ask merely because multiple frameworks are possible.
 */
export function decideFramework(input: FrameworkDecisionInput): ArchitectureDecisions {
  const goal = [input.goal, flattenAnswers(input.clarificationAnswers)].filter(Boolean).join(" ");
  const existing = detectExistingStack(input.inspection);
  const explicit = parseExplicitUserStack(goal);
  const userChanging = STACK_CHANGE_RE.test(goal);

  if (isSimpleRestApiGoal(input.goal)) {
    return make({
      framework: "node-stdlib",
      language: "javascript",
      backend: "express",
      database: "none",
      testing: "jest",
      source: "constraint",
      reason: "Minimal REST API — Express + Node + Jest (no page framework)",
    });
  }

  if (isSchoolManagementGoal(input.goal)) {
    const constraints = deriveArchitectureConstraints(
      input.goal,
      input.clarificationAnswers ?? {},
    );
    const database =
      constraints.database === "postgresql"
        ? constraints.databaseProvider === "neon"
          ? "neon-postgresql"
          : "postgresql"
        : "file-json";
    return make({
      framework: "node-stdlib",
      language: "javascript",
      backend: "node-http",
      database,
      storage: "storage-service",
      testing: "node:test",
      source: "constraint",
      reason: `School-management architecture (${constraintsSummary(constraints)})`,
    });
  }

  if (
    input.prior &&
    !userChanging &&
    !explicitConflictsPrior(explicit, input.prior) &&
    !priorConflictsGoal(input.goal, input.prior)
  ) {
    return {
      ...input.prior,
      source: "existing_plan",
      decision: {
        ...input.prior.decision,
        reason: input.prior.decision.reason || "Reusing stored project architecture",
        confidence: "high",
        user_confirmation_required: false,
      },
    };
  }

  if (existing && !userChanging && !explicit?.forceOverride) {
    return fromExisting(existing);
  }

  if (explicit && !explicit.needsConfirmation) {
    return fromExplicit(explicit, existing);
  }

  if (explicit?.needsConfirmation) {
    return {
      framework: explicit.framework ?? "nextjs",
      language: explicit.language ?? "typescript",
      backend: explicit.backend,
      source: "user",
      decision: {
        framework: explicit.framework ?? "nextjs",
        language: explicit.language ?? "typescript",
        reason: explicit.reason,
        confidence: "low",
        user_confirmation_required: true,
      },
    };
  }

  if (isProjectOGoal(input.goal)) {
    return make({
      framework: "python",
      language: "python",
      backend: "python",
      testing: "pytest",
      source: "constraint",
      reason: "Existing Project O Python ML pipeline",
    });
  }

  if (isSimpleStaticWebsite(input.goal)) {
    return make({
      framework: "static",
      language: "javascript",
      source: "default",
      reason: "Simple website / landing page — static HTML (not a full web application)",
    });
  }

  return make({
    framework: "nextjs",
    language: "typescript",
    backend: "project-default",
    database: "neon-postgres",
    storage: "s3",
    source: "default",
    reason: "Default web application framework",
  });
}

export function formatFrameworkNotice(arch: ArchitectureDecisions): string {
  const { framework, language } = arch;
  if (arch.source === "existing_project") {
    return `I'll keep the existing ${labelFramework(framework)} + ${labelLanguage(language)} stack.`;
  }
  if (arch.source === "existing_plan") {
    return `I'll continue with ${labelFramework(framework)} + ${labelLanguage(language)} (already decided for this project).`;
  }
  if (arch.source === "user") {
    return `I'll use ${labelFramework(framework)} + ${labelLanguage(language)}${arch.backend ? ` with ${arch.backend}` : ""} as requested.`;
  }
  if (framework === "nextjs" && language === "typescript") {
    return "I'll use Next.js + TypeScript for this new web application.";
  }
  if (framework === "python") {
    return "I'll use Python for this project.";
  }
  if (framework === "static") {
    return "I'll use a static HTML site for this website.";
  }
  if (framework === "node-stdlib" && arch.backend === "express") {
    return "I'll use Express + Node.js + Jest for this REST API (minimal stack — no Next.js pages or document layout).";
  }
  if (framework === "node-stdlib") {
    return "I'll use Node.js (stdlib HTTP + HTML pages) for this application.";
  }
  return `I'll use ${labelFramework(framework)} + ${labelLanguage(language)}.`;
}

export function frameworkConfirmationQuestion(
  arch: ArchitectureDecisions,
): ClarificationQuestion | undefined {
  if (!arch.decision.user_confirmation_required) return undefined;
  return {
    id: "framework",
    question:
      "You asked not to use the default stack without naming an alternative. Should I use React + Vite + TypeScript, or another stack you specify?",
    category: "architecture",
    defaultDecision: "React + Vite + TypeScript",
  };
}

/** Optional engineering choices — Orchestrator decides these; do not ask the user. */
export function isOptionalTechnicalQuestion(q: ClarificationQuestion): boolean {
  const id = q.id.toLowerCase();
  if (OPTIONAL_QUESTION_IDS.has(id)) return true;
  const text = q.question;
  if (OPTIONAL_TECHNICAL_RE.test(text)) return true;
  if (q.category === "architecture" && /next\.?\s*js|react\.?\s*js|vite|preferred stack/i.test(text)) {
    if (/\b(model|pipeline|regression|scikit|data source)\b/i.test(text)) return false;
    return true;
  }
  return false;
}

export function filterClarificationQuestions(
  questions: ClarificationQuestion[],
  arch: ArchitectureDecisions,
): ClarificationQuestion[] {
  const necessary = questions.filter((q) => !isOptionalTechnicalQuestion(q));
  const confirm = frameworkConfirmationQuestion(arch);
  if (confirm && !necessary.some((q) => q.id === "framework")) {
    return [confirm, ...necessary];
  }
  return necessary;
}

export function detectExistingStack(
  inspection?: WorkspaceInspection,
): { framework: FrameworkId; language: ArchitectureLanguage; reason: string } | undefined {
  if (!inspection) return undefined;
  const names = inspection.files.map(normalizePath).filter(Boolean);
  if (names.length === 0 && !inspection.packageJson) return undefined;

  const base = names.map((n) => n.split("/").pop() ?? n);
  const has = (re: RegExp) => names.some((n) => re.test(n)) || base.some((n) => re.test(n));

  const pkg = parsePackageJson(inspection.packageJson);
  const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
  const hasTs =
    has(/^tsconfig\.json$/) ||
    Boolean(deps.typescript) ||
    names.some((n) => n.endsWith(".ts") || n.endsWith(".tsx"));

  const language: ArchitectureLanguage = hasTs ? "typescript" : deps.next || deps.react ? "javascript" : "javascript";

  if (has(/^next\.config\.(js|ts|mjs|cjs)$/) || Boolean(deps.next)) {
    return {
      framework: "nextjs",
      language: hasTs || Boolean(deps.typescript) ? "typescript" : "javascript",
      reason: "Existing Next.js project detected",
    };
  }

  if (has(/^vite\.config\.(js|ts|mjs|mts|cjs)$/) || Boolean(deps.vite)) {
    return {
      framework: "react-vite",
      language: hasTs || Boolean(deps.typescript) ? "typescript" : "javascript",
      reason: "Existing Vite + React project detected — USE_EXISTING_STACK",
    };
  }

  if (Boolean(deps.react) && !deps.next) {
    return {
      framework: "react-spa",
      language,
      reason: "Existing React project detected — USE_EXISTING_STACK",
    };
  }

  if (
    has(/^index\.html$/) &&
    !pkg &&
    !has(/^package\.json$/) &&
    !has(/^app\/?$/) &&
    !has(/^src\/?$/)
  ) {
    return {
      framework: "static",
      language: "javascript",
      reason: "Existing static HTML project detected",
    };
  }

  if (names.some((n) => n.endsWith(".py") || n === "requirements.txt") && !pkg) {
    return {
      framework: "python",
      language: "python",
      reason: "Existing Python project detected",
    };
  }

  return undefined;
}

function parseExplicitUserStack(goal: string): {
  framework?: FrameworkId;
  language?: ArchitectureLanguage;
  backend?: string;
  reason: string;
  needsConfirmation: boolean;
  forceOverride: boolean;
} | undefined {
  const g = goal.toLowerCase();

  const rejectsNext =
    /\b(don't|do not|dont|not)\s+(?:use\s+)?next(?:\.?js)?\b/i.test(goal) ||
    /\bno next(?:\.?js)?\b/i.test(g);
  const wantsVite = /\bvite\b/i.test(g);
  const wantsFastApi = /\bfastapi\b/i.test(g);
  const wantsNext = /\bnext\.?js\b|\bnextjs\b/i.test(g) && !rejectsNext;
  const wantsSpa =
    /\bclient[- ]only\b/i.test(g) ||
    /\bspa\b/i.test(g) ||
    /\bstatic frontend\b/i.test(g) ||
    /\breact[- ]only\b/i.test(g);
  const wantsPlainReact =
    /\breact(?:\.?js)?\b/i.test(g) &&
    (wantsVite || wantsSpa || wantsFastApi || /\bplain react\b/i.test(g) || /\bcreate[- ]react[- ]app\b/i.test(g));
  const wantsPython = /\b(python|scikit|pytorch|tensorflow)\b/i.test(g) && !wantsNext && !wantsPlainReact;
  const wantsTs = /\btypescript\b/i.test(g);
  const wantsJs = /\bjavascript\b/i.test(g) && !wantsTs;

  if (rejectsNext && !wantsVite && !wantsPlainReact && !wantsSpa && !wantsFastApi) {
    return {
      reason: "User rejected Next.js without naming an alternative",
      needsConfirmation: true,
      forceOverride: true,
    };
  }

  if (wantsNext && wantsVite) {
    return {
      reason: "User named both Next.js and Vite",
      needsConfirmation: true,
      forceOverride: true,
    };
  }

  if (wantsFastApi && (wantsPlainReact || /\breact\b/i.test(g))) {
    return {
      framework: wantsVite ? "react-vite" : "react-spa",
      language: wantsJs ? "javascript" : "typescript",
      backend: "fastapi",
      reason: "Explicit user requirement: React + FastAPI",
      needsConfirmation: false,
      forceOverride: true,
    };
  }

  if (wantsVite || wantsSpa || wantsPlainReact) {
    return {
      framework: wantsVite ? "react-vite" : "react-spa",
      language: wantsJs ? "javascript" : "typescript",
      reason: wantsVite
        ? "Explicit user requirement: React + Vite"
        : "Client-only SPA / React-only environment",
      needsConfirmation: false,
      forceOverride: true,
    };
  }

  if (wantsNext) {
    return {
      framework: "nextjs",
      language: wantsJs ? "javascript" : "typescript",
      reason: "Explicit user requirement: Next.js",
      needsConfirmation: false,
      forceOverride: true,
    };
  }

  if (wantsPython) {
    return {
      framework: "python",
      language: "python",
      reason: "Explicit user requirement: Python",
      needsConfirmation: false,
      forceOverride: true,
    };
  }

  // Bare "React" without Vite/SPA/FastAPI — Next.js is React. Do not ask.
  return undefined;
}

function isSimpleStaticWebsite(goal: string): boolean {
  if (!isWebsiteGoal(goal)) return false;
  if (/\b(web\s*app(lication)?|full[- ]stack|application)\b/i.test(goal)) return false;
  if (isSchoolManagementGoal(goal)) return false;
  return true;
}

function fromExisting(existing: {
  framework: FrameworkId;
  language: ArchitectureLanguage;
  reason: string;
}): ArchitectureDecisions {
  return make({
    framework: existing.framework,
    language: existing.language,
    source: "existing_project",
    reason: existing.reason,
  });
}

function fromExplicit(
  explicit: {
    framework?: FrameworkId;
    language?: ArchitectureLanguage;
    backend?: string;
    reason: string;
  },
  existing?: { framework: FrameworkId; language: ArchitectureLanguage },
): ArchitectureDecisions {
  const framework = explicit.framework ?? existing?.framework ?? "nextjs";
  const language = explicit.language ?? existing?.language ?? "typescript";
  return make({
    framework,
    language,
    backend: explicit.backend,
    source: "user",
    reason: explicit.reason,
  });
}

function make(opts: {
  framework: FrameworkId;
  language: ArchitectureLanguage;
  backend?: string;
  database?: string;
  storage?: string;
  testing?: string;
  deployment?: string;
  source: ArchitectureSource;
  reason: string;
}): ArchitectureDecisions {
  const decision: FrameworkDecision = {
    framework: opts.framework,
    language: opts.language,
    reason: opts.reason,
    confidence: "high",
    user_confirmation_required: false,
  };
  return {
    framework: opts.framework,
    language: opts.language,
    backend: opts.backend,
    database: opts.database,
    storage: opts.storage,
    testing: opts.testing,
    deployment: opts.deployment,
    source: opts.source,
    decision,
  };
}

function priorConflictsGoal(goal: string, prior: ArchitectureDecisions): boolean {
  if (isSchoolManagementGoal(goal)) {
    return prior.backend === "express" || prior.database === "none";
  }
  if (isSimpleRestApiGoal(goal)) {
    return Boolean(prior.database && prior.database !== "none");
  }
  return false;
}

function explicitConflictsPrior(
  explicit:
    | {
        framework?: FrameworkId;
        forceOverride: boolean;
      }
    | undefined,
  prior: ArchitectureDecisions,
): boolean {
  if (!explicit?.framework) return Boolean(explicit?.forceOverride);
  return explicit.framework !== prior.framework;
}

function flattenAnswers(answers?: Record<string, string>): string {
  if (!answers) return "";
  return Object.entries(answers)
    .filter(([k, v]) => !k.startsWith("__") && v.trim())
    .map(([, v]) => v)
    .join(" ");
}

function parsePackageJson(raw?: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return undefined;
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function labelFramework(id: FrameworkId): string {
  switch (id) {
    case "nextjs":
      return "Next.js";
    case "react-vite":
      return "Vite + React";
    case "react-spa":
      return "React";
    case "static":
      return "static HTML";
    case "node-stdlib":
      return "Node.js stdlib";
    case "python":
      return "Python";
    default:
      return id;
  }
}

function labelLanguage(lang: ArchitectureLanguage): string {
  switch (lang) {
    case "typescript":
      return "TypeScript";
    case "javascript":
      return "JavaScript";
    case "python":
      return "Python";
    default:
      return lang;
  }
}
