/**
 * Search intent analysis — understand the question before querying DuckDuckGo.
 * Generates semantic queries. Does not invent answers or sources.
 */

import {
  applySpellingCorrections,
  resolveConversationReferences,
  stripQuestionish,
  type ConversationTurn,
} from "./conversation-intent.js";

export type SearchRelationship =
  | "PROTAGONIST"
  | "ANTAGONIST"
  | "DIRECTOR"
  | "AUTHOR"
  | "RELEASE_DATE"
  | "CEO"
  | "CAPITAL"
  | "CREATED"
  | "VERSION"
  | "COMPARE"
  | "EVENT"
  | "DEFINITION"
  | "WEBPAGE"
  | "OTHER";

export type SearchAnswerType =
  | "PERSON/CHARACTER"
  | "PLACE"
  | "DATE"
  | "VERSION"
  | "EVENT"
  | "COMPARISON"
  | "PAGE_SUMMARY"
  | "FACT";

export interface SearchIntent {
  original_query: string;
  intent: string;
  answerType: SearchAnswerType;
  relationship: SearchRelationship;
  entity?: string;
  entityCandidates: string[];
  generatedQueries: string[];
  confidence: "high" | "medium" | "low";
  needsClarification: boolean;
  clarificationQuestion?: string;
}

/** Query-generation expansions only — never used as answers. */
const ABBREVIATION_CANDIDATES: Record<string, string[]> = {
  GBU: ["The Good, the Bad and the Ugly"],
  TDK: ["The Dark Knight"],
  LOTR: ["The Lord of the Rings"],
  GOT: ["Game of Thrones"],
  HP: ["Harry Potter"],
};

const RELATIONSHIP_KEYWORDS: Record<SearchRelationship, string[]> = {
  PROTAGONIST: ["hero", "protagonist", "main character", "lead character", "lead"],
  ANTAGONIST: ["villain", "bad guy", "antagonist"],
  DIRECTOR: ["director", "directed"],
  AUTHOR: ["author", "written by", "wrote", "writer"],
  RELEASE_DATE: ["release date", "released", "came out"],
  CEO: ["ceo", "chief executive"],
  CAPITAL: ["capital"],
  CREATED: ["created", "invented", "first appeared"],
  VERSION: ["latest version", "current version"],
  COMPARE: ["compare", "vs", "versus", "difference"],
  EVENT: ["happened", "match", "news", "latest"],
  DEFINITION: ["what is", "meaning"],
  WEBPAGE: ["webpage", "this page"],
  OTHER: [],
};

export function relationshipKeywords(rel: SearchRelationship): string[] {
  return RELATIONSHIP_KEYWORDS[rel] ?? [];
}

export interface SearchContext {
  history?: ConversationTurn[];
  lastEntity?: string;
}

export function analyzeSearchIntent(message: string, context?: SearchContext): SearchIntent {
  const original = message.trim();
  const refs = resolveConversationReferences(original, context?.history, context?.lastEntity);
  const q = applySpellingCorrections(refs.resolvedQuery.replace(/\?+$/, "").trim());
  const lower = q.toLowerCase();

  const relationship = detectRelationship(lower);
  const stripped = stripQuestionWords(q);
  const personLookup = relationship === "OTHER" && looksLikePersonLookup(stripped);
  const answerType = personLookup ? "PERSON/CHARACTER" : answerTypeFor(relationship, lower);
  const intent = personLookup ? "person identification" : intentLabel(relationship, answerType);
  const { entity, candidates, abbreviation } = extractEntity(q, relationship);

  if (
    (relationship === "PROTAGONIST" || relationship === "ANTAGONIST") &&
    isBareRelationshipEntity(entity, relationship)
  ) {
    return {
      original_query: original,
      intent,
      answerType,
      relationship,
      entityCandidates: [],
      generatedQueries: [],
      confidence: "low",
      needsClarification: true,
      clarificationQuestion:
        relationship === "PROTAGONIST"
          ? "Who is the hero of which work or story?"
          : "Which work's antagonist do you mean?",
    };
  }

  if (relationship === "WEBPAGE" && !/\bhttps?:\/\//i.test(q)) {
    return {
      original_query: original,
      intent,
      answerType,
      relationship,
      entityCandidates: [],
      generatedQueries: [],
      confidence: "low",
      needsClarification: true,
      clarificationQuestion: "Which webpage should I read? Please paste a URL.",
    };
  }

  const generatedQueries = generateSearchQueries({
    original: q,
    entity,
    candidates,
    relationship,
    abbreviation,
  });

  const confidence: SearchIntent["confidence"] =
    abbreviation && candidates.length > 1 ? "medium" : entity ? "high" : "medium";

  return {
    original_query: original,
    intent,
    answerType,
    relationship,
    entity,
    entityCandidates: unique([entity, ...candidates].filter(Boolean) as string[]),
    generatedQueries,
    confidence,
    needsClarification: false,
  };
}

export function generateSearchQueries(input: {
  original: string;
  entity?: string;
  candidates: string[];
  relationship: SearchRelationship;
  abbreviation?: string;
}): string[] {
  const queries: string[] = [];
  const primary = input.candidates[0] || input.entity || stripQuestionWords(input.original);
  const rel = input.relationship;

  const push = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (t.length >= 3 && !queries.some((q) => q.toLowerCase() === t.toLowerCase())) {
      queries.push(t);
    }
  };

  switch (rel) {
    case "PROTAGONIST":
      push(`${primary} protagonist main character hero`);
      push(`${primary} main character`);
      if (input.abbreviation) push(`${input.abbreviation} film protagonist`);
      break;
    case "ANTAGONIST":
      push(`${primary} antagonist villain`);
      break;
    case "DIRECTOR":
      push(`${primary} director`);
      break;
    case "AUTHOR":
      push(`${primary} author writer`);
      break;
    case "RELEASE_DATE":
      push(`${primary} release date`);
      break;
    case "CEO":
      push(`${primary} current CEO`);
      break;
    case "CAPITAL":
      push(`capital of ${primary}`);
      break;
    case "CREATED":
      push(`${primary} created history`);
      break;
    case "VERSION":
      push(`${primary} latest version official`);
      push(`${primary} current version`);
      break;
    case "COMPARE":
      push(stripQuestionWords(input.original));
      break;
    case "EVENT":
      push(stripQuestionWords(input.original));
      break;
    default:
      if (/\b(age|how old|born|date of birth)\b/i.test(input.original)) {
        push(`${primary} age date of birth`);
      } else if (/\brecords?\b/i.test(input.original)) {
        push(`${primary} records statistics career`);
      } else if (looksLikePersonLookup(primary) || looksLikePersonLookup(input.original)) {
        push(`${primary} biography career`);
        push(`who is ${primary}`);
      } else {
        push(`${primary} ${relationshipKeywords(rel).slice(0, 2).join(" ")}`.trim());
        push(stripQuestionWords(input.original));
      }
  }

  // Last-resort fallback — never the only query when we have a semantic expansion.
  if (queries.length === 0) push(input.original);
  return queries.slice(0, 3);
}

function detectRelationship(lower: string): SearchRelationship {
  if (/\b(this webpage|this page|this url|what does this (page|webpage) say)\b/.test(lower)) {
    return "WEBPAGE";
  }
  if (/\b(compare|vs\.?|versus|difference between)\b/.test(lower)) return "COMPARE";
  if (/\b(villain|antagonist|bad guy)\b/.test(lower)) return "ANTAGONIST";
  if (/\b(hero|protagonist|main character|lead character)\b/.test(lower)) return "PROTAGONIST";
  if (/\b(director|directed)\b/.test(lower)) return "DIRECTOR";
  if (/\b(author|written by|who wrote)\b/.test(lower)) return "AUTHOR";
  if (/\b(release date|released|came out)\b/.test(lower)) return "RELEASE_DATE";
  if (/\bceo\b/.test(lower) || /\bchief executive\b/.test(lower)) return "CEO";
  if (/\bcapital of\b/.test(lower)) return "CAPITAL";
  if (
    /\b(latest|current)\b.+\bversion\b/i.test(lower) ||
    /\bversion\b.+\b(latest|current)\b/i.test(lower) ||
    /\blatest version\b|\bcurrent version\b/.test(lower)
  ) {
    return "VERSION";
  }
  if (/\b(when was|created|invented)\b/.test(lower)) return "CREATED";
  if (/\b(latest|happened|match|news|score|weather)\b/.test(lower)) return "EVENT";
  if (/^what is\b/.test(lower)) return "DEFINITION";
  return "OTHER";
}

function answerTypeFor(rel: SearchRelationship, lower: string): SearchAnswerType {
  if (rel === "PROTAGONIST" || rel === "ANTAGONIST" || rel === "DIRECTOR" || rel === "AUTHOR" || rel === "CEO") {
    return "PERSON/CHARACTER";
  }
  if (rel === "CAPITAL") return "PLACE";
  if (rel === "RELEASE_DATE" || rel === "CREATED") return "DATE";
  if (rel === "VERSION") return "VERSION";
  if (rel === "EVENT") return "EVENT";
  if (rel === "COMPARE") return "COMPARISON";
  if (rel === "WEBPAGE") return "PAGE_SUMMARY";
  if (/\bwho\b/.test(lower)) return "PERSON/CHARACTER";
  return "FACT";
}

function intentLabel(rel: SearchRelationship, answerType: SearchAnswerType): string {
  if (rel === "PROTAGONIST") return "character identification";
  if (rel === "DIRECTOR") return "director identification";
  if (rel === "AUTHOR") return "author identification";
  if (rel === "CEO") return "current leadership identification";
  if (rel === "CAPITAL") return "place identification";
  if (rel === "CREATED" || rel === "RELEASE_DATE") return "date identification";
  if (rel === "VERSION") return "version identification";
  if (rel === "COMPARE") return "comparison";
  if (rel === "EVENT") return "current event";
  if (rel === "WEBPAGE") return "page summary";
  return answerType.toLowerCase().replace(/_/g, " ");
}

function extractEntity(
  q: string,
  relationship: SearchRelationship,
): { entity?: string; candidates: string[]; abbreviation?: string } {
  const cleaned = stripQuestionWords(q);
  const compare =
    relationship === "COMPARE"
      ? q.match(/\bcompare\s+(.+?)\s+(?:and|vs\.?|versus)\s+(.+)$/i) ??
        q.match(/(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i)
      : undefined;
  if (compare) {
    return { entity: `${compare[1]!.trim()} vs ${compare[2]!.trim()}`, candidates: [] };
  }

  const ofMatch = q.match(
    /\b(?:hero|protagonist|villain|antagonist|director|author|capital|ceo|version)\s+of\s+(.+)$/i,
  );
  const directed = q.match(/\b(?:who\s+)?directed\s+(.+)$/i);
  const wrote = q.match(/\b(?:who\s+)?wrote\s+(.+)$/i);
  const capital = q.match(/\bcapital of\s+(.+)$/i);
  const ceo = q.match(/\bceo of\s+(.+)$/i);
  const created = q.match(/\bwhen was\s+(.+?)\s+created\b/i);
  const version = q.match(/\b(?:latest|current)\s+version of\s+(.+)$/i);

  let entity =
    ofMatch?.[1] ||
    directed?.[1] ||
    wrote?.[1] ||
    capital?.[1] ||
    ceo?.[1] ||
    created?.[1] ||
    version?.[1] ||
    cleaned;

  entity = entity.replace(/\b(the|a|an)\s+/i, "").trim() || entity.trim();
  entity = entity.replace(/\s+film$/i, "").trim();

  const tokens = entity.split(/\s+/);
  const abbreviation =
    tokens.length === 1 && /^[A-Z]{2,5}$/.test(tokens[0]!)
      ? tokens[0]!.toUpperCase()
      : tokens.length === 1 && /^[a-z]{2,5}$/i.test(tokens[0]!) && ABBREVIATION_CANDIDATES[tokens[0]!.toUpperCase()]
        ? tokens[0]!.toUpperCase()
        : undefined;

  const candidates: string[] = [];
  if (abbreviation) {
    candidates.push(...(ABBREVIATION_CANDIDATES[abbreviation] ?? []));
    candidates.push(abbreviation);
  }

  return { entity: entity || undefined, candidates, abbreviation };
}

function stripQuestionWords(q: string): string {
  return stripQuestionish(q);
}

function looksLikePersonLookup(q: string): boolean {
  const t = q.trim();
  if (!t || /https?:\/\//i.test(t)) return false;
  if (/^(who|what|when|where|how|why|compare|capital|latest)\b/i.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 1 || words.length > 5) return false;
  return /^[a-z][a-z0-9.'-]*(?:\s+[a-z][a-z0-9.'-]*){0,4}$/i.test(t);
}

function isBareRelationshipEntity(entity: string | undefined, relationship: SearchRelationship): boolean {
  if (!entity?.trim()) return true;
  const bare: Partial<Record<SearchRelationship, string[]>> = {
    PROTAGONIST: ["hero", "protagonist", "main character", "lead character", "lead"],
    ANTAGONIST: ["villain", "antagonist", "bad guy"],
    DIRECTOR: ["director"],
    AUTHOR: ["author", "writer"],
  };
  return (bare[relationship] ?? []).includes(entity.toLowerCase());
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
