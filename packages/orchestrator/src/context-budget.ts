import type { Message } from "@personal-ai/shared";

/** Conservative token budgets by provider id. Bharath max_seq_len is 1024. */
export function contextTokenBudget(providerId: string): number {
  const id = providerId.toLowerCase();
  if (id.includes("bharath")) return 1024;
  if (id.includes("groq")) return 6000;
  if (id.includes("cerebras") || id.includes("gemini")) return 8192;
  return 4096;
}

/** Rough char budget (not a tokenizer). Prefer summarizing over truncating requirements. */
export function contextCharBudget(providerId: string): number {
  return Math.max(800, Math.floor(contextTokenBudget(providerId) * 3.2) - 80);
}

export function summarizeForBudget(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const keep = Math.max(200, Math.floor(maxChars * 0.45));
  const head = t.slice(0, keep);
  const tail = t.slice(-Math.floor(keep * 0.35));
  return `${head}\n\n[...summarized older context omitted...]\n\n${tail}`;
}

export function budgetPlanningUserContent(input: {
  goal: string;
  workspaceId?: string;
  needSummary: string;
  toolNames: string[];
  history: Message[];
  providerId: string;
}): string {
  const budget = contextCharBudget(input.providerId);
  const tools = input.toolNames.slice(0, 24).join(", ");
  const lastUser = [...input.history].reverse().find((m) => m.role === "user");
  const prior = lastUser ? summarizeForBudget(lastUser.content, Math.min(400, Math.floor(budget * 0.2))) : "";
  const goal = summarizeForBudget(input.goal, Math.min(600, Math.floor(budget * 0.35)));
  const parts = [
    `Goal: ${goal}`,
    `WorkspaceId: ${input.workspaceId ?? "none"}`,
    `Need: ${input.needSummary}`,
    `Tools: ${tools}`,
  ];
  if (prior && prior !== input.goal) {
    parts.push(`Recent user context: ${prior}`);
  }
  return summarizeForBudget(parts.join("\n"), budget);
}

export function budgetCodingUserContent(input: {
  goal: string;
  scale?: string;
  planSummary?: string;
  inspectionSummary: string;
  existingFiles: string[];
  packageJson?: string;
  resume?: boolean;
  providerId: string;
}): string {
  const budget = contextCharBudget(input.providerId);
  const files = input.existingFiles.slice(0, 40).join(", ");
  const planShare = Math.floor(budget * 0.45);
  const plan = input.planSummary
    ? summarizeForBudget(input.planSummary, planShare)
    : "";
  const parts = [
    `Goal: ${summarizeForBudget(input.goal, Math.min(1200, Math.floor(budget * 0.25)))}`,
    input.scale ? `Scale: ${input.scale}` : "",
    input.resume ? "Mode: RESUME — extend existing project; do not restart from scratch." : "",
    plan ? `\nApproved plan:\n${plan}` : "",
    `Inspection: ${summarizeForBudget(input.inspectionSummary, 400)}`,
    `Existing files: ${files}`,
    input.packageJson
      ? `package.json:\n${summarizeForBudget(input.packageJson, 1200)}`
      : "",
  ].filter(Boolean);
  return summarizeForBudget(parts.join("\n"), budget);
}

export const SHORT_PLANNING_PROMPT = `You are a task planner. Return ONLY JSON:
{"reasoning":"string","steps":[{"id":"s1","description":"...","toolName":"optional","successCriteria":"..."}]}
Use only listed tool names. Keep the plan short. Do not invent tools.`;
