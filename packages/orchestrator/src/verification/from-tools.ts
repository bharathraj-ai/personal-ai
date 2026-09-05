import type { Evidence, ToolResult } from "@personal-ai/shared";
import { isUnusableWebContent } from "@personal-ai/tools";
import { createEvidence, isSnippetOnly } from "./evidence.js";
import { classifySourceQuality } from "./source-quality.js";

interface SearchHit {
  title?: string;
  url?: string;
  snippet?: string;
}

interface SearchOutput {
  query?: string;
  provider?: string;
  results?: SearchHit[];
  answer?: string;
  error?: string;
}

interface PageOutput {
  url?: string;
  title?: string;
  text?: string;
  body?: string;
  wordCount?: number;
  publishedAt?: string;
  lastModified?: string;
  status?: number;
}

interface MemoryHit {
  id?: string;
  content?: string;
  memoryType?: string;
  score?: number;
}

interface RagChunk {
  documentId?: string;
  chunkId?: string;
  content?: string;
  filename?: string;
  score?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function toolOutput(result: ToolResult | unknown): unknown {
  const rec = asRecord(result);
  if (rec && "output" in rec) return rec.output;
  return result;
}

export function evidenceFromSearchWeb(output: unknown, retrievedAt = new Date()): Evidence[] {
  const data = asRecord(output) as SearchOutput | undefined;
  if (!data) return [];
  const evidence: Evidence[] = [];
  const provider = data.provider ?? "search";

  for (const hit of data.results ?? []) {
    if (!hit.url && !hit.snippet && !hit.title) continue;
    if (isUnusableWebContent(hit.snippet ?? "", hit.title, hit.url)) continue;
    evidence.push(
      createEvidence({
        type: "web",
        source: provider,
        title: hit.title,
        url: hit.url,
        content: hit.snippet || hit.title || "",
        retrievedAt,
        sourceQuality: classifySourceQuality(hit.url),
        metadata: { snippetOnly: true, searchQuery: data.query },
      }),
    );
  }

  return evidence;
}

export function evidenceFromReadPage(output: unknown, retrievedAt = new Date()): Evidence | undefined {
  const data = asRecord(output) as PageOutput | undefined;
  if (!data) return undefined;
  const content = data.text || data.body;
  if (!content) return undefined;
  if (isUnusableWebContent(content, data.title, data.url)) return undefined;
  const published = data.publishedAt || data.lastModified;
  return createEvidence({
    type: "web",
    source: data.url ? hostnameSafe(data.url) : "fetched_page",
    title: data.title,
    url: data.url,
    content,
    retrievedAt,
    publishedAt: published,
    metadata: {
      snippetOnly: false,
      wordCount: data.wordCount,
      dateSource: data.publishedAt ? "page-meta" : data.lastModified ? "last-modified" : undefined,
      httpStatus: data.status,
    },
  });
}

function hostnameSafe(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "web";
  }
}

export function evidenceFromMemorySearch(output: unknown, retrievedAt = new Date()): Evidence[] {
  const data = asRecord(output);
  const results = (data?.results as MemoryHit[] | undefined) ?? [];
  return results
    .filter((r) => r.content)
    .map((r) =>
      createEvidence({
        type: "memory",
        source: "personal_memory",
        title: r.memoryType ?? "memory",
        content: String(r.content),
        retrievedAt,
        sourceQuality: "other",
        metadata: { memoryId: r.id, score: r.score },
      }),
    );
}

export function evidenceFromDocumentSearch(output: unknown, retrievedAt = new Date()): Evidence[] {
  const data = asRecord(output);
  const chunks = (data?.chunks as RagChunk[] | undefined) ?? [];
  return chunks
    .filter((c) => c.content)
    .map((c) =>
      createEvidence({
        type: "document",
        source: c.filename ?? "rag",
        title: c.filename,
        content: String(c.content),
        retrievedAt,
        sourceQuality: "other",
        metadata: { documentId: c.documentId, chunkId: c.chunkId, score: c.score, untrusted: true },
      }),
    );
}

export function evidenceFromCodeTool(
  toolName: string,
  output: unknown,
  success: boolean,
  retrievedAt = new Date(),
): Evidence | undefined {
  const data = asRecord(output) ?? {};
  const exitCode = typeof data.exitCode === "number" ? data.exitCode : success ? 0 : 1;
  const stdout = typeof data.stdout === "string" ? data.stdout : "";
  const stderr = typeof data.stderr === "string" ? data.stderr : "";
  const timedOut = data.timedOut === true;
  const content = [stdout, stderr].filter(Boolean).join("\n").slice(0, 4000) || (success ? "ok" : "failed");

  return createEvidence({
    type: toolName === "run_tests" || toolName === "run_build" ? "code-test" : "runtime",
    source: toolName,
    title: toolName,
    content,
    retrievedAt,
    sourceQuality: "other",
    metadata: { exitCode, timedOut, success },
  });
}

export function evidenceFromTimeTool(output: unknown, retrievedAt = new Date()): Evidence | undefined {
  const data = asRecord(output);
  const time = data?.time;
  if (typeof time !== "string") return undefined;
  return createEvidence({
    type: "runtime",
    source: "get_current_time",
    title: "Current time",
    content: time,
    retrievedAt,
    publishedAt: time,
    sourceQuality: "other",
  });
}

/** Convert a tool result plus tool name into evidence items. */
export function evidenceFromToolResult(
  toolName: string,
  result: ToolResult | unknown,
  retrievedAt = new Date(),
): Evidence[] {
  const rec = asRecord(result);
  const success = rec?.success === true;
  const output = toolOutput(result);

  switch (toolName) {
    case "search_web":
      return evidenceFromSearchWeb(output, retrievedAt);
    case "read_page":
    case "fetch_url": {
      const page = evidenceFromReadPage(output, retrievedAt);
      return page ? [page] : [];
    }
    case "search_memory":
      return evidenceFromMemorySearch(output, retrievedAt);
    case "search_documents":
    case "get_project_context":
      return [
        ...evidenceFromDocumentSearch(output, retrievedAt),
        ...evidenceFromMemorySearch(output, retrievedAt),
      ];
    case "run_tests":
    case "run_build":
    case "run_command":
    case "npm_install": {
      const code = evidenceFromCodeTool(toolName, output, success, retrievedAt);
      return code ? [code] : [];
    }
    case "get_current_time": {
      const t = evidenceFromTimeTool(output, retrievedAt);
      return t ? [t] : [];
    }
    default: {
      if (!success) return [];
      const text = typeof output === "string" ? output : JSON.stringify(output ?? {});
      if (!text || text === "{}" || text === "null") return [];
      return [
        createEvidence({
          type: "tool",
          source: toolName,
          title: toolName,
          content: text,
          retrievedAt,
          sourceQuality: "other",
        }),
      ];
    }
  }
}

export function mergeEvidence(existing: Evidence[], incoming: Evidence[]): Evidence[] {
  const out = [...existing];
  for (const item of incoming) {
    const dup = out.find(
      (e) =>
        (item.url && e.url === item.url && isSnippetOnly(e) === isSnippetOnly(item)) ||
        (e.type === item.type && e.source === item.source && e.content === item.content),
    );
    if (dup) {
      if (isSnippetOnly(dup) && !isSnippetOnly(item)) {
        const idx = out.indexOf(dup);
        out[idx] = item;
      }
      continue;
    }
    out.push(item);
  }
  return out;
}
