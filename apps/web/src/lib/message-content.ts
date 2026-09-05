/** Pure helpers for chat message rendering — kept out of React for unit tests. */

export function isRenderLeakContent(content: string): boolean {
  const t = content.trim();
  if (!t) return true;
  if (/You are a task planner/i.test(t)) return true;
  if (/Use only listed tool names/i.test(t)) return true;
  if (/Return ONLY JSON/i.test(t) && /successCriteria/i.test(t)) return true;
  if (/WorkspaceId:\s*[0-9a-f-]{8,}/i.test(t) && /Need:\s*(?:chat|coding)/i.test(t)) return true;
  if (/^return\s*\(\)\s*=>/i.test(t)) return true;
  if (/^return\s*\d+\s*\)/i.test(t)) return true;
  if (/^return\s+0\s*\)/i.test(t)) return true;
  if (/^return\b/i.test(t) && t.length < 40 && !/[.!?]/.test(t) && !/\bis\b/i.test(t)) return true;
  if (/^\(\)\s*=>/i.test(t) && t.length < 80) return true;
  if (/^useEffect\s*\(/i.test(t)) return true;
  return false;
}

export function normalizeAssistantContent(content: string): string {
  if (typeof content !== "string") return "";
  // Whole-message planner echoes — drop entirely.
  if (/You are a task planner/i.test(content) || (/Use only listed tool names/i.test(content) && /WorkspaceId:/i.test(content))) {
    return "";
  }
  if (/Return ONLY JSON/i.test(content) && /successCriteria/i.test(content) && /Tools:/i.test(content)) {
    return "";
  }
  return content
    .replace(/\n*Verification:\s*(verified|uncertain|failed|not_verified)\.?[\s\S]*$/i, "")
    .replace(/\n*\([^)]*(?:not independently verified|Bharath model weights|Live web results)[^)]*\)/gi, "")
    .replace(/\n*[^\n]*(?:Bharath model weights|MODEL NOT[ _]LOADED|weights are NOT_LOADED)[^\n]*/gi, "")
    .replace(/^return\s*\(\)\s*=>\s*-*-?\s*$/gim, "")
    .replace(/^return\s*\(\)\s*=>.*$/gim, "")
    .replace(/^return\s*\d+\s*\)\s*-*.*$/gim, "")
    .replace(/^return\s+0\s*\)\s*-*.*$/gim, "")
    .replace(/^\(\)\s*=>\s*-*-?\s*$/gim, "")
    .trim();
}

/** Whether sources exist without a usable answer body. */
export function hasSourcesWithoutAnswer(
  content: string,
  sourceCount: number,
): boolean {
  const body = normalizeAssistantContent(content);
  return sourceCount > 0 && (isRenderLeakContent(body) || body.length < 8);
}
