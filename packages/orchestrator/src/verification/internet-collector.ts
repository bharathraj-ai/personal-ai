import type { Evidence } from "@personal-ai/shared";
import type { ToolRegistry } from "@personal-ai/tools";
import { createEvidence } from "./evidence.js";
import { evidenceFromReadPage, evidenceFromSearchWeb, mergeEvidence } from "./from-tools.js";
import { classifySourceQuality, compareSourceQuality } from "./source-quality.js";

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_FETCH_PAGES = 3;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export interface CollectInternetOptions {
  limit?: number;
  fetchPages?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/**
 * search_web → rank candidates by source quality → read_page (not snippets alone).
 * Uses existing DuckDuckGo/search tools; does not replace them.
 */
export async function collectInternetEvidence(
  query: string,
  tools: ToolRegistry,
  options: CollectInternetOptions = {},
): Promise<Evidence[]> {
  const limit = options.limit ?? envInt("EVIDENCE_SEARCH_LIMIT", DEFAULT_SEARCH_LIMIT);
  const fetchPages = options.fetchPages ?? envInt("EVIDENCE_FETCH_PAGES", DEFAULT_FETCH_PAGES);

  const search = await tools.execute("search_web", { query, limit });
  const output = search.output;
  let evidence = evidenceFromSearchWeb(output);

  const rec = asRecord(output);
  const answer = typeof rec?.answer === "string" ? rec.answer.trim() : "";
  const results = (rec?.results as Array<{ title?: string; url?: string; snippet?: string }> | undefined) ?? [];

  const ranked = [...results]
    .filter((r) => r.url?.startsWith("http"))
    .sort(
      (a, b) =>
        compareSourceQuality(classifySourceQuality(a.url), classifySourceQuality(b.url)),
    );

  const fetchedUrls = new Set<string>();
  let fetched = 0;

  for (const hit of ranked) {
    if (fetched >= fetchPages) break;
    const url = hit.url!;
    if (fetchedUrls.has(url)) continue;
    fetchedUrls.add(url);

    const page = await tools.execute("read_page", { url });
    if (page.success) {
      const pageEvidence = evidenceFromReadPage(page.output);
      if (pageEvidence) {
        evidence = mergeEvidence(evidence, [pageEvidence]);
        fetched += 1;
      }
    }
  }

  // Instant-answer abstract is not verification by itself; fetch AbstractURL when present.
  if (answer && evidence.every((e) => e.metadata?.snippetOnly)) {
    evidence = mergeEvidence(evidence, [
      createEvidence({
        type: "web",
        source: String(rec?.provider ?? "search"),
        title: "Search instant answer",
        content: answer,
        metadata: { snippetOnly: true, instantAnswer: true, searchQuery: query },
      }),
    ]);
  }

  return evidence;
}

export function urlsNeedingFetch(evidence: Evidence[]): string[] {
  const fetched = new Set(
    evidence.filter((e) => e.type === "web" && e.url && e.metadata?.snippetOnly !== true).map((e) => e.url!),
  );
  const pending: string[] = [];
  for (const item of evidence) {
    if (item.type !== "web" || !item.url) continue;
    if (fetched.has(item.url) || pending.includes(item.url)) continue;
    if (item.metadata?.snippetOnly === true) pending.push(item.url);
  }
  return pending;
}

/** After search_web observations, fetch pages that were only snippets. */
export async function enrichWebEvidence(
  evidence: Evidence[],
  tools: ToolRegistry,
  maxPages = DEFAULT_FETCH_PAGES,
): Promise<Evidence[]> {
  const pending = urlsNeedingFetch(evidence).slice(0, maxPages);
  let merged = evidence;
  for (const url of pending) {
    const page = await tools.execute("read_page", { url });
    if (!page.success) continue;
    const pageEvidence = evidenceFromReadPage(page.output);
    if (pageEvidence) merged = mergeEvidence(merged, [pageEvidence]);
  }
  return merged;
}
