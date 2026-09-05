/**
 * Detect whether a goal needs external evidence (web / RAG / memory)
 * rather than model knowledge or local/coding actions.
 */

import { classifyCodingTask } from "../coding-task.js";

export interface EvidenceNeed {
  web: boolean;
  rag: boolean;
  memory: boolean;
  timeSensitive: boolean;
  coding: boolean;
  localAction: boolean;
  /** Answerable by get_current_time — do not force web search. */
  localTime: boolean;
}

const LOCAL_ACTION_RE =
  /\b(create|make|mkdir|delete|remove|rm|erase|rename|move|copy)\b.+\b(folder|directory|dir|file)\b|\bin my (laptop|pc|computer|downloads?|desktop|documents?)\b|\bhow's my laptop\b|\blaptop status\b/i;

const MATH_RE = /^(?:what(?:'s| is)\s+)?\d+(?:\.\d+)?\s*[\+\-×x*\/÷]\s*\d+/i;

const CODING_RE =
  /\b(write code|create project|run tests|npm install|implement|refactor|fix the bug|typescript|python script|hello-?world|hello\.py|prints?\s+hello|rest\s*api|build a model|predict|ocean temperature|project\s+o|make\s+(?:a\s+)?website|create\s+(?:a\s+)?website|build\s+(?:a\s+)?website|web app|landing page|html page|static site|school\s+management|management\s+system|full\s+application|build (?:a |an )?(?:react|next\.?js|vue)(?:\s+app)?)\b/i;

const LOCAL_TIME_RE =
  /\b(what('?s| is)?\s+the\s+current\s+(date|time)|current\s+(date|time)|what\s+time\s+is\s+it|what\s+day\s+is\s+it|today'?s\s+date|date\s+today)\b/i;

const WEB_RE =
  /\b(vs\.?|score|news|today|latest|weather|who won|match|cricket|football|stock|price of|what is happening|search the web|google|live|breaking|who is the current|who directed|who wrote|who created|hero of|protagonist|capital of|current ceo|latest version|when was|when did|how many|compare)\b/i;

const TIME_SENSITIVE_RE =
  /\b(latest|tonight|currently|right now|this week|this month|live|breaking|score|weather|price|as of)\b|\bcurrent\s+(?!date\b|time\b)[\w-]+/i;

const RAG_RE =
  /\b(my\s+(project\s+)?(documentation|document|documents|docs?|pdf|notes?|files?)|project\s+(documentation|docs?|files?|document)|in\s+(the|my)\s+(documentation|document|docs?|notes|files?|pdf)|according\s+to\s+(my|the)\s+(documentation|document|docs?|notes|files?|pdf|project)|what\s+do(?:es)?\s+(my|the)\s+(project\s+)?(documentation|document|docs?|notes|files?)\s+say|search\s+(my\s+)?(documents?|docs?|files?)|documentation\s+say\s+about)\b/i;

const MEMORY_RE =
  /\b(remember|my preference|what do i (like|prefer)|we (decided|agreed)|last time we)\b/i;

const GREETING_RE =
  /^(hi|hello|hey|thanks|thank you|ok|okay|bye|good morning|good night)\b/i;

const CASUAL_CHAT_RE =
  /^(what('?s| is| are)?\s+you\s+(doing|up to)|how are you|who are you|what can you do|help|test|ping)\b/i;

export function classifyEvidenceNeed(goal: string): EvidenceNeed {
  const text = goal.trim();
  const localAction = LOCAL_ACTION_RE.test(text);
  const localTime = LOCAL_TIME_RE.test(text);
  const greeting = GREETING_RE.test(text) || CASUAL_CHAT_RE.test(text);
  const math = MATH_RE.test(text);
  const codingTask = classifyCodingTask(text);
  const coding = Boolean(codingTask) || (CODING_RE.test(text) && !WEB_RE.test(text) && !localTime);

  if (localAction || greeting || math) {
    return {
      web: false,
      rag: false,
      memory: false,
      timeSensitive: false,
      coding,
      localAction,
      localTime: false,
    };
  }

  if (localTime) {
    return {
      web: false,
      rag: false,
      memory: false,
      timeSensitive: false,
      coding: false,
      localAction: false,
      localTime: true,
    };
  }

  const timeSensitive = TIME_SENSITIVE_RE.test(text) || /\btoday\b/i.test(text);
  const rag = RAG_RE.test(text);
  const web = (WEB_RE.test(text) || timeSensitive) && !rag;

  return {
    web,
    rag,
    memory: MEMORY_RE.test(text),
    timeSensitive,
    coding,
    localAction: false,
    localTime: false,
  };
}

export function evidenceVerificationEnabled(): boolean {
  return process.env.ENABLE_EVIDENCE_VERIFICATION !== "false";
}

export function requiresExternalEvidence(goal: string): boolean {
  if (!evidenceVerificationEnabled()) return false;
  const need = classifyEvidenceNeed(goal);
  if (need.localAction || need.coding || need.localTime) return false;
  return need.web || need.rag || need.timeSensitive;
}

/** Specialist capability hint for ProviderManager — empty means Bharath-only. */
export function specialistCapabilityFor(goal: string):
  | "code_review"
  | "code_fix"
  | "coding"
  | undefined {
  const m = goal.toLowerCase();
  if (/\b(review|critique|audit)\b.+\b(code|pr|pull request|diff)\b|\bcode review\b/.test(m)) {
    return "code_review";
  }
  if (/\b(fix|repair|debug)\b.+\b(bug|error|test|build|code)\b|\bfix the (bug|error|test)\b/.test(m)) {
    return "code_fix";
  }
  if (/\b(large codebase|refactor this|implement)\b/.test(m) && /\b(code|project|module)\b/.test(m)) {
    return "coding";
  }
  if (classifyCodingTask(goal)) {
    return "coding";
  }
  return undefined;
}
