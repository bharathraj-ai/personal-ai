import { classifyRequest } from "./request-classification.js";

/** P4 coding-task classes — independent of RequestScale, but FULL_APPLICATION aligns. */
export type CodingTaskClass =
  | "TRIVIAL"
  | "SMALL_EDIT"
  | "BUG_FIX"
  | "SMALL_PROJECT"
  | "FULL_APPLICATION";

const TRIVIAL_RE =
  /\bhello\.py\b|(?:create|write|make).{0,40}prints?\s+hello(?:\s+world)?|(?:create|write|make).{0,40}\bhello\s+world\b|prints?\s+hello\s+world|create\s+(?:a\s+)?python\s+file/i;
const REST_RE =
  /\brest\s*api\b|\bone\s+endpoint\b|\bhttp\s+endpoint\b|\bexpress\b|\bfastify\b|\bflask\b/i;
const BUG_RE = /\b(fix|repair|debug)\b.+\b(bug|error|test|build|crash)\b|\bfix the (bug|error)\b/i;
const EDIT_RE = /\b(rename|typo|small edit|change the)\b/i;
const CODE_FILE_RE = /\.(py|ts|tsx|js|jsx)\b|python\s+script|write\s+code|implement\s+/i;

/**
 * Classify a coding request. Undefined means not a coding implementation task.
 */
export function classifyCodingTask(goal: string): CodingTaskClass | undefined {
  const g = goal.trim();
  if (!g) return undefined;

  const scale = classifyRequest(g);
  if (scale === "FULL_APPLICATION" || scale === "LARGE_SYSTEM") {
    return "FULL_APPLICATION";
  }

  if (TRIVIAL_RE.test(g) && !/\bmanagement\s+system\b/i.test(g)) {
    return "TRIVIAL";
  }
  if (REST_RE.test(g)) {
    return "SMALL_PROJECT";
  }
  if (BUG_RE.test(g)) {
    return "BUG_FIX";
  }
  if (EDIT_RE.test(g) && g.length < 160) {
    return "SMALL_EDIT";
  }
  if (CODE_FILE_RE.test(g) || /\b(create|write|implement)\b.+\b(file|script|module|endpoint)\b/i.test(g)) {
    return g.length < 100 ? "TRIVIAL" : "SMALL_PROJECT";
  }
  return undefined;
}

export function codingRequiresReliableSpecialist(cls: CodingTaskClass): boolean {
  return cls === "FULL_APPLICATION" || cls === "SMALL_PROJECT" || cls === "BUG_FIX";
}

export function codingAgentPlanReasoning(cls: CodingTaskClass): string {
  if (cls === "TRIVIAL" || cls === "SMALL_EDIT") {
    return "Trivial coding task. Use Bharath only if structured-output capability passed; otherwise a coding specialist.";
  }
  return "Bharath is not reliable enough for this coding task. I will use the configured coding specialist.";
}
