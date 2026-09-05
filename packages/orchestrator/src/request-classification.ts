import type { RequestScale } from "@personal-ai/shared";
import { isProjectOGoal, isSchoolManagementGoal, isWebsiteGoal } from "./coding-bootstrap.js";

const FULL_APP_RE =
  /\b(complete|full(?:[- ]stack)?|entire|end[- ]to[- ]end|production[- ]ready|all[- ]in[- ]one)\b/i;
const SYSTEM_RE =
  /\b(management\s+system|erp|crm|saas|platform|portal|suite|ecosystem)\b/i;
const LARGE_SYSTEM_RE =
  /\b(enterprise|multi[- ]tenant|hospital\s+management|erp\s+system|operating\s+system)\b/i;
const MVP_RE =
  /\b(basic|simple|minimal|mvp|starter|dashboard|prototype)\b/i;
const FEATURE_RE =
  /\b(add|include|implement|missing)\b.+\b(to|into|in)\b.+\b(app|system|project|site|website)\b/i;
const SMALL_TASK_RE =
  /\b(login\s+form|contact\s+form|button|component|fix|typo|rename|landing\s+page|single\s+page)\b/i;

/**
 * Classify the user goal BEFORE implementation.
 * FULL_APPLICATION / LARGE_SYSTEM must not be silently turned into a one-page demo.
 */
export function classifyRequest(goal: string): RequestScale {
  const g = goal.trim();
  if (!g) return "SMALL_TASK";

  if (SMALL_TASK_RE.test(g) && !SYSTEM_RE.test(g) && !FULL_APP_RE.test(g)) {
    return "SMALL_TASK";
  }

  if (FEATURE_RE.test(g) && !FULL_APP_RE.test(g) && !/\bcreate\s+(?:a\s+)?(?:complete|full)/i.test(g)) {
    return "FEATURE";
  }

  if (LARGE_SYSTEM_RE.test(g) || (FULL_APP_RE.test(g) && SYSTEM_RE.test(g) && /\benterprise\b/i.test(g))) {
    return "LARGE_SYSTEM";
  }

  if (isSchoolManagementGoal(g) || (FULL_APP_RE.test(g) && SYSTEM_RE.test(g))) {
    return "FULL_APPLICATION";
  }

  if (isProjectOGoal(g)) {
    return "MVP";
  }

  if (/\b(create|build|make|develop)\s+(?:a\s+)?(?:complete|full)\s+(?:website|web\s*app|application)\b/i.test(g)) {
    return "FULL_APPLICATION";
  }

  if (SYSTEM_RE.test(g) && /\b(create|build|make|develop|implement)\b/i.test(g)) {
    return "FULL_APPLICATION";
  }

  if (MVP_RE.test(g) && /\b(create|build|make)\b/i.test(g)) {
    return "MVP";
  }

  if (isWebsiteGoal(g)) {
    if (FULL_APP_RE.test(g)) return "FULL_APPLICATION";
    if (/\blanding\s+page\b/i.test(g)) return "SMALL_TASK";
    return "MVP";
  }

  if (g.length < 24 && !SYSTEM_RE.test(g)) return "SMALL_TASK";

  return "SMALL_TASK";
}

export function requiresMandatoryDecomposition(scale: RequestScale): boolean {
  return scale === "FULL_APPLICATION" || scale === "LARGE_SYSTEM";
}

export function requiresImplementationGate(scale: RequestScale, goal: string): boolean {
  if (scale === "FULL_APPLICATION" || scale === "LARGE_SYSTEM" || scale === "MVP") return true;
  // Keep the existing large-request heuristic as a backstop.
  return (
    gLengthOk(goal) &&
    /\b(?:create|build|make|develop|implement)\b.*\b(?:school|management|erp|crm|e-?commerce|saas|platform|system|application|app|portal|website|web\s*app|site)\b/i.test(
      goal,
    )
  );
}

function gLengthOk(goal: string): boolean {
  return goal.trim().length >= 20;
}

export function scaleLabel(scale: RequestScale): string {
  switch (scale) {
    case "SMALL_TASK":
      return "small task";
    case "FEATURE":
      return "feature addition";
    case "MVP":
      return "MVP";
    case "FULL_APPLICATION":
      return "full application";
    case "LARGE_SYSTEM":
      return "large system";
  }
}
