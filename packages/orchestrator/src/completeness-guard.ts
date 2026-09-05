import type {
  CompletenessReport,
  PlanItem,
  ProjectPlan,
  ProjectStatus,
  RequestScale,
} from "@personal-ai/shared";

const PLACEHOLDER_RE =
  /\b(TODO|FIXME|coming soon|not implemented|placeholder|dummy data|hardcoded data|empty handler)\b/i;
const MOCK_RE = /\b(MOCK_DATA|mock data|SEED_DATA)\b/i;

export interface CompletenessInput {
  classification: RequestScale;
  plan: ProjectPlan;
  files: string[];
  contents?: Record<string, string>;
  testsPassed: number;
  testsTotal: number;
  verificationPassed: number;
  verificationTotal: number;
  runtimeOk: boolean;
  buildFailed?: boolean;
}

function isPageFile(path: string): boolean {
  const p = path.replace(/\\/g, "/").toLowerCase();
  if (p.includes("/js/") || p.includes("/css/") || p.endsWith(".css") || p.endsWith(".js")) {
    return false;
  }
  if (p.endsWith(".html")) return true;
  if (/(^|\/)page\.tsx$/.test(p) || /(^|\/)page\.jsx$/.test(p)) return true;
  return false;
}

function isApiFile(path: string): boolean {
  const p = path.replace(/\\/g, "/").toLowerCase();
  return (
    p.includes("/routes") ||
    p.includes("/api/") ||
    p.endsWith("routes.js") ||
    p.endsWith("routes.ts") ||
    p.includes("/services/")
  );
}

function isTestFile(path: string): boolean {
  const p = path.replace(/\\/g, "/").toLowerCase();
  return p.includes("/test/") || p.includes("/tests/") || /\.test\.[jt]sx?$/.test(p);
}

function fileExists(files: string[], wanted?: string[]): boolean {
  if (!wanted?.length) return false;
  const set = new Set(files.map((f) => f.replace(/\\/g, "/")));
  return wanted.some((w) => set.has(w) || [...set].some((f) => f.endsWith("/" + w) || f === w));
}

function itemImplemented(item: PlanItem, files: string[]): boolean {
  if (item.status === "deferred" || item.status === "planned") return false;
  if (item.files?.length) return fileExists(files, item.files);
  const needle = item.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!needle) return false;
  return files.some((f) =>
    f
      .toLowerCase()
      .replace(/[^a-z0-9/]+/g, "")
      .includes(needle.slice(0, 12)),
  );
}

function scanHardcodedArrays(contents: Record<string, string> | undefined): string[] {
  if (!contents) return [];
  const hits: string[] = [];
  for (const [path, body] of Object.entries(contents)) {
    if (/readme|test/i.test(path)) continue;
    if (/\bconst\s+(students|teachers|users|fees|attendance)\s*=\s*\[/.test(body) && !MOCK_RE.test(body)) {
      hits.push(path);
    }
  }
  return hits;
}

function scanPlaceholders(contents: Record<string, string> | undefined, requiredFiles: string[]): string[] {
  if (!contents) return [];
  const hits: string[] = [];
  for (const [path, body] of Object.entries(contents)) {
    if (!requiredFiles.some((r) => path.endsWith(r) || path === r)) continue;
    // Honest docs about later phases are not incomplete features.
    if (/readme/i.test(path) || /project_plan/i.test(path) || /schema\.sql/i.test(path)) continue;
    const lines = body.split("\n");
    for (const line of lines) {
      if (PLACEHOLDER_RE.test(line) && !MOCK_RE.test(line)) {
        // Skip comments that defer a later phase explicitly.
        if (/\bphase\s*[23]\b/i.test(line) || /\bnot in scope\b/i.test(line)) continue;
        hits.push(`${path}: ${line.trim().slice(0, 80)}`);
        break;
      }
    }
  }
  return hits;
}

function countMeaningfulPages(files: string[]): string[] {
  return files.filter(isPageFile);
}

/**
 * CompletenessGuard — a successful page render is not project completion.
 * FULL_APPLICATION + a single meaningful page ⇒ PROJECT_INCOMPLETE (never auto-COMPLETE).
 */
export function evaluateCompleteness(input: CompletenessInput): CompletenessReport {
  const { classification, plan, files, contents } = input;
  const pages = countMeaningfulPages(files);
  const apiFiles = files.filter(isApiFile);
  const testFiles = files.filter(isTestFile);

  const requestedReqs = plan.requirements;
  const inScopeReqs = requestedReqs.filter((r) => r.status !== "deferred" && r.status !== "planned");
  const inScopePages = plan.pages.filter((p) => p.status !== "deferred" && p.status !== "planned");
  const inScopeApis = plan.backend.filter((a) => a.status !== "deferred" && a.status !== "planned");
  const inScopeModules = plan.modules.filter((m) => m.status !== "deferred" && m.status !== "planned");
  const inScopeTests = plan.tests.filter((t) => t.status !== "deferred" && t.status !== "planned");

  const implementedReqs = inScopeReqs.filter((r) => {
    const related = [
      ...plan.pages.filter((p) => p.moduleId === r.moduleId),
      ...plan.backend.filter((a) => a.moduleId === r.moduleId),
    ];
    const slug = r.moduleId?.replace(/^MODULE-/, "").toLowerCase();
    const moduleFilesOk =
      Boolean(slug) &&
      files.some((f) => f.toLowerCase().replace(/[^a-z0-9/]/g, "").includes(slug!));
    if (related.length === 0) return itemImplemented(r, files) || moduleFilesOk;
    const ui = related.filter((x) => x.kind === "page");
    const api = related.filter((x) => x.kind === "api");
    const uiOk = ui.length === 0 || ui.some((p) => itemImplemented(p, files));
    const apiOk = api.length === 0 || api.some((a) => itemImplemented(a, files));
    return (uiOk && apiOk) || moduleFilesOk;
  });

  const implementedPages = inScopePages.filter((p) => itemImplemented(p, files) || pages.some((f) => matchesPage(p, f)));
  const implementedApis = inScopeApis.filter((a) => itemImplemented(a, files) || apiFiles.length > 0);
  const implementedModules = inScopeModules.filter((m) => {
    const childPages = plan.pages.filter((p) => p.moduleId === m.id);
    const childApis = plan.backend.filter((a) => a.moduleId === m.id);
    return (
      (childPages.length === 0 || childPages.some((p) => implementedPages.includes(p))) &&
      (childApis.length === 0 || childApis.some((a) => implementedApis.includes(a)))
    );
  });

  const requiredFiles = [
    ...inScopePages.flatMap((p) => p.files ?? []),
    ...inScopeApis.flatMap((a) => a.files ?? []),
  ];
  const placeholders = scanPlaceholders(contents, requiredFiles.length ? requiredFiles : files);

  const incompleteFeatures: string[] = [];
  for (const req of inScopeReqs) {
    if (!implementedReqs.includes(req)) incompleteFeatures.push(`${req.id}: ${req.name}`);
  }
  if (placeholders.length) {
    incompleteFeatures.push(...placeholders.map((p) => `FEATURE_INCOMPLETE ${p}`));
  }

  const hasAuthFiles = files.some((f) => /auth|login|rbac/i.test(f.replace(/\\/g, "/")));
  const hasPersistenceFiles = files.some((f) =>
    /store|db\.json|prisma|schema\.sql|database/i.test(f.replace(/\\/g, "/")),
  );
  const hardcodedArrays = scanHardcodedArrays(contents);

  if (
    (classification === "FULL_APPLICATION" || classification === "LARGE_SYSTEM") &&
    (!hasAuthFiles || !hasPersistenceFiles)
  ) {
    if (!hasAuthFiles) incompleteFeatures.push("missing authentication/authorization");
    if (!hasPersistenceFiles) incompleteFeatures.push("missing persistence (database/store)");
  }
  if (hardcodedArrays.length) {
    incompleteFeatures.push(...hardcodedArrays.map((h) => `FEATURE_INCOMPLETE hardcoded data: ${h}`));
  }

  const deferred = requestedReqs.filter((r) => r.status === "deferred").map((r) => r.name);
  const knownLimitations: string[] = [];
  if (deferred.length) {
    knownLimitations.push(`Deferred (later phases): ${deferred.join("; ")}`);
  }
  if (contents && Object.values(contents).some((c) => MOCK_RE.test(c))) {
    knownLimitations.push("SEED_DATA / demo credentials are for local demo — not a production IdP.");
  }
  const dbKind = plan.architecture?.database ?? "";
  if (/postgres|neon/i.test(dbKind)) {
    knownLimitations.push("PostgreSQL persistence requires DATABASE_URL at runtime.");
  } else if (/file-json|db\.json/i.test(dbKind)) {
    knownLimitations.push("File-backed JSON store is durable in the workspace, not a hosted production database.");
  }

  const singlePageDemo =
    (classification === "FULL_APPLICATION" || classification === "LARGE_SYSTEM") && pages.length <= 1;

  let status: ProjectStatus;
  let reason: string;

  if (input.buildFailed || (!input.runtimeOk && classification !== "SMALL_TASK")) {
    status = "FAILED";
    reason = "Build or runtime checks failed — project is not complete.";
  } else if (singlePageDemo) {
    status = "PROJECT_INCOMPLETE";
    reason =
      "PROJECT_INCOMPLETE: request is a full application but only one meaningful page exists. A successful page render is not a completed application.";
  } else if (
    classification === "SMALL_TASK" &&
    input.runtimeOk &&
    !input.buildFailed &&
    files.some((f) => /\.(py|ts|js|tsx|jsx)$/.test(f))
  ) {
    status = "COMPLETE";
    reason = "Small coding task: source files exist and build/runtime checks did not fail.";
  } else if (
    (classification === "FULL_APPLICATION" || classification === "LARGE_SYSTEM") &&
    (pages.length < 3 || apiFiles.length === 0 || !hasAuthFiles || !hasPersistenceFiles || hardcodedArrays.length)
  ) {
    status = "PROJECT_INCOMPLETE";
    reason = "FULL_APPLICATION requires multiple pages, APIs, authentication, and persistence — not a UI-only or hardcoded-data demo.";
  } else if (incompleteFeatures.length && implementedReqs.length === 0) {
    status = "PROJECT_INCOMPLETE";
    reason = "Required in-scope features were not implemented.";
  } else if (
    requestedReqs.length > inScopeReqs.length ||
    implementedReqs.length < requestedReqs.length ||
    placeholders.length > 0
  ) {
    status = "PARTIAL";
    reason = "In-scope phase implemented; remaining requested modules are not complete. Not claiming full-application COMPLETE.";
  } else if (
    input.testsTotal > 0 &&
    input.testsPassed < input.testsTotal &&
    classification !== "SMALL_TASK"
  ) {
    status = "PARTIAL";
    reason = "Implementation exists but not all tests passed.";
  } else {
    status = "COMPLETE";
    reason = "Requested in-scope requirements were implemented, tested, and verified.";
  }

  // Never allow automatic COMPLETE for a one-page FULL_APPLICATION.
  if (singlePageDemo && status === "COMPLETE") {
    status = "PROJECT_INCOMPLETE";
    reason =
      "CompletenessGuard blocked COMPLETE: FULL_APPLICATION with a single page is PROJECT_INCOMPLETE.";
  }

  const deferredCount = requestedReqs.filter((r) => r.status === "deferred").length;
  const failedReqs = Math.max(0, inScopeReqs.length - implementedReqs.length);

  return {
    status,
    reason,
    counts: {
      requirements: {
        requested: requestedReqs.length,
        implemented: implementedReqs.length,
        tested: Math.min(implementedReqs.length, input.testsPassed),
        verified: Math.min(implementedReqs.length, input.verificationPassed),
        failed: input.buildFailed ? failedReqs : Math.max(0, failedReqs - deferredCount),
        blocked: deferredCount,
      },
      modules: { completed: implementedModules.length, total: plan.modules.length },
      pages: { completed: Math.max(implementedPages.length, pages.length), total: plan.pages.length },
      apis: { completed: Math.max(implementedApis.length, apiFiles.length ? inScopeApis.length : 0), total: plan.backend.length },
      tests: { passed: input.testsPassed, total: Math.max(input.testsTotal, testFiles.length, inScopeTests.length) },
      verification: { verified: input.verificationPassed, total: input.verificationTotal },
    },
    incompleteFeatures,
    placeholders,
    knownLimitations,
    storage: [],
    singlePageDemo,
  };
}

function matchesPage(item: PlanItem, file: string): boolean {
  const f = file.toLowerCase();
  const n = item.name.toLowerCase();
  if (item.files?.some((p) => f.endsWith(p.toLowerCase()) || f.includes(p.toLowerCase()))) return true;
  if (n.includes("login") && f.includes("login")) return true;
  if (n.includes("student") && f.includes("student")) return true;
  if (n.includes("teacher") && f.includes("teacher")) return true;
  if (n.includes("attendance") && f.includes("attendance")) return true;
  if (n.includes("dashboard") && f.includes("dashboard")) return true;
  if (n.includes("class") && f.includes("class")) return true;
  return false;
}

export function orchestratorStatusFor(
  report: CompletenessReport,
): "completed" | "partial" | "failed" | "waiting_provider" {
  if (report.status === "WAITING_FOR_PROVIDER") return "waiting_provider";
  if (report.status === "FAILED") return "failed";
  if (report.status === "COMPLETE") return "completed";
  return "partial";
}
