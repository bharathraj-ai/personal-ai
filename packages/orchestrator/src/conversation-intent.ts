/**
 * Conversation understanding — classify intent, resolve entities, decide whether to search.
 * Search is evidence acquisition. Bharath answers. Orchestrator controls.
 */

import {
  isSchoolManagementGoal,
  isWebsiteGoal,
  normalizeWebsiteGoalTypos,
  resolveBootstrapKind,
} from "./coding-bootstrap.js";

export type ConversationKind =
  | "CHAT"
  | "FACTUAL"
  | "CURRENT_FACTUAL"
  | "ENTITY_LOOKUP"
  | "COMPARISON"
  | "HOW_TO"
  | "CODING"
  | "PROJECT"
  | "SEARCH_REQUIRED"
  | "CLARIFICATION_REQUIRED";

export type ConfidenceLevel = "high" | "medium" | "low";
export type AnswerLength = "brief" | "standard" | "detailed" | "research";

export interface ConversationTurn {
  role: string;
  content: string;
}

export interface ConversationContext {
  history?: ConversationTurn[];
  lastEntity?: string;
  modelReady?: boolean;
}

export interface ConversationAnalysis {
  kind: ConversationKind;
  original: string;
  resolvedQuery: string;
  entity?: string;
  entityConfidence: ConfidenceLevel;
  intentConfidence: ConfidenceLevel;
  shouldSearch: boolean;
  evidenceRequired: boolean;
  needsClarification: boolean;
  clarificationQuestion?: string;
  answerLength: AnswerLength;
  localAnswer?: string;
  wellbeingAmbiguous: boolean;
  followUp: boolean;
}

const NAME_CORRECTIONS: Array<[RegExp, string]> = [
  [/\bvirat\s+koli\b/gi, "Virat Kohli"],
  [/\bvirat\s+kohli\b/gi, "Virat Kohli"],
  [/\bviray\s+koli\b/gi, "Virat Kohli"],
  [/\bviray\s+kohli\b/gi, "Virat Kohli"],
  [/\bvj\s+sid+hu\b/gi, "VJ Siddhu"],
  [/\bvj\s+sidhu\b/gi, "VJ Siddhu"],
];

const GREETING_RE =
  /^(hi|hello|hey|thanks|thank you|ok|okay|bye|good morning|good night|good afternoon)\b/i;

const ABOUT_ASSISTANT_RE =
  /^(what('?s| is| are)?\s+you\s+(doing|up to)|how are you|who are you|what can you do|help|test|ping)\b/i;

const EXPLICIT_SEARCH_RE = /\b(search the web|search for|google|look up|look it up)\b/i;

const CURRENT_FACT_RE =
  /\b(current|currently|latest|today|tonight|right now|this week|this month|live|breaking|weather|stock price|price of|who won|match result|score)\b/i;

const CURRENT_OFFICE_RE =
  /\b(current\s+(ceo|captain|president|pm|prime minister|version)|who is the current|latest version)\b/i;

const RELATIONSHIP_LOOKUP_RE =
  /\b(hero|protagonist|villain|antagonist|who directed|who wrote|who created|capital of|ceo of)\b/i;

const COMPARISON_RE = /\b(compare|vs\.?|versus|difference between)\b/i;

const HOW_TO_RE = /^(how (do i|to|can i)|install|set up)\b/i;

const FOLLOW_PRONOUN_RE =
  /^(his|her|their|its|he|she|they|him|them)\b|^how old is (he|she|they)\b|^what about (his|her|their)\b/i;

const FOLLOW_TOPIC_RE =
  /^(records?|stats?|statistics|career|age|wife|husband|family|net worth|height|birthday|born|children|kids|form|ranking)$/i;

const WELLBEING_RE = /\b(doing|feeling|health|nowadays|these days|right now|at the moment)\b/i;

const MATH_RE =
  /^(?:what(?:'s| is)\s+)?(\d+(?:\.\d+)?)\s*([+\-×x*\/÷])\s*(\d+(?:\.\d+)?)\s*\??$/i;

const STOPWORDS = new Set([
  "who",
  "what",
  "when",
  "where",
  "how",
  "is",
  "are",
  "was",
  "the",
  "a",
  "an",
  "of",
  "and",
  "for",
  "about",
  "tell",
  "me",
  "please",
]);

/** Normalize whitespace and apply high-confidence spelling fixes. */
export function parseUserMessage(message: string): string {
  return applySpellingCorrections(message.replace(/\s+/g, " ").trim());
}

export function applySpellingCorrections(message: string): string {
  let out = normalizeWebsiteGoalTypos(message);
  for (const [re, replacement] of NAME_CORRECTIONS) {
    out = out.replace(re, replacement);
  }
  return out;
}

export function tryLocalCompute(message: string): string | undefined {
  const m = parseUserMessage(message).match(MATH_RE);
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = Number(m[3]);
  const op = m[2]!;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  let result: number;
  switch (op) {
    case "+":
      result = a + b;
      break;
    case "-":
      result = a - b;
      break;
    case "*":
    case "x":
    case "×":
      result = a * b;
      break;
    case "/":
    case "÷":
      if (b === 0) return "That division is undefined (divide by zero).";
      result = a / b;
      break;
    default:
      return undefined;
  }
  const pretty = Number.isInteger(result) ? String(result) : String(Number(result.toPrecision(12)));
  return pretty;
}

export function classifyIntent(message: string): ConversationKind {
  const text = parseUserMessage(message);
  const lower = text.toLowerCase();

  if (GREETING_RE.test(lower) || ABOUT_ASSISTANT_RE.test(lower)) return "CHAT";
  if (tryLocalCompute(text)) return "FACTUAL";

  if (isProjectIntent(text)) return "PROJECT";
  if (isCodingIntent(text)) return "CODING";

  if (EXPLICIT_SEARCH_RE.test(lower)) return "SEARCH_REQUIRED";
  if (/\b(latest|current)\b/i.test(lower) && /\bversion\b/i.test(lower)) return "CURRENT_FACTUAL";
  if (CURRENT_OFFICE_RE.test(lower) || isCurrentFactual(lower)) return "CURRENT_FACTUAL";
  if (COMPARISON_RE.test(lower)) return "COMPARISON";
  if (HOW_TO_RE.test(lower) && !RELATIONSHIP_LOOKUP_RE.test(lower)) return "HOW_TO";

  if (/^how is\b/i.test(lower) && WELLBEING_RE.test(lower)) return "CURRENT_FACTUAL";
  if (isEntityLookup(text)) return "ENTITY_LOOKUP";
  if (RELATIONSHIP_LOOKUP_RE.test(lower)) return "ENTITY_LOOKUP";

  if (/^(who|what|when|where|why)\b/i.test(lower)) return "FACTUAL";
  return "FACTUAL";
}

export function resolveEntities(message: string): {
  entity?: string;
  confidence: ConfidenceLevel;
  corrected: string;
} {
  const corrected = parseUserMessage(message);
  const stripped = stripQuestionish(corrected);
  if (!stripped) return { corrected, confidence: "low" };

  if (/^[A-Z]{2,5}$/i.test(stripped) && stripped.length <= 5) {
    return { entity: stripped.toUpperCase(), confidence: "high", corrected };
  }

  const words = stripped.split(/\s+/);
  if (words.length >= 1 && words.length <= 5 && looksLikeName(stripped)) {
    const confidence: ConfidenceLevel =
      NAME_CORRECTIONS.some(([re]) => re.test(message)) || words.length >= 2 ? "high" : "medium";
    return { entity: titleCaseName(stripped), confidence, corrected };
  }

  return { entity: stripped || undefined, confidence: stripped ? "medium" : "low", corrected };
}

export function resolveConversationReferences(
  message: string,
  history: ConversationTurn[] = [],
  lastEntity?: string,
): { resolvedQuery: string; entity?: string; followUp: boolean; confidence: ConfidenceLevel } {
  const corrected = parseUserMessage(message);
  const prior = lastEntity?.trim() || extractPriorEntity(history);
  const lower = corrected.toLowerCase().replace(/\?+$/, "").trim();
  const topicOnly = FOLLOW_TOPIC_RE.test(lower);
  const pronoun = FOLLOW_PRONOUN_RE.test(lower);

  if ((pronoun || topicOnly) && prior) {
    const topic = topicOnly
      ? lower
      : lower
          .replace(/^(his|her|their|its)\s+/i, "")
          .replace(/^(how old is (he|she|they))\b/i, "age")
          .replace(/^what about (his|her|their)\s+/i, "")
          .replace(/^(he|she|they|him|them)\s+/i, "")
          .trim();
    const resolvedQuery = topic ? `${prior} ${topic}` : prior;
    return { resolvedQuery, entity: prior, followUp: true, confidence: "high" };
  }

  if ((pronoun || topicOnly) && !prior) {
    return {
      resolvedQuery: corrected,
      followUp: true,
      confidence: "low",
    };
  }

  const { entity, confidence } = resolveEntities(corrected);
  return { resolvedQuery: corrected, entity, followUp: false, confidence };
}

export function decideSearch(
  kind: ConversationKind,
  opts: {
    modelReady?: boolean;
    evidenceRelationship?: boolean;
    current?: boolean;
    explicitSearch?: boolean;
    entityConfidence?: ConfidenceLevel;
  } = {},
): { shouldSearch: boolean; evidenceRequired: boolean } {
  if (kind === "CHAT" || kind === "CODING" || kind === "PROJECT" || kind === "CLARIFICATION_REQUIRED") {
    return { shouldSearch: false, evidenceRequired: false };
  }
  if (kind === "CURRENT_FACTUAL" || kind === "SEARCH_REQUIRED" || opts.current || opts.explicitSearch) {
    return { shouldSearch: true, evidenceRequired: true };
  }
  if (opts.evidenceRelationship) {
    return { shouldSearch: true, evidenceRequired: true };
  }
  if (kind === "ENTITY_LOOKUP" || kind === "COMPARISON" || kind === "HOW_TO") {
    // Prefer web grounding for person/entity lookups — local model often echoes system prompts.
    if (kind === "ENTITY_LOOKUP") {
      return { shouldSearch: true, evidenceRequired: false };
    }
    const shouldSearch = !opts.modelReady || opts.entityConfidence === "low";
    return { shouldSearch, evidenceRequired: false };
  }
  // Stable factual — Bharath may answer when loaded; search only as a fallback.
  return { shouldSearch: !opts.modelReady && kind !== "FACTUAL", evidenceRequired: false };
}

export function inferAnswerLength(message: string): AnswerLength {
  const t = parseUserMessage(message);
  if (/\b(research|in depth|in-depth|detailed report|everything about)\b/i.test(t)) return "research";
  if (/\b(career|history|biography of|tell me about .{12,})\b/i.test(t) && t.split(/\s+/).length > 6) {
    return "detailed";
  }
  const stripped = stripQuestionish(t);
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && !/^(research|compare)\b/i.test(t)) return "brief";
  if (/^(who is|who's|tell me about|how is)\b/i.test(t) && t.split(/\s+/).length <= 8) return "brief";
  return "standard";
}

export function analyzeConversation(
  message: string,
  context: ConversationContext = {},
): ConversationAnalysis {
  const original = message.trim();
  const localAnswer = localAssistantReply(original);
  const refs = resolveConversationReferences(original, context.history, context.lastEntity);
  const resolvedQuery = refs.resolvedQuery;
  const kind = refs.followUp && refs.entity ? classifyFollowUp(resolvedQuery) : classifyIntent(resolvedQuery);
  const answerLength = inferAnswerLength(resolvedQuery);
  const wellbeingAmbiguous = isWellbeingAmbiguous(original);
  const explicitSearch = EXPLICIT_SEARCH_RE.test(original);
  const current = kind === "CURRENT_FACTUAL" || CURRENT_OFFICE_RE.test(resolvedQuery);
  const evidenceRelationship = RELATIONSHIP_LOOKUP_RE.test(resolvedQuery);

  if (localAnswer && kind === "CHAT") {
    return {
      kind: "CHAT",
      original,
      resolvedQuery,
      entityConfidence: "high",
      intentConfidence: "high",
      shouldSearch: false,
      evidenceRequired: false,
      needsClarification: false,
      answerLength: "brief",
      localAnswer,
      wellbeingAmbiguous: false,
      followUp: false,
    };
  }

  if (tryLocalCompute(original)) {
    return {
      kind: "FACTUAL",
      original,
      resolvedQuery,
      entityConfidence: "high",
      intentConfidence: "high",
      shouldSearch: false,
      evidenceRequired: false,
      needsClarification: false,
      answerLength: "brief",
      localAnswer: tryLocalCompute(original),
      wellbeingAmbiguous: false,
      followUp: false,
    };
  }

  if (refs.followUp && !refs.entity) {
    return {
      kind: "CLARIFICATION_REQUIRED",
      original,
      resolvedQuery,
      entityConfidence: "low",
      intentConfidence: "medium",
      shouldSearch: false,
      evidenceRequired: false,
      needsClarification: true,
      clarificationQuestion: "Who or what are you referring to?",
      answerLength: "brief",
      wellbeingAmbiguous: false,
      followUp: true,
    };
  }

  const { shouldSearch, evidenceRequired } = decideSearch(kind, {
    modelReady: context.modelReady,
    evidenceRelationship,
    current,
    explicitSearch,
    entityConfidence: refs.confidence,
  });

  const entity = kind === "PROJECT" || kind === "CODING" ? undefined : refs.entity;
  return {
    kind,
    original,
    resolvedQuery,
    entity,
    entityConfidence: refs.confidence,
    intentConfidence: kind === "CHAT" ? "high" : refs.followUp ? "high" : "medium",
    shouldSearch,
    evidenceRequired,
    needsClarification: false,
    answerLength,
    localAnswer: kind === "CHAT" ? localAnswer : undefined,
    wellbeingAmbiguous,
    followUp: refs.followUp,
  };
}

export function isWellbeingAmbiguous(message: string): boolean {
  const t = parseUserMessage(message);
  return /^how is\b/i.test(t) && !WELLBEING_RE.test(t) && !ABOUT_ASSISTANT_RE.test(t);
}

export function isCurrentWellbeingAsk(message: string): boolean {
  const t = parseUserMessage(message);
  return /^how is\b/i.test(t) && WELLBEING_RE.test(t);
}

function localAssistantReply(message: string): string | undefined {
  const t = parseUserMessage(message);
  if (/^(hi|hello|hey)\b/i.test(t)) return "Hello. How can I help?";
  if (/^(thanks|thank you)\b/i.test(t)) return "You're welcome.";
  if (/^(ok|okay|bye)\b/i.test(t)) return t.toLowerCase().startsWith("bye") ? "Goodbye." : "Okay.";
  if (/^how are you\b/i.test(t)) return "I'm doing well. What can I help you with?";
  if (/^who are you\b/i.test(t) || /^what can you do\b/i.test(t)) {
    return "I'm Bharath AI. I can answer questions, search the web when needed, and help with coding projects.";
  }
  return undefined;
}

function classifyFollowUp(resolvedQuery: string): ConversationKind {
  if (CURRENT_FACT_RE.test(resolvedQuery) || /\b(age|how old)\b/i.test(resolvedQuery)) {
    return "CURRENT_FACTUAL";
  }
  return "ENTITY_LOOKUP";
}

function isCurrentFactual(lower: string): boolean {
  if (CURRENT_OFFICE_RE.test(lower)) return true;
  if (/\b(weather|stock|price of|who won|match result|latest version|current captain|current ceo)\b/i.test(lower)) {
    return true;
  }
  if (CURRENT_FACT_RE.test(lower) && !isEntityLookupBare(lower)) return true;
  return false;
}

function isEntityLookupBare(lower: string): boolean {
  const stripped = stripQuestionish(lower);
  const words = stripped.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 4 && looksLikeName(stripped);
}

function isEntityLookup(text: string): boolean {
  const t = parseUserMessage(text);
  if (/^(who is|who's|who was|tell me about|how is)\b/i.test(t) && !WELLBEING_RE.test(t)) return true;
  const stripped = stripQuestionish(t);
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 4 && looksLikeName(stripped) && !HOW_TO_RE.test(t)) {
    return true;
  }
  return false;
}

function isProjectIntent(text: string): boolean {
  if (isSchoolManagementGoal(text)) return true;
  if (resolveBootstrapKind(text) === "school_management") return true;
  return (
    /\b(create|build|make|develop)\s+(?:a\s+)?(?:\w+\s+)?(?:management\s+system|erp|crm|full\s+application)\b/i.test(
      text,
    ) ||
    /\b(create|build|make|develop)\s+(?:the\s+)?(?:\w+\s+)*management\s+project\b/i.test(text)
  );
}

function isCodingIntent(text: string): boolean {
  if (isWebsiteGoal(text)) return true;
  if (resolveBootstrapKind(text) === "website" || resolveBootstrapKind(text) === "project_o") return true;
  return (
    /\b(write code|create project|run tests|npm install|implement|refactor|fix the bug)\b/i.test(text) ||
    /\bbuild (?:a |an )?(react|next\.?js|vue|angular|node)\b/i.test(text) ||
    /\b(react|next\.?js) app\b/i.test(text)
  );
}

function extractPriorEntity(history: ConversationTurn[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]!;
    if (turn.role !== "user") continue;
    const corrected = parseUserMessage(turn.content);
    const lower = corrected.toLowerCase().replace(/\?+$/, "").trim();
    if (FOLLOW_PRONOUN_RE.test(lower) || FOLLOW_TOPIC_RE.test(lower)) continue;
    const { entity, confidence } = resolveEntities(corrected);
    if (entity && confidence !== "low" && looksLikeName(stripQuestionish(entity))) return entity;
  }
  return undefined;
}

export function stripQuestionish(q: string): string {
  return q
    .replace(/^\s*(please\s+)?(tell me\s+(about\s+)?)?/i, "")
    .replace(
      /^(who is|who's|who was|who directed|who wrote|who created|what is|what's|what was|what does|when was|when did|where is|how many|how old is|how is|how are)\s+/i,
      "",
    )
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/\b(current|latest)\s+/i, "")
    .replace(/[?.,!]+$/g, "")
    .trim();
}

function looksLikeName(text: string): boolean {
  const t = text.trim();
  if (!t || /https?:\/\//i.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 1 || words.length > 5) return false;
  if (words.every((w) => STOPWORDS.has(w.toLowerCase()))) return false;
  if (FOLLOW_TOPIC_RE.test(t)) return false;
  return /^[a-z0-9][a-z0-9.'-]*(?:\s+[a-z0-9][a-z0-9.'-]*){0,4}$/i.test(t);
}

function titleCaseName(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => {
      if (/^[A-Z]{2,5}$/.test(w)) return w;
      if (/^vj$/i.test(w)) return "VJ";
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}
