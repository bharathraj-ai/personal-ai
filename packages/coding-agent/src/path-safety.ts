import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";

/**
 * Safe path resolution inside a workspace root.
 * Rejects: absolute paths, .. traversal, symlink escape, null bytes.
 *
 * LOCAL WORKSPACE ≠ CLOUD SANDBOX — this is path containment only.
 */

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathEscapeError";
  }
}

function decodePathSegments(input: string): string {
  // Decode percent-encoding once; reject null bytes and encoded separators abuse.
  let decoded = input;
  try {
    decoded = decodeURIComponent(input.replace(/\+/g, "%20"));
  } catch {
    decoded = input;
  }
  return decoded;
}

function assertNoNullBytes(path: string): void {
  if (path.includes("\0")) {
    throw new PathEscapeError("Path contains null byte");
  }
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Synchronously validate path shape and logical containment (no symlink yet).
 * Absolute paths and .. segments are rejected here.
 */
export function assertLogicalPathInside(workspaceRoot: string, relativePath: string): string {
  assertNoNullBytes(relativePath);
  const decoded = decodePathSegments(relativePath);
  assertNoNullBytes(decoded);

  if (isAbsolute(decoded) || /^[a-zA-Z]:[\\/]/.test(decoded)) {
    throw new PathEscapeError("Absolute paths are not allowed");
  }

  // Strip leading separators — treat as relative only
  const stripped = decoded.replace(/^[/\\]+/, "");
  const normalized = normalize(stripped);

  if (normalized === ".." || normalized.startsWith(`..${sep}`) || normalized.includes(`${sep}..${sep}`)) {
    throw new PathEscapeError("Path escapes workspace (parent traversal)");
  }

  // Defense: also reject any remaining ".." after normalize
  const parts = normalized.split(/[/\\]/);
  if (parts.includes("..")) {
    throw new PathEscapeError("Path escapes workspace (parent traversal)");
  }

  const full = resolve(workspaceRoot, normalized === "." ? "" : normalized);
  if (!isInsideRoot(workspaceRoot, full)) {
    throw new PathEscapeError("Path escapes workspace root");
  }

  return full;
}

/**
 * Async resolve with realpath / symlink escape protection.
 * For non-existent targets (create/write), verifies the nearest existing ancestor.
 */
export async function resolveSafePath(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  const rootReal = await realpath(workspaceRoot).catch(() => resolve(workspaceRoot));
  const logical = assertLogicalPathInside(rootReal, relativePath);

  // Walk up until an existing path is found for realpath checks
  let probe = logical;
  let existed = false;
  for (;;) {
    try {
      await lstat(probe);
      existed = true;
      break;
    } catch {
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
      if (!isInsideRoot(rootReal, probe) && probe !== rootReal) {
        throw new PathEscapeError("Path escapes workspace during ancestor walk");
      }
    }
  }

  if (existed) {
    const real = await realpath(probe);
    if (!isInsideRoot(rootReal, real)) {
      throw new PathEscapeError("Path escapes workspace via symlink");
    }
    // If we realpath'd an ancestor, re-join the remaining suffix under the real ancestor
    if (probe !== logical) {
      const suffix = relative(probe, logical);
      const joined = resolve(real, suffix);
      if (!isInsideRoot(rootReal, joined)) {
        throw new PathEscapeError("Path escapes workspace after symlink resolve");
      }
      // Final check if the full path exists
      try {
        const fullReal = await realpath(joined);
        if (!isInsideRoot(rootReal, fullReal)) {
          throw new PathEscapeError("Path escapes workspace via symlink");
        }
        return fullReal;
      } catch (err) {
        if (err instanceof PathEscapeError) throw err;
        return joined;
      }
    }
    return real;
  }

  // Nothing existed below root — ensure logical stays under rootReal
  if (!isInsideRoot(rootReal, logical)) {
    throw new PathEscapeError("Path escapes workspace root");
  }
  return logical;
}
