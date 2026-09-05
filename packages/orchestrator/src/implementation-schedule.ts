import type { ArchitectureConstraints, FileManifest, FileManifestEntry, ProjectPlan } from "@personal-ai/shared";

export interface ModuleWork {
  id: string;
  name: string;
  dependsOn: string[];
  requirements: string[];
  fileHints: string[];
  acceptance: string[];
}

const ACTIVE: Set<string> = new Set([
  "in_scope",
  "in_progress",
  "implemented",
  "tested",
  "verified",
  "partial",
  "failed",
]);

/**
 * Derive minimal per-module file targets from requirements (not a canned school dump).
 * Paths are generic; CodingAgent fills content via ProviderManager.
 */
export function deriveModuleFileHints(
  moduleId: string,
  constraints?: ArchitectureConstraints,
): string[] {
  const usePg = !constraints || constraints.database === "postgresql";
  switch (moduleId) {
    case "MODULE-AUTH":
      return usePg
        ? ["package.json", "src/server.js", "src/auth.js", "test/auth.test.js"]
        : ["package.json", "src/server.js", "src/auth.js", "test/auth.test.js"];
    case "MODULE-DATABASE":
      return usePg
        ? ["schema/schema.sql", "src/db.js"]
        : ["schema/schema.sql"];
    case "MODULE-ROLES":
      return ["src/rbac.js", "test/rbac.test.js"];
    case "MODULE-DASHBOARD":
      return ["src/dashboard.js", "public/dashboard.html", "test/dashboard.test.js"];
    case "MODULE-STUDENT":
      return ["src/students.js", "test/students.test.js"];
    case "MODULE-TEACHER":
      return ["src/teachers.js", "test/teachers.test.js"];
    case "MODULE-ATTENDANCE":
      return ["src/attendance.js", "test/attendance.test.js"];
    case "MODULE-CLASS":
      return ["src/classes.js", "test/classes.test.js"];
    default:
      return [`src/modules/${moduleId.replace(/^MODULE-/, "").toLowerCase()}.js`];
  }
}

/**
 * Build a dependency-ordered module schedule from an approved ProjectPlan.
 * Module names come from the plan — this is not a school-specific agent.
 */
export function buildImplementationSchedule(
  plan: ProjectPlan,
  constraints?: ArchitectureConstraints,
): ModuleWork[] {
  const byId = new Map(plan.modules.map((m) => [m.id, m]));
  const orderedIds: string[] = [];
  if (plan.phases.length) {
    for (const phase of [...plan.phases].sort((a, b) => a.number - b.number)) {
      for (const id of phase.moduleIds) {
        const mod = byId.get(id);
        if (!mod) continue;
        if (mod.status === "deferred" || mod.status === "planned") continue;
        if (!orderedIds.includes(id)) orderedIds.push(id);
      }
    }
  }
  for (const mod of plan.modules) {
    if (mod.status === "deferred" || mod.status === "planned") continue;
    if (!orderedIds.includes(mod.id)) orderedIds.push(mod.id);
  }

  return orderedIds.map((id, index) => {
    const mod = byId.get(id)!;
    const reqs = plan.requirements.filter((r) => r.moduleId === id && ACTIVE.has(r.status));
    const pages = plan.pages.filter((p) => p.moduleId === id);
    const apis = plan.backend.filter((a) => a.moduleId === id);
    const tests = plan.tests.filter((t) => t.moduleId === id);
    const components = plan.components.filter((c) => c.moduleId === id);
    const database = plan.database.filter((d) => d.moduleId === id);
    const auth = plan.authentication.filter((a) => a.moduleId === id);
    const fileHints = unique([
      ...(mod.files ?? []),
      ...pages.flatMap((p) => p.files ?? []),
      ...apis.flatMap((a) => a.files ?? []),
      ...tests.flatMap((t) => t.files ?? []),
      ...components.flatMap((c) => c.files ?? []),
      ...database.flatMap((d) => d.files ?? []),
      ...auth.flatMap((a) => a.files ?? []),
      ...(mod.files?.length ? [] : deriveModuleFileHints(id, constraints)),
    ]);
    return {
      id,
      name: mod.name,
      dependsOn: index > 0 ? [orderedIds[index - 1]!] : [],
      requirements: reqs.map((r) => `[${r.id}] ${r.name}`),
      fileHints,
      acceptance: [
        ...pages.map((p) => `page: ${p.name}`),
        ...apis.map((a) => `api: ${a.name}`),
        ...tests.map((t) => `test: ${t.name}`),
      ],
    };
  });
}

export function manifestFromPlan(plan: ProjectPlan, schedule: ModuleWork[]): FileManifest {
  const files: FileManifestEntry[] = [];
  for (const work of schedule) {
    for (const path of work.fileHints) {
      files.push({
        path,
        purpose: work.name,
        module: work.id,
      });
    }
  }
  return {
    project: plan.project.name,
    modules: schedule.map((m) => ({ id: m.id, name: m.name, dependsOn: m.dependsOn })),
    files,
  };
}

export function chunkManifestFiles(
  files: FileManifestEntry[],
  maxPerChunk = 2,
): FileManifestEntry[][] {
  const chunks: FileManifestEntry[][] = [];
  let current: FileManifestEntry[] = [];
  let moduleId: string | undefined;
  for (const f of files) {
    const split =
      current.length >= maxPerChunk ||
      (moduleId !== undefined && f.module !== moduleId && current.length > 0);
    if (split) {
      chunks.push(current);
      current = [];
    }
    moduleId = f.module;
    current.push(f);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function remainingSchedule(
  schedule: ModuleWork[],
  completedIds: string[],
): ModuleWork[] {
  const done = new Set(completedIds);
  return schedule.filter((m) => !done.has(m.id));
}

function unique(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))];
}
