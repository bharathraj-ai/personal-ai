import type { CodingWorkspace } from "./coding-workspace.js";

export interface WorkspaceInspection {
  files: string[];
  packageJson?: string;
  lockfile?: string;
  lockfileName?: string;
  framework?: string;
  typescript: boolean;
  hasAppDir: boolean;
  hasSrcDir: boolean;
  routes: string[];
  components: string[];
  apiFiles: string[];
  tests: string[];
  configFiles: string[];
  summary: string;
}

const INSPECT_CANDIDATES = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "tsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "vite.config.ts",
  "vite.config.js",
  "prisma/schema.prisma",
  ".env.example",
];

function detectFramework(files: string[], pkg?: string): string | undefined {
  const joined = files.join(" ").toLowerCase();
  if (pkg?.includes('"next"') || files.some((f) => /next\.config/i.test(f))) return "next.js";
  if (pkg?.includes('"vite"') || /vite\.config/.test(joined)) return "vite";
  if (pkg?.includes('"express"')) return "express";
  if (files.some((f) => f.endsWith(".html")) && !pkg) return "static-html";
  return undefined;
}

export async function inspectWorkspace(
  workspace: CodingWorkspace,
  workspaceId: string,
): Promise<WorkspaceInspection> {
  const listed = await workspace.listFiles(workspaceId, ".");
  const files = listed.map((f) => f.replace(/\\/g, "/"));

  for (const dir of ["src", "app", "pages", "components", "lib", "services", "api", "database", "tests", "test"]) {
    if (!files.some((f) => f === dir || f.startsWith(`${dir}/`))) continue;
    try {
      const inner = await workspace.listFiles(workspaceId, dir);
      for (const f of inner) {
        const path = f.replace(/\\/g, "/");
        const full = path.startsWith(`${dir}/`) ? path : `${dir}/${path}`;
        if (!files.includes(full)) files.push(full);
      }
    } catch {
      // directory may not exist
    }
  }

  let packageJson: string | undefined;
  if (files.some((f) => /(^|\/)package\.json$/.test(f)) && workspace.readFile) {
    try {
      packageJson = await workspace.readFile(workspaceId, "package.json");
    } catch {
      packageJson = undefined;
    }
  }

  let lockfile: string | undefined;
  let lockfileName: string | undefined;
  for (const name of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
    if (files.some((f) => f === name || f.endsWith(`/${name}`))) {
      lockfileName = name;
      try {
        lockfile = (await workspace.readFile(workspaceId, name)).slice(0, 2000);
      } catch {
        lockfile = undefined;
      }
      break;
    }
  }

  const typescript =
    files.some((f) => /\.tsx?$/.test(f) || f === "tsconfig.json") ||
    Boolean(packageJson?.includes("typescript"));

  const routes = files.filter((f) => /route\.(ts|js|tsx)$/i.test(f) || /\/api\//.test(f));
  const components = files.filter((f) => /\/components\//i.test(f));
  const apiFiles = files.filter((f) => /\/(api|routes|services)\//i.test(f));
  const tests = files.filter((f) => /\.test\.[jt]sx?$/.test(f) || /\/tests?\//.test(f));
  const configFiles = files.filter((f) => INSPECT_CANDIDATES.includes(f.split("/").pop() ?? ""));
  const framework = detectFramework(files, packageJson);

  const summary = [
    `files=${files.length}`,
    framework ? `framework=${framework}` : "framework=unknown",
    `typescript=${typescript}`,
    lockfileName ? `lockfile=${lockfileName}` : "lockfile=none",
    `routes=${routes.length}`,
    `tests=${tests.length}`,
  ].join("; ");

  return {
    files,
    packageJson,
    lockfile,
    lockfileName,
    framework,
    typescript,
    hasAppDir: files.some((f) => f === "app" || f.startsWith("app/")),
    hasSrcDir: files.some((f) => f === "src" || f.startsWith("src/")),
    routes,
    components,
    apiFiles,
    tests,
    configFiles,
    summary,
  };
}
