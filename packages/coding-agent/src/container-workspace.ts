import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspaceExecOptions, WorkspaceExecResult } from "./coding-workspace.js";
import { LocalCodingWorkspace, type LocalWorkspaceManagerOptions } from "./local-workspace.js";

export interface ContainerCodingWorkspaceOptions extends LocalWorkspaceManagerOptions {
  /** Docker/OCI image used for exec (not for file IO). */
  image?: string;
  memory?: string;
  cpus?: string;
  pidsLimit?: number;
}

/**
 * Production CodingWorkspace executor.
 *
 * File IO stays on a host bind-mount (path-bounded). Commands run in Docker:
 * network=none, dropped caps, memory/CPU/pids limits, secret-free env,
 * workspace mounted at /workspace only.
 *
 * This is NOT a cloud VM/E2B sandbox. Report provider = "container".
 * Never advertise cloudSandbox=true.
 */
export class ContainerCodingWorkspace extends LocalCodingWorkspace {
  override readonly providerKind = "container" as const;
  private readonly image: string;
  private readonly memory: string;
  private readonly cpus: string;
  private readonly pidsLimit: number;

  constructor(options: ContainerCodingWorkspaceOptions) {
    super(options);
    this.image = options.image ?? process.env.WORKSPACE_CONTAINER_IMAGE ?? "node:22-bookworm-slim";
    this.memory = options.memory ?? process.env.WORKSPACE_MEMORY ?? "512m";
    this.cpus = options.cpus ?? process.env.WORKSPACE_CPUS ?? "1";
    this.pidsLimit = options.pidsLimit ?? Number(process.env.WORKSPACE_PIDS_LIMIT ?? 256);
  }

  override async create(userId: string, projectName = "project") {
    const record = await super.create(userId, projectName);
    record.sandboxProvider = "container";
    await this.writeMeta(record);
    return record;
  }

  /**
   * Execute inside a disposable container. Host spawn is not used for user commands.
   */
  override async exec(
    workspaceId: string,
    command: string,
    options: WorkspaceExecOptions = {},
  ): Promise<WorkspaceExecResult> {
    const ws = this.get(workspaceId);
    if (!ws || ws.status !== "active") {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    const timeoutMs = options.timeoutMs ?? 60_000;
    const start = Date.now();
    const startedAt = new Date().toISOString();
    await mkdir(join(ws.rootPath, ".tmp"), { recursive: true });

    const innerCwd = options.cwd ? `/workspace/${options.cwd.replace(/^\/+/, "")}` : "/workspace";
    const uid = typeof process.getuid === "function" ? process.getuid() : 65534;
    const gid = typeof process.getgid === "function" ? process.getgid() : 65534;

    const args = [
      "run",
      "--rm",
      "--network",
      "none",
      "--memory",
      this.memory,
      "--cpus",
      this.cpus,
      "--pids-limit",
      String(this.pidsLimit),
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,nosuid,size=64m",
      "--user",
      `${uid}:${gid}`,
      "-v",
      `${ws.rootPath}:/workspace:rw`,
      "-w",
      innerCwd,
      "-e",
      "HOME=/workspace",
      "-e",
      "TMPDIR=/tmp",
      "-e",
      "NODE_ENV=development",
      "-e",
      "npm_config_cache=/workspace/.npm",
      "-e",
      "npm_config_update_notifier=false",
      "-e",
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      this.image,
      "sh",
      "-c",
      command,
    ];

    return new Promise((resolvePromise) => {
      const child = spawn("docker", args, {
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      const max = 256_000;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
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
          command: `[container] ${command}`.slice(0, 500),
          cwd: innerCwd,
          startedAt,
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          timedOut,
        });
        if (this.commandAudit.length > 200) this.commandAudit.shift();
        resolvePromise(result);
      };

      child.stdout?.on("data", (c: Buffer) => {
        stdout = (stdout + c.toString("utf8")).slice(0, max);
      });
      child.stderr?.on("data", (c: Buffer) => {
        stderr = (stderr + c.toString("utf8")).slice(0, max);
      });
      child.on("close", (code) => finish(code));
      child.on("error", (err) => finish(1, err.message));
    });
  }
}

export async function dockerAvailable(): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn("docker", ["info"], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolvePromise(ok);
    };
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      done(false);
    }, 4000);
    child.on("close", (code) => {
      clearTimeout(t);
      done(code === 0);
    });
    child.on("error", () => {
      clearTimeout(t);
      done(false);
    });
  });
}
