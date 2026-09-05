/**
 * Strict structured output for CodingAgent.
 * Normalize safe markdown fences only. Schema validation is mandatory.
 * Do not treat a greedy regex match as success.
 */

import { isCommonJsTestContent, isFakeDatabaseContent, isPlaceholderImplementation, isVacuousTestContent, isWrongStackPackageJson, isWrongTestFrameworkContent } from "./module-contract.js";
import {
  SYSTEM_FILE_WRITE_FORBIDDEN,
  filterSystemFilesFromAllowedPaths,
  isSystemFilePath,
} from "./system-files.js";

export type FileOperation = "create" | "edit" | "delete";

export interface StructuredCodingFile {
  path: string;
  operation: FileOperation;
  content: string;
}

export interface StructuredCodingOutput {
  summary: string;
  files: StructuredCodingFile[];
  commands: string[];
  tests: string[];
  notes: string[];
}

export interface StructuredParseFailure {
  ok: false;
  error: string;
}

export interface StructuredParseSuccess {
  ok: true;
  value: StructuredCodingOutput;
  normalizedFence: boolean;
}

export type StructuredParseResult = StructuredParseSuccess | StructuredParseFailure;

const OPERATIONS = new Set<FileOperation>(["create", "edit", "delete"]);

export const CODING_STRUCTURED_SYSTEM = `You implement real software. Return ONLY a JSON object (no markdown, no explanation) with this exact shape:
{"summary":"string","files":[{"path":"relative/path","operation":"create|edit|delete","content":"..."}],"commands":[],"tests":[],"notes":[]}
Rules:
- paths must be workspace-relative (never absolute, never ..)
- operation is required; use create for new files
- content is the full file body (empty string only for delete)
- never include API keys or secrets
- never modify .workspace.json or other system metadata files
- never invent a one-page demo when a real project is requested
- implement only the listed target files in this call (usually 1 file)`;

/** Strip a wrapping markdown fence. Does not search inside JSON string values. */
export function stripJsonFence(text: string): { text: string; stripped: boolean } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return { text: trimmed, stripped: false };
  }
  const firstNl = trimmed.indexOf("\n");
  const lastFence = trimmed.lastIndexOf("```");
  if (firstNl === -1 || lastFence <= firstNl) {
    return { text: trimmed, stripped: false };
  }
  const inner = trimmed.slice(firstNl + 1, lastFence).trim();
  return { text: inner, stripped: true };
}

/**
 * Extract a single JSON object when unambiguous (optional prose before/after).
 * Does not invent fields — only isolates parseable object text.
 */
export function extractJsonObject(text: string): { text: string; extracted: boolean } {
  const { text: fenced, stripped } = stripJsonFence(text);
  const tryParse = (candidate: string): boolean => {
    try {
      const v = JSON.parse(candidate);
      return v !== null && typeof v === "object" && !Array.isArray(v);
    } catch {
      return false;
    }
  };
  if (tryParse(fenced)) {
    return { text: fenced, extracted: stripped };
  }
  const start = fenced.indexOf("{");
  if (start === -1) return { text: fenced, extracted: false };
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < fenced.length; i++) {
    const ch = fenced[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = fenced.slice(start, i + 1);
        if (tryParse(candidate)) {
          return { text: candidate, extracted: true };
        }
        return { text: fenced, extracted: false };
      }
    }
  }
  return { text: fenced, extracted: false };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

function isSafePath(path: string): boolean {
  if (!path || path.includes("\0")) return false;
  if (path.includes("..")) return false;
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return false;
  return true;
}

export function parseStructuredCodingOutput(
  raw: string,
  opts?: { allowedPaths?: string[] },
): StructuredParseResult {
  if (!raw || !raw.trim()) {
    return { ok: false, error: "empty model output" };
  }
  const { text, extracted } = extractJsonObject(raw);
  const { stripped: fenceStripped } = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "output is not valid JSON after fence normalization" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "JSON root must be an object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.files)) {
    return { ok: false, error: "missing files array" };
  }
  const files: StructuredCodingFile[] = [];
  for (const item of obj.files) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "each files[] entry must be an object" };
    }
    const f = item as Record<string, unknown>;
    if (typeof f.path !== "string" || !isSafePath(f.path)) {
      return { ok: false, error: `unsafe or missing path: ${String(f.path)}` };
    }
    if (isSystemFilePath(f.path)) {
      return { ok: false, error: `${SYSTEM_FILE_WRITE_FORBIDDEN}: ${f.path}` };
    }
    let operation: FileOperation = "create";
    if (typeof f.operation === "string") {
      if (!OPERATIONS.has(f.operation as FileOperation)) {
        return { ok: false, error: `invalid operation: ${f.operation}` };
      }
      operation = f.operation as FileOperation;
    }
    if (operation !== "delete" && typeof f.content !== "string") {
      return { ok: false, error: `file ${f.path} missing content string` };
    }
    files.push({
      path: f.path,
      operation,
      content: typeof f.content === "string" ? f.content : "",
    });
  }
  if (files.length === 0) {
    return { ok: false, error: "files array is empty" };
  }
  if (opts?.allowedPaths?.length) {
    const allow = new Set(filterSystemFilesFromAllowedPaths(opts.allowedPaths));
    for (const f of files) {
      if (!allow.has(f.path)) {
        return { ok: false, error: `unexpected file path: ${f.path}` };
      }
    }
  }
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.path)) return { ok: false, error: `duplicated path: ${f.path}` };
    seen.add(f.path);
    if (f.operation !== "delete") {
      if (isPlaceholderImplementation(f.content)) {
        return { ok: false, error: `placeholder implementation: ${f.path}` };
      }
      if (isVacuousTestContent(f.content)) {
        return { ok: false, error: `vacuous test rejected: ${f.path}` };
      }
      if (/\.(test|spec)\./i.test(f.path) && isCommonJsTestContent(f.path, f.content)) {
        return { ok: false, error: `use ESM import not require in test file: ${f.path}` };
      }
      if (/\.(test|spec)\./i.test(f.path) && isWrongTestFrameworkContent(f.content)) {
        return { ok: false, error: `wrong test framework rejected (use node:test): ${f.path}` };
      }
      if (isWrongStackPackageJson(f.path, f.content)) {
        return { ok: false, error: `wrong stack in package.json (use node:http + node:test): ${f.path}` };
      }
      if (isFakeDatabaseContent(f.path, f.content)) {
        return { ok: false, error: `hardcoded fake database rejected: ${f.path}` };
      }
    }
  }
  return {
    ok: true,
    normalizedFence: fenceStripped || extracted,
    value: {
      summary: typeof obj.summary === "string" ? obj.summary : "",
      files,
      commands: asStringArray(obj.commands),
      tests: asStringArray(obj.tests),
      notes: asStringArray(obj.notes),
    },
  };
}

export function toProposedFiles(
  output: StructuredCodingOutput,
): Array<{ path: string; content: string; purpose?: string; operation: FileOperation }> {
  return output.files.map((f) => ({
    path: f.path,
    content: f.content,
    purpose: output.summary || undefined,
    operation: f.operation,
  }));
}

// ---------------------------------------------------------------------------
// File Specification — lightweight per-file schema used by the two-pass module
// generation pipeline in structured-coding-propose.ts
// ---------------------------------------------------------------------------

/** System prompt used to ask the model for a structured file specification. */
export const FILE_SPEC_SYSTEM = `You are a software architect. Given a target file path and optional module context,
return a JSON specification (no markdown, no explanation) describing what this file should contain:
{"path":"relative/path","purpose":"one-line description","exports":["NamedExport1","NamedExport2"],"dependencies":["./other-module","pg"]}
Rules:
- path must match the requested file exactly
- purpose is a single plain-text sentence
- exports lists public identifiers this file will export (empty array if none)
- dependencies lists modules imported by this file (npm packages or workspace-relative paths)
- Never include secrets or API keys`;

/** Parsed result of FILE_SPEC_SYSTEM prompt. */
export interface FileSpecification {
  path: string;
  purpose: string;
  exports: string[];
  dependencies: string[];
}

/** Parse a file specification response from the model. */
export function parseFileSpecification(
  raw: string,
): { ok: true; value: FileSpecification } | { ok: false; error: string } {
  if (!raw || !raw.trim()) {
    return { ok: false, error: "empty model output" };
  }
  const { text } = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "output is not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "JSON root must be an object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.path !== "string" || !obj.path) {
    return { ok: false, error: "missing path field" };
  }
  return {
    ok: true,
    value: {
      path: obj.path,
      purpose: typeof obj.purpose === "string" ? obj.purpose : "",
      exports: Array.isArray(obj.exports) ? obj.exports.filter((x) => typeof x === "string") : [],
      dependencies: Array.isArray(obj.dependencies)
        ? obj.dependencies.filter((x) => typeof x === "string")
        : [],
    },
  };
}
