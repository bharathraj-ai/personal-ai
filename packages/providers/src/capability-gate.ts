import type { ModelAdapter } from "@personal-ai/ai-core";
import type { ProviderCapability } from "@personal-ai/shared";

export type CapabilityTestName =
  | "simple_instruction"
  | "json_output"
  | "code_generation"
  | "planning"
  | "structured_multifile";

export type CapabilityTestResult = "PASS" | "FAIL";

export type CapabilitySuite = Record<CapabilityTestName, CapabilityTestResult>;

function looksLikeJsonObject(text: string): boolean {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!t.startsWith("{")) return false;
  try {
    const v = JSON.parse(t);
    return Boolean(v && typeof v === "object" && !Array.isArray(v));
  } catch {
    return false;
  }
}

async function once(adapter: ModelAdapter, user: string, system?: string): Promise<string> {
  const result = await adapter.generate({
    messages: [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      { role: "user", content: user },
    ],
    temperature: 0,
    maxTokens: 256,
  });
  return result.content ?? "";
}

/**
 * Probe Bharath (or any own-model adapter) with small tasks.
 * Results are evidence, not permanent hardcoded capability claims.
 */
export async function runOwnModelCapabilitySuite(adapter: ModelAdapter): Promise<CapabilitySuite> {
  const suite: CapabilitySuite = {
    simple_instruction: "FAIL",
    json_output: "FAIL",
    code_generation: "FAIL",
    planning: "FAIL",
    structured_multifile: "FAIL",
  };

  try {
    const ping = await once(adapter, "Reply with the single word PONG and nothing else.");
    if (/\bPONG\b/i.test(ping) && ping.trim().length < 40) {
      suite.simple_instruction = "PASS";
    }
  } catch {
    suite.simple_instruction = "FAIL";
  }

  try {
    const json = await once(
      adapter,
      'Return ONLY JSON: {"ok":true}',
      "Return valid JSON only. No markdown.",
    );
    if (looksLikeJsonObject(json) && /"ok"\s*:\s*true/.test(json)) {
      suite.json_output = "PASS";
    }
  } catch {
    suite.json_output = "FAIL";
  }

  try {
    const code = await once(
      adapter,
      "Write a Python one-liner that prints Hello World. Return only the Python line.",
    );
    if (/print\s*\(\s*["']Hello World["']\s*\)/.test(code)) {
      suite.code_generation = "PASS";
    }
  } catch {
    suite.code_generation = "FAIL";
  }

  try {
    const plan = await once(
      adapter,
      'Return ONLY JSON: {"steps":[{"id":"1","description":"write hello.py"}]}',
      "Return valid JSON only.",
    );
    if (looksLikeJsonObject(plan) && /"steps"\s*:/.test(plan)) {
      suite.planning = "PASS";
    }
  } catch {
    suite.planning = "FAIL";
  }

  try {
    const multi = await once(
      adapter,
      'Return ONLY JSON: {"files":[{"path":"a.py","operation":"create","content":"x"},{"path":"b.py","operation":"create","content":"y"}]}',
      "Return valid JSON only.",
    );
    if (looksLikeJsonObject(multi) && /"files"\s*:/.test(multi) && (multi.match(/"path"/g) ?? []).length >= 2) {
      suite.structured_multifile = "PASS";
    }
  } catch {
    suite.structured_multifile = "FAIL";
  }

  return suite;
}

export function ownCapabilitiesFromSuite(suite: CapabilitySuite): ProviderCapability[] {
  const caps: ProviderCapability[] = [
    "chat",
    "generation",
    "reasoning",
    "streaming",
    "verification",
  ];
  if (suite.planning === "PASS") caps.push("planning");
  if (suite.json_output === "PASS") caps.push("json_structured_output");
  if (suite.code_generation === "PASS" && suite.json_output === "PASS") {
    caps.push("coding");
  }
  return caps;
}
