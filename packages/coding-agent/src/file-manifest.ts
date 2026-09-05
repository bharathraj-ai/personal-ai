import { stripJsonFence } from "./structured-output.js";
import { isSystemFilePath } from "./system-files.js";

export interface ParsedFileManifest {
  project: string;
  modules: Array<{ id: string; name: string; dependsOn?: string[] }>;
  files: Array<{ path: string; purpose: string; module: string }>;
}

export const FILE_MANIFEST_SYSTEM = `Return ONLY JSON (no markdown, no file contents):
{"project":"...","modules":[{"id":"...","name":"...","dependsOn":[]}],"files":[{"path":"relative/path","purpose":"...","module":"module-id"}]}
Rules:
- paths must be workspace-relative
- do not include file contents
- at most 60 files
- group files by module id from the approved plan
- never include API keys
- never include .workspace.json or other system metadata files`;

function isSafePath(path: string): boolean {
  if (!path || path.includes("\0") || path.includes("..")) return false;
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return false;
  return true;
}

export function parseFileManifest(raw: string):
  | { ok: true; value: ParsedFileManifest }
  | { ok: false; error: string } {
  const { text } = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "manifest is not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "manifest root must be an object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.files) || obj.files.length === 0) {
    return { ok: false, error: "manifest files[] is empty" };
  }
  if (obj.files.length > 80) {
    return { ok: false, error: "manifest exceeds 80 files" };
  }
  const files: ParsedFileManifest["files"] = [];
  for (const item of obj.files) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "invalid files[] entry" };
    }
    const f = item as Record<string, unknown>;
    if (typeof f.path !== "string" || !isSafePath(f.path)) {
      return { ok: false, error: `unsafe path ${String(f.path)}` };
    }
    if (isSystemFilePath(f.path)) {
      return { ok: false, error: `system file path rejected: ${f.path}` };
    }
    files.push({
      path: f.path,
      purpose: typeof f.purpose === "string" ? f.purpose : "",
      module: typeof f.module === "string" ? f.module : "MODULE-CORE",
    });
  }
  const modules = Array.isArray(obj.modules)
    ? obj.modules
        .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
        .map((m) => ({
          id: String(m.id ?? ""),
          name: String(m.name ?? m.id ?? ""),
          dependsOn: Array.isArray(m.dependsOn) ? m.dependsOn.filter((x) => typeof x === "string") : [],
        }))
        .filter((m) => m.id)
    : [];
  return {
    ok: true,
    value: {
      project: typeof obj.project === "string" ? obj.project : "project",
      modules,
      files,
    },
  };
}
