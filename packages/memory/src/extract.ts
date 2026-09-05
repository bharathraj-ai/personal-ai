/** Shared preference / instruction extraction heuristics. */
export function extractMemoryCandidates(
  userMessage: string,
  userId: string,
): Array<{
  userId: string;
  content: string;
  memoryType: "preference" | "instruction";
  importance: number;
  userApproved: boolean;
}> {
  const out: Array<{
    userId: string;
    content: string;
    memoryType: "preference" | "instruction";
    importance: number;
    userApproved: boolean;
  }> = [];

  const preference = /i (?:prefer|like|always use|want)\s+(.+)/i.exec(userMessage);
  if (preference) {
    out.push({
      userId,
      content: `User preference: ${preference[1].trim().replace(/\.$/, "")}`,
      memoryType: "preference",
      importance: 0.8,
      userApproved: false,
    });
  }

  const instruction = /(?:remember that|remember:|always|never|from now on)[:\s]+(.+)/i.exec(
    userMessage,
  );
  if (instruction && !preference) {
    out.push({
      userId,
      content: `Standing instruction: ${instruction[1].trim()}`,
      memoryType: "instruction",
      importance: 0.9,
      userApproved: false,
    });
  }

  return out;
}
