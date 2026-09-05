import { normalize, sep } from "node:path";

export const SYSTEM_FILE_WRITE_FORBIDDEN = "SYSTEM_FILE_WRITE_FORBIDDEN" as const;

export type SystemFileOperation = "create" | "edit" | "delete" | "rename";

/** Reserved workspace metadata — never writable by CodingAgent or repair patches. */
export const RESERVED_SYSTEM_FILE_NAMES = [".workspace.json"] as const;

export class SystemFileWriteForbiddenError extends Error {
  readonly code = SYSTEM_FILE_WRITE_FORBIDDEN;

  constructor(
    public readonly path: string,
    public readonly operation: SystemFileOperation,
  ) {
    super(`${SYSTEM_FILE_WRITE_FORBIDDEN}: ${operation} on reserved system file: ${path}`);
    this.name = "SystemFileWriteForbiddenError";
  }
}

export function normalizeWorkspaceRelativePath(relativePath: string): string {
  const stripped = relativePath.replace(/^[/\\]+/, "");
  return normalize(stripped).split(sep).join("/");
}

export function isSystemFilePath(relativePath: string): boolean {
  const norm = normalizeWorkspaceRelativePath(relativePath);
  return RESERVED_SYSTEM_FILE_NAMES.some((name) => norm === name || norm.endsWith(`/${name}`));
}

/** Reject model/repair writes to reserved system metadata paths. */
export function assertAgentMayModifyPath(relativePath: string, operation: SystemFileOperation): void {
  if (isSystemFilePath(relativePath)) {
    throw new SystemFileWriteForbiddenError(relativePath, operation);
  }
}

/** Strip reserved paths from provider allow-lists — never trust the model to omit them. */
export function filterSystemFilesFromAllowedPaths(paths: string[]): string[] {
  return paths.filter((p) => !isSystemFilePath(p));
}

export function systemFileWriteErrorMessage(path: string, operation: SystemFileOperation): string {
  return `${SYSTEM_FILE_WRITE_FORBIDDEN}: ${operation} on ${path} is forbidden`;
}
