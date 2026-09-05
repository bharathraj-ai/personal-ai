/**
 * Intent → query generation → DuckDuckGo → extract_content → evidence.
 * Uses existing search_web / read_page tools. Does not replace DuckDuckGo.
 */
import type { Evidence, SearchDebugTrace } from "@personal-ai/shared";
import type { ToolRegistry } from "@personal-ai/tools";
import { createEvidence } from "./verification/evidence.js";
import { evidenceFromReadPage, evidenceFromSearchWeb, mergeEvidence } from "./verification/from-tools.js";
import { classifySourceQuality, compareSourceQuality } from "./verification/source-quality.js";
import { isAppShellUrl, isUnusableWebContent } from "@personal-ai/tools";
import {
  analyzeSearchIntent,
  relationshipKeywords,
  type SearchContext,
  type SearchIntent,
} from "./search-intent.js";

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_FETCH_PAGES = 3;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export interface SearchPipelineResult {
  evidence: Evidence[];
  intent: SearchIntent;
  debug: SearchDebugTrace;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export async function runSearchPipeline(
  question: string,
  tools: ToolRegistry,
  options: { forceWeb?: boolean; context?: SearchContext } = {},
): Promise<SearchPipelineResult> {
  const intent = analyzeSearchIntent(question, options.context);
  const generated = intent.generatedQueries;
  const sourcesConsulted: SearchDebugTrace["sources_consulted"] = [];
  let evidence: Evidence[] = [];
  let resolved: string | undefined = intent.entityCandidates[0] ?? intent.entity;

  if (intent.needsClarification && generated.length === 0) {
    return {
      evidence: [],
      intent,
      debug: toDebug(intent, [], 0, resolved, {
        needs_clarification: true,
        clarification_question: intent.clarificationQuestion,
      }),
    };
  }

  const limit = envInt("EVIDENCE_SEARCH_LIMIT", DEFAULT_SEARCH_LIMIT);
  const fetchPages = envInt("EVIDENCE_FETCH_PAGES", DEFAULT_FETCH_PAGES);

  // Prefer Wikipedia REST summary for person/entity lookups — reliable lead text.
  if (intent.answerType === "PERSON/CHARACTER" && resolved) {
    const wiki = await fetchWikipediaSummary(resolved);
    if (wiki) {
      evidence = mergeEvidence(evidence, [wiki]);
      sourcesConsulted.push({
        title: wiki.title,
        url: wiki.url,
        quality: wiki.sourceQuality,
      });
    }
  }

  for (const query of generated) {
    if (!tools.get("search_web")) break;
    const search = await tools.execute("search_web", { query, limit });
    evidence = mergeEvidence(evidence, evidenceFromSearchWeb(search.output));

    const rec = asRecord(search.output);
    const results =
      (rec?.results as Array<{ title?: string; url?: string; snippet?: string }> | undefined) ?? [];
    const answer = typeof rec?.answer === "string" ? rec.answer.trim() : "";

    resolved = resolveEntityFromHits(intent, results, resolved);

    const ranked = rankHits(results, intent, resolved);
    let fetched = 0;
    const seen = new Set(
      evidence.filter((e) => e.url && e.metadata?.snippetOnly !== true).map((e) => e.url!),
    );

    for (const hit of ranked) {
      if (fetched >= fetchPages) break;
      const url = hit.url;
      if (!url?.startsWith("http") || seen.has(url)) continue;
      if (isAppShellUrl(url) && intent.answerType === "PERSON/CHARACTER") continue;
      seen.add(url);
      const page = await fetchExtractedPage(tools, url);
      if (!page) continue;
      evidence = mergeEvidence(evidence, [page]);
      sourcesConsulted.push({
        title: page.title,
        url: page.url,
        quality: page.sourceQuality,
      });
      fetched += 1;
    }

    if (answer && !evidence.some((e) => e.metadata?.instantAnswer)) {
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

    if (hasRelationshipEvidence(evidence, intent)) break;
  }

  const confidence = scoreConfidence(intent, evidence, resolved);
  const needsAsk =
    confidence === "low" &&
    Boolean(intent.entityCandidates.length > 1) &&
    !hasRelationshipEvidence(evidence, intent);

  const debug = toDebug(intent, generated, evidence.length, resolved, {
    sources_consulted: uniqueSources(evidence),
    confidence,
    needs_clarification: needsAsk,
    clarification_question: needsAsk
      ? `I think you mean ${intent.entityCandidates[0]}. Is that correct?`
      : undefined,
  });

  return { evidence, intent: { ...intent, confidence, entity: resolved }, debug };
}

async function fetchExtractedPage(tools: ToolRegistry, url: string): Promise<Evidence | undefined> {
  if (tools.get("extract_content")) {
    const page = await tools.execute("extract_content", { url });
    if (page.success) {
      const fromExtract = evidenceFromExtractContent(page.output);
      if (fromExtract) return fromExtract;
    }
  }
  if (!tools.get("read_page")) return undefined;
  const page = await tools.execute("read_page", { url });
  if (!page.success) return undefined;
  return evidenceFromReadPage(page.output);
}

/** Wikipedia REST summary — short extract for entity identity answers. */
async function fetchWikipediaSummary(entity: string): Promise<Evidence | undefined> {
  const title = entity.trim().replace(/\s+/g, "_");
  if (!title || title.length > 80) return undefined;
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "PersonalAI/1.0 (local; entity-summary)", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      type?: string;
      title?: string;
      extract?: string;
      description?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    if (data.type === "disambiguation") return undefined;
    const extract = (data.extract || data.description || "").trim();
    if (extract.length < 40) return undefined;
    const pageUrl = data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${title}`;
    return createEvidence({
      type: "web",
      source: "wikipedia",
      title: data.title ? `${data.title} - Wikipedia` : "Wikipedia",
      url: pageUrl,
      content: extract,
      sourceQuality: "reputable_secondary",
      metadata: { snippetOnly: false, wikipediaSummary: true, instantAnswer: true },
    });
  } catch {
    return undefined;
  }
}

function evidenceFromExtractContent(output: unknown): Evidence | undefined {
  const data = asRecord(output);
  if (data?.unusable === true) return undefined;
  const content = String(data?.content ?? data?.relevantText ?? data?.text ?? "");
  const url = typeof data?.url === "string" ? data.url : undefined;
  const title = typeof data?.title === "string" ? data.title : undefined;
  if (isUnusableWebContent(content, title, url)) return undefined;
  if (content.trim().length < 24) return undefined;
  return createEvidence({
    type: "web",
    source: url ? hostnameSafe(url) : "extracted_page",
    title: typeof data?.title === "string" ? data.title : undefined,
    url,
    content,
    publishedAt: typeof data?.publishedAt === "string" ? data.publishedAt : undefined,
    sourceQuality: classifySourceQuality(url),
    metadata: {
      snippetOnly: false,
      extracted: true,
      author: data?.author,
      wordCount: data?.wordCount,
      unusable: data?.unusable === true,
    },
  });
}

function rankHits(
  results: Array<{ title?: string; url?: string; snippet?: string }>,
  intent: SearchIntent,
  resolved?: string,
): Array<{ title?: string; url?: string; snippet?: string }> {
  const keys = [
    ...relationshipKeywords(intent.relationship),
    ...(resolved ? resolved.toLowerCase().split(/\s+/).filter((w) => w.length > 2) : []),
  ];
  return [...results]
    .filter((r) => r.url?.startsWith("http"))
    .sort((a, b) => {
      const qa = classifySourceQuality(a.url);
      const qb = classifySourceQuality(b.url);
      const quality = compareSourceQuality(qa, qb);
      if (quality !== 0) return quality;
      return hitScore(b, keys) - hitScore(a, keys);
    });
}

function hitScore(hit: { title?: string; url?: string; snippet?: string }, keys: string[]): number {
  const blob = `${hit.title ?? ""} ${hit.snippet ?? ""} ${hit.url ?? ""}`.toLowerCase();
  let s = 0;
  for (const k of keys) {
    if (k && blob.includes(k.toLowerCase())) s += 2;
  }
  if (hit.url?.includes("wikipedia.org")) s += 4;
  if (hit.url?.includes("imdb.com")) s += 3;
  if (/\bbiograph/i.test(blob)) s += 3;
  if (hit.url && isAppShellUrl(hit.url)) s -= 8;
  if (isUnusableWebContent(hit.snippet ?? "", hit.title, hit.url)) s -= 20;
  return s;
}

function resolveEntityFromHits(
  intent: SearchIntent,
  results: Array<{ title?: string; snippet?: string }>,
  current?: string,
): string | undefined {
  const blob = results.map((r) => `${r.title ?? ""} ${r.snippet ?? ""}`).join(" ").toLowerCase();
  for (const candidate of intent.entityCandidates) {
    const tokens = candidate.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => blob.includes(t)).length;
    if (hits >= Math.min(2, tokens.length)) return candidate;
  }
  return current;
}

export function hasRelationshipEvidence(evidence: Evidence[], intent: SearchIntent): boolean {
  const keys = relationshipKeywords(intent.relationship);
  const pages = evidence.filter((e) => e.metadata?.snippetOnly !== true && e.content.trim().length >= 40);
  if (pages.length === 0) return false;
  if (keys.length === 0) return pages.length > 0;
  const blob = pages.map((e) => e.content.toLowerCase()).join("\n");
  if (keys.some((k) => blob.includes(k.toLowerCase()))) return true;
  if (intent.answerType === "PERSON/CHARACTER" && /\b(stars|starring|played by|portrayed)\b/i.test(blob)) {
    return true;
  }
  return false;
}

function scoreConfidence(
  intent: SearchIntent,
  evidence: Evidence[],
  resolved?: string,
): "high" | "medium" | "low" {
  if (hasRelationshipEvidence(evidence, intent) && resolved && resolved.length > 2) return "high";
  if (evidence.some((e) => e.content.trim().length >= 80)) return "medium";
  return "low";
}

function toDebug(
  intent: SearchIntent,
  queries: string[],
  evidenceCount: number,
  resolved: string | undefined,
  extra: Partial<SearchDebugTrace>,
): SearchDebugTrace {
  return {
    original_query: intent.original_query,
    detected_intent: intent.intent,
    answer_type: intent.answerType,
    relationship: intent.relationship,
    resolved_entity: resolved,
    entity_candidates: intent.entityCandidates,
    generated_queries: queries.length ? queries : intent.generatedQueries,
    sources_consulted: extra.sources_consulted ?? [],
    evidence_count: evidenceCount,
    confidence: extra.confidence ?? intent.confidence,
    needs_clarification: extra.needs_clarification ?? intent.needsClarification,
    clarification_question: extra.clarification_question ?? intent.clarificationQuestion,
    analyzer: "search-intent",
    ...extra,
  };
}

function uniqueSources(evidence: Evidence[]): SearchDebugTrace["sources_consulted"] {
  const out: SearchDebugTrace["sources_consulted"] = [];
  const seen = new Set<string>();
  for (const e of evidence) {
    const key = (e.url || e.title || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: e.title, url: e.url, quality: e.sourceQuality });
    if (out.length >= 6) break;
  }
  return out;
}

function hostnameSafe(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "web";
  }
}
