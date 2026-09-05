import { mkdir, readFile, writeFile, rm, access, readdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  CodingWorkspace,
  CommandAuditEntry,
  SandboxProviderKind,
  WorkspaceExecOptions,
  WorkspaceExecResult,
  WorkspaceInfo,
} from "./coding-workspace.js";
import { PathEscapeError, resolveSafePath } from "./path-safety.js";
import { assertAgentMayModifyPath, isSystemFilePath } from "./system-files.js";

export interface WorkspaceRecord extends WorkspaceInfo {
  /** Absolute filesystem root — LocalWorkspaceManager implementation detail. */
  rootPath: string;
}

export type { WorkspaceExecResult as ExecResult };

export interface LocalWorkspaceManagerOptions {
  /** Absolute path to sandbox root (isolated from production host app). */
  rootDir: string;
  /** Default lifetime in days. */
  defaultLifetimeDays?: number;
  /** Max command runtime in ms. */
  commandTimeoutMs?: number;
  /** Max stdout/stderr capture bytes. */
  maxOutputBytes?: number;
}

const DEFAULT_LIFETIME_DAYS = 30;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT = 256_000;

/** Turn a project display name into a filesystem-safe folder id. */
export function slugifyWorkspaceName(projectName: string): string {
  const base = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!base || base === "." || base === "..") return "project";
  // Keep UUIDs as-is when callers pass them (restore / ensureWorkspace).
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectName.trim())) {
    return projectName.trim().toLowerCase();
  }
  return base;
}

export const SECRET_ENV_KEYS = [
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "CEREBRAS_API_KEY",
  "DATABASE_URL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_SESSION_TOKEN",
  "AUTH_DEV_TOKEN",
  "AUTH_DEV_TOKENS",
  "EMBEDDING_API_KEY",
  "SEARCH_API_KEY",
  "OWN_MODEL_API_KEY",
  "FALLBACK_PROVIDER_API_KEY",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
];

export function sanitizedExecEnv(workspaceRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: workspaceRoot,
    TMPDIR: join(workspaceRoot, ".tmp"),
    NODE_ENV: "development",
    LANG: process.env.LANG ?? "C.UTF-8",
    npm_config_cache: join(workspaceRoot, ".npm"),
    npm_config_update_notifier: "false",
  };
  for (const key of SECRET_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

function isForbiddenHostRoot(rootDir: string): boolean {
  const n = resolve(rootDir).replace(/\\/g, "/").replace(/\/+$/, "");
  const lower = n.toLowerCase();
  if (lower === "/home" || lower === "/users") return true;
  // Refuse well-known dump folders themselves (not every repo that happens to live under Documents).
  if (/\/(desktop|downloads|documents)$/i.test(n)) return true;
  if (/^\/(home|users)\/[^/]+\/(desktop|downloads)(\/|$)/i.test(lower)) return true;
  return false;
}

/**
 * Local / self-hosted CodingWorkspace implementation.
 *
 * LOCAL WORKSPACE ≠ CLOUD SANDBOX
 * Provides: workspace path boundary, command timeout, lifecycle, ownership metadata.
 * Does NOT provide: process isolation, cgroup, seccomp, network isolation, VM isolation.
 *
 * Swap for E2B/Daytona later via the same CodingWorkspace interface.
 */
export class LocalWorkspaceManager implements CodingWorkspace {
  private readonly workspaces = new Map<string, WorkspaceRecord>();
  private readonly rootDir: string;
  private readonly lifetimeDays: number;
  private readonly commandTimeoutMs: number;
  private readonly maxOutputBytes: number;
  readonly commandAudit: CommandAuditEntry[] = [];

  /** Always "self-hosted" — never advertise as cloud. */
  readonly providerKind: SandboxProviderKind = "self-hosted";

  constructor(options: LocalWorkspaceManagerOptions) {
    this.rootDir = resolve(options.rootDir);
    if (isForbiddenHostRoot(this.rootDir)) {
      throw new Error(
        "Workspace root cannot be Desktop, Downloads, Documents, or a home directory root",
      );
    }
    this.lifetimeDays = options.defaultLifetimeDays ?? DEFAULT_LIFETIME_DAYS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  /** Pick a free directory name under the sandbox root from the project name. */
  private async allocateWorkspaceId(projectName: string): Promise<string> {
    const base = slugifyWorkspaceName(projectName);
    let candidate = base;
    let n = 2;
    while (true) {
      if (this.workspaces.has(candidate)) {
        candidate = `${base}-${n}`;
        n += 1;
        if (n > 50) return `${base}-${randomUUID().slice(0, 8)}`;
        continue;
      }
      try {
        await access(join(this.rootDir, candidate));
        candidate = `${base}-${n}`;
        n += 1;
        if (n > 50) return `${base}-${randomUUID().slice(0, 8)}`;
      } catch {
        return candidate;
      }
    }
  }

  async create(userId: string, projectName = "project"): Promise<WorkspaceRecord> {
    await this.ensureRoot();
    const id = await this.allocateWorkspaceId(projectName);
    const rootPath = join(this.rootDir, id);
    await mkdir(rootPath, { recursive: true });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.lifetimeDays);

    const record: WorkspaceRecord = {
      id,
      userId,
      expiresAt,
      sandboxProvider: "self-hosted",
      rootPath,
      projectName: projectName.trim() || "project",
      status: "active",
      createdAt: new Date(),
    };

    this.workspaces.set(id, record);
    await this.writeMeta(record);
    return record;
  }

  get(id: string): WorkspaceRecord | undefined {
    const ws = this.workspaces.get(id);
    if (!ws) return undefined;
    if (ws.status === "active" && ws.expiresAt.getTime() < Date.now()) {
      ws.status = "expired";
    }
    return ws;
  }

  list(userId?: string): WorkspaceRecord[] {
    return [...this.workspaces.values()].filter(
      (w) => w.status !== "deleted" && (!userId || w.userId === userId),
    );
  }

  /** Ownership check — returns undefined if missing or not owned. */
  getOwned(workspaceId: string, userId: string): WorkspaceRecord | undefined {
    const ws = this.get(workspaceId);
    if (!ws || ws.status === "deleted") return undefined;
    if (ws.userId !== userId) return undefined;
    return ws;
  }

  async destroy(id: string): Promise<boolean> {
    const ws = this.workspaces.get(id);
    if (!ws) return false;
    await rm(ws.rootPath, { recursive: true, force: true });
    ws.status = "deleted";
    return true;
  }

  async cleanupExpired(): Promise<number> {
    let count = 0;
    for (const ws of this.workspaces.values()) {
      if (ws.status === "active" && ws.expiresAt.getTime() < Date.now()) {
        await this.destroy(ws.id);
        count++;
      }
    }
    return count;
  }

  /**
   * Resolve a relative path inside the workspace with symlink-aware containment.
   * Throws PathEscapeError on traversal / absolute / symlink escape.
   */
  async resolvePath(workspaceId: string, relativePath: string): Promise<string> {
    const ws = this.requireActive(workspaceId);
    return resolveSafePath(ws.rootPath, relativePath);
  }

  async readFile(workspaceId: string, relativePath: string): Promise<string> {
    const full = await this.resolvePath(workspaceId, relativePath);
    return readFile(full, "utf8");
  }

  async writeFile(workspaceId: string, relativePath: string, content: string): Promise<void> {
    assertAgentMayModifyPath(relativePath, "create");
    const full = await this.resolvePath(workspaceId, relativePath);
    await mkdir(dirname(full), { recursive: true });
    const safe = await this.resolvePath(workspaceId, relativePath);
    await writeFile(safe, content, "utf8");
  }

  async editFile(
    workspaceId: string,
    relativePath: string,
    content: string,
    opts: { createIfMissing?: boolean } = {},
  ): Promise<void> {
    const exists = await this.fileExists(workspaceId, relativePath);
    if (!exists && !opts.createIfMissing) {
      throw new Error(`File not found: ${relativePath}`);
    }
    assertAgentMayModifyPath(relativePath, "edit");
    await this.writeFile(workspaceId, relativePath, content);
  }

  async deleteFile(workspaceId: string, relativePath: string): Promise<void> {
    assertAgentMayModifyPath(relativePath, "delete");
    const full = await this.resolvePath(workspaceId, relativePath);
    await rm(full, { force: true, recursive: true });
  }

  async createDirectory(workspaceId: string, relativePath: string): Promise<void> {
    const full = await this.resolvePath(workspaceId, relativePath);
    await mkdir(full, { recursive: true });
  }

  async listFiles(workspaceId: string, relativePath = "."): Promise<string[]> {
    const full = await this.resolvePath(workspaceId, relativePath);
    const entries = await readdir(full, { withFileTypes: true });
    return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  }

  /** Recursive file listing for artifact sync/restore (skips heavy cache dirs). */
  async listAllFiles(workspaceId: string): Promise<string[]> {
    const ws = this.requireActive(workspaceId);
    const skipDirs = new Set(["node_modules", ".git", ".npm", ".tmp", ".cache"]);
    const results: string[] = [];

    const walk = async (base: string, rel: string): Promise<void> => {
      const full = rel === "." ? base : join(base, rel);
      const entries = await readdir(full, { withFileTypes: true });
      for (const entry of entries) {
        const childRel = rel === "." ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name)) continue;
          await walk(base, childRel);
          continue;
        }
        results.push(childRel.replace(/\\/g, "/"));
      }
    };

    await walk(ws.rootPath, ".");
    return results;
  }

  /**
   * Ensure a workspace directory exists with a fixed id (for cross-process restore).
   * Rebuilds corrupted .workspace.json from Neon-owned metadata when needed.
   */
  async ensureWorkspace(
    userId: string,
    workspaceId: string,
    projectName: string,
  ): Promise<WorkspaceRecord> {
    await this.ensureRoot();
    const existing = this.get(workspaceId);
    if (existing && existing.userId === userId && existing.status !== "deleted") {
      return existing;
    }

    const rootPath = join(this.rootDir, workspaceId);
    await mkdir(rootPath, { recursive: true });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.lifetimeDays);

    let createdAt = new Date();
    try {
      const raw = await readFile(join(rootPath, ".workspace.json"), "utf8");
      const meta = JSON.parse(raw) as {
        id?: string;
        userId?: string;
        projectName?: string;
        expiresAt?: string;
        createdAt?: string;
        sandboxProvider?: SandboxProviderKind;
      };
      if (meta.createdAt) createdAt = new Date(meta.createdAt);
      if (meta.expiresAt) expiresAt.setTime(new Date(meta.expiresAt).getTime());
    } catch {
      // corrupted or missing meta — rebuild below
    }

    const record: WorkspaceRecord = {
      id: workspaceId,
      userId,
      projectName,
      expiresAt,
      sandboxProvider: "self-hosted",
      rootPath,
      status: expiresAt.getTime() < Date.now() ? "expired" : "active",
      createdAt,
    };

    this.workspaces.set(workspaceId, record);
    await this.writeMeta(record);
    return record;
  }

  /** Count generated artifacts excluding reserved system metadata. */
  async countArtifactFiles(workspaceId: string): Promise<number> {
    const files = await this.listAllFiles(workspaceId);
    return files.filter((f) => !isSystemFilePath(f)).length;
  }

  async fileExists(workspaceId: string, relativePath: string): Promise<boolean> {
    try {
      await access(await this.resolvePath(workspaceId, relativePath));
      return true;
    } catch (err) {
      if (err instanceof PathEscapeError) throw err;
      return false;
    }
  }

  /**
   * Run a command inside the workspace root.
   * LOCAL WORKSPACE ≠ CLOUD SANDBOX — command still runs as the gateway user,
   * but with path containment, timeout, output caps, process-group cleanup,
   * and a secret-free environment.
   */
  async exec(
    workspaceId: string,
    command: string,
    options: WorkspaceExecOptions = {},
  ): Promise<WorkspaceExecResult> {
    const ws = this.requireActive(workspaceId);
    const cwd = options.cwd
      ? await this.resolvePath(workspaceId, options.cwd)
      : ws.rootPath;
    const timeoutMs = options.timeoutMs ?? this.commandTimeoutMs;
    const start = Date.now();
    const startedAt = new Date().toISOString();
    await mkdir(join(ws.rootPath, ".tmp"), { recursive: true });

    return new Promise((resolvePromise) => {
      const child = spawn(command, {
        cwd,
        shell: true,
        detached: true,
        env: { ...sanitizedExecEnv(ws.rootPath), ...(options.env ?? {}) },
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const killTree = () => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            // already exited
          }
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killTree();
      }, timeoutMs);

      const finish = (code: number | null, extraErr?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const result: WorkspaceExecResult = {
          exitCode: code ?? (timedOut ? 124 : 1),
          stdout,
          stderr: extraErr ? stderr + extraErr : stderr,
          timedOut,
          durationMs: Date.now() - start,
        };
        this.commandAudit.push({
          workspaceId,
          command: command.slice(0, 500),
          cwd,
          startedAt,
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          timedOut,
        });
        if (this.commandAudit.length > 200) this.commandAudit.shift();
        resolvePromise(result);
      };

      const append = (target: "stdout" | "stderr", chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (target === "stdout") {
          stdout = (stdout + text).slice(0, this.maxOutputBytes);
        } else {
          stderr = (stderr + text).slice(0, this.maxOutputBytes);
        }
      };

      child.stdout?.on("data", (c: Buffer) => append("stdout", c));
      child.stderr?.on("data", (c: Buffer) => append("stderr", c));
      child.on("close", (code) => finish(code));
      child.on("error", (err) => finish(1, err.message));
    });
  }

  async runTests(workspaceId: string, options?: WorkspaceExecOptions): Promise<WorkspaceExecResult> {
    return this.exec(workspaceId, "npm test -- --watch=false", { timeoutMs: 120_000, ...options });
  }

  async runBuild(workspaceId: string, options?: WorkspaceExecOptions): Promise<WorkspaceExecResult> {
    return this.exec(workspaceId, "npm run build", { timeoutMs: 120_000, ...options });
  }

  private requireActive(id: string): WorkspaceRecord {
    const ws = this.get(id);
    if (!ws || ws.status === "deleted") {
      throw new Error(`Workspace not found: ${id}`);
    }
    if (ws.status === "expired") {
      throw new Error(`Workspace expired: ${id}`);
    }
    return ws;
  }

  protected async writeMeta(record: WorkspaceRecord): Promise<void> {
    const metaPath = join(record.rootPath, ".workspace.json");
    await writeFile(
      metaPath,
      JSON.stringify(
        {
          id: record.id,
          userId: record.userId,
          projectName: record.projectName,
          expiresAt: record.expiresAt.toISOString(),
          sandboxProvider: record.sandboxProvider,
          createdAt: record.createdAt.toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  /** Restore workspaces from disk after restart. */
  async restoreFromDisk(): Promise<number> {
    await this.ensureRoot();
    let count = 0;
    try {
      const dirs = await readdir(this.rootDir, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const metaPath = join(this.rootDir, d.name, ".workspace.json");
        const rootPath = join(this.rootDir, d.name);
        try {
          const raw = await readFile(metaPath, "utf8");
          const meta = JSON.parse(raw) as {
            id: string;
            userId: string;
            projectName: string;
            expiresAt: string;
            sandboxProvider: SandboxProviderKind;
            createdAt: string;
          };
          const id = meta.id === d.name ? meta.id : d.name;
          this.workspaces.set(id, {
            id,
            userId: meta.userId,
            projectName: meta.projectName,
            expiresAt: new Date(meta.expiresAt),
            sandboxProvider: meta.sandboxProvider ?? "self-hosted",
            rootPath,
            status: new Date(meta.expiresAt).getTime() < Date.now() ? "expired" : "active",
            createdAt: new Date(meta.createdAt),
          });
          count++;
        } catch {
          // Recover folders that are not UUID-shaped only when they look like project slugs.
          if (!/^[0-9a-f-]{36}$/i.test(d.name) && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(d.name)) {
            continue;
          }
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + this.lifetimeDays);
          this.workspaces.set(d.name, {
            id: d.name,
            userId: "__disk_recovery__",
            projectName: d.name.replace(/-/g, " "),
            expiresAt,
            sandboxProvider: "self-hosted",
            rootPath,
            status: expiresAt.getTime() < Date.now() ? "expired" : "active",
            createdAt: new Date(),
          });
          count++;
        }
      }
    } catch {
      // empty root
    }
    return count;
  }
}

export { PathEscapeError };

/** Development CodingWorkspace — same implementation, stable name for the contract. */
export class LocalCodingWorkspace extends LocalWorkspaceManager {}

