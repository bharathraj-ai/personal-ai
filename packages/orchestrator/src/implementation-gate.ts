/**
 * Goals that must use clarify → plan → approval → freeze (no SMALL_PROJECT shortcut).
 */
export function requiresFullImplementationPipeline(goal: string): boolean {
  const g = goal.trim();
  if (!g) return false;
  if (/\bschool\s+management\b|\bphase-?\s*1\b|\bpostgresql\b|\bneon\b/i.test(g)) {
    return true;
  }
  if (/\bREST API\b/i.test(g) && goalRequiresRealTests(g)) {
    return true;
  }
  if (process.env.CODING_REQUIRE_APPROVAL_GATE === "true") {
    return /\b(create|build|implement)\b/i.test(g);
  }
  return false;
}

export function goalRequiresRealTests(goal: string): boolean {
  return (
    /\b(automated|real)\s+\w*\s*test/i.test(goal) ||
    /\bbehavioral\s+test/i.test(goal) ||
    /\bwith tests?\b/i.test(goal)
  );
}
