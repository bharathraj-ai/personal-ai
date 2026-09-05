/**
 * CodingWorkspace — provider-agnostic workspace contract.
 *
 * Tools and the Gateway depend on this interface, NOT on LocalWorkspaceManager.
 *
 * Current: LocalWorkspaceManager (self-hosted / local)
 * Future: E2BWorkspaceManager | FirecrackerWorkspaceManager
 *
 * LOCAL WORKSPACE ≠ CLOUD SANDBOX
 * Local provides path boundary + timeout + lifecycle only — not process,
 * cgroup, seccomp, network, or VM isolation.
 */

export type SandboxProviderKind = "self-hosted" | "container" | "e2b" | "daytona" | "modal";

export interface WorkspaceInfo {
  id: string;
  userId: string;
  projectName: string;
  expiresAt: Date;
  /** Actual provider — never claim "cloud" for local dirs. */
  sandboxProvider: SandboxProviderKind;
  status: "active" | "expired" | "deleted";
  createdAt: Date;
}

export interface WorkspaceExecOptions {
  timeoutMs?: number;
  cwd?: string;
  /** Extra env vars merged into the sanitized workspace exec environment. */
  env?: Record<string, string>;
}

export interface WorkspaceExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface CommandAuditEntry {
  workspaceId: string;
  command: string;
  cwd: string;
  startedAt: string;
  durationMs: number;
  exitCode: number;
  timedOut: boolean;
}

export interface CreateWorkspaceOptions {
  userId: string;
  projectName?: string;
}

/**
 * Framework-independent coding workspace surface.
 * Implementations must enforce path containment (including symlink escape).
 * Tools MUST depend on this interface, never a concrete local manager.
 */
export interface CodingWorkspace {
  /** Create a new workspace owned by userId. */
  create(userId: string, projectName?: string): Promise<WorkspaceInfo>;

  /** Resolve a relative path inside the workspace; throws on escape. */
  resolvePath(workspaceId: string, relativePath: string): string | Promise<string>;

  readFile(workspaceId: string, relativePath: string): Promise<string>;

  writeFile(workspaceId: string, relativePath: string, content: string): Promise<void>;

  /** Edit = overwrite an existing file (fails if missing unless createIfMissing). */
  editFile?(
    workspaceId: string,
    relativePath: string,
    content: string,
    opts?: { createIfMissing?: boolean },
  ): Promise<void>;

  deleteFile(workspaceId: string, relativePath: string): Promise<void>;

  listFiles(workspaceId: string, relativePath?: string): Promise<string[]>;

  createDirectory(workspaceId: string, relativePath: string): Promise<void>;

  exec(
    workspaceId: string,
    command: string,
    options?: WorkspaceExecOptions,
  ): Promise<WorkspaceExecResult>;

  runTests?(workspaceId: string, options?: WorkspaceExecOptions): Promise<WorkspaceExecResult>;

  runBuild?(workspaceId: string, options?: WorkspaceExecOptions): Promise<WorkspaceExecResult>;

  destroy(workspaceId: string): Promise<boolean>;

  /** Optional helpers used by gateway / verification (not required of every provider). */
  get?(workspaceId: string): WorkspaceInfo | undefined;
  list?(userId?: string): WorkspaceInfo[];
  fileExists?(workspaceId: string, relativePath: string): Promise<boolean>;
  commandAudit?: CommandAuditEntry[];
}
