import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifySourceQuality, sourceQualityRank } from "./source-quality.js";
import { checkEvidenceFreshness, isTimeSensitiveQuery } from "./freshness.js";
import { checkClaimsAgainstEvidence, extractFactualClaims } from "./claims.js";
import { createEvidence, hasAdequateEvidence } from "./evidence.js";
import {
  classifyEvidenceNeed,
  requiresExternalEvidence,
  specialistCapabilityFor,
} from "./evidence-need.js";
import { VerificationEngine, UNVERIFIED_NOTICE } from "./engine.js";
import {
  applyVerificationPolicy,
  FAILED_NOTICE,
  stripFabricatedCitations,
} from "./policy.js";
import { confidenceFromChecks } from "./result.js";
import { redactSecrets } from "./secrets.js";
import type { PlanStep } from "@personal-ai/shared";

describe("source quality", () => {
  it("classifies government, official docs, research, and secondary without calling them authoritative", () => {
    assert.equal(classifySourceQuality("https://www.cdc.gov/flu"), "government_official");
    assert.equal(classifySourceQuality("https://docs.python.org/3/library/os.html"), "official_primary");
    assert.equal(classifySourceQuality("https://arxiv.org/abs/1234.5678"), "original_research");
    assert.equal(classifySourceQuality("https://en.wikipedia.org/wiki/Test"), "reputable_secondary");
    assert.equal(classifySourceQuality("https://random-blog.example/post"), "other");
    assert.equal(classifySourceQuality(undefined), "unknown");
    assert.ok(sourceQualityRank("official_primary") < sourceQualityRank("other"));
  });
});

describe("freshness", () => {
  it("marks time-sensitive queries and fails when no publication date exists", () => {
    assert.equal(isTimeSensitiveQuery("latest India vs WI score"), true);
    assert.equal(isTimeSensitiveQuery("explain quicksort"), false);

    const undated = [
      createEvidence({
        type: "web",
        source: "example",
        content: "Team A won by 4 wickets in a thrilling finish at the stadium today.",
        url: "https://www.espncricinfo.com/match",
      }),
    ];
    const check = checkEvidenceFreshness(undated, "latest score today");
    assert.equal(check.passed, false);
    assert.match(check.details ?? "", /publication\/update date/i);
  });

  it("passes when a dated source is within the window", () => {
    const now = new Date("2026-08-27T12:00:00Z");
    const evidence = [
      createEvidence({
        type: "web",
        source: "espncricinfo",
        content: "India won the match.",
        url: "https://www.espncricinfo.com/match",
        publishedAt: new Date("2026-08-27T10:00:00Z"),
        retrievedAt: now,
      }),
    ];
    const check = checkEvidenceFreshness(evidence, "latest score today", now);
    assert.equal(check.passed, true);
  });
});

describe("claim-to-evidence", () => {
  it("supports a claim only when evidence content contains the distinctive facts", () => {
    const evidence = [
      createEvidence({
        type: "web",
        source: "espncricinfo",
        title: "India vs West Indies",
        content: "India won by 4 wickets. The final score was 278.",
        url: "https://www.espncricinfo.com/series/india",
      }),
    ];
    const supported = checkClaimsAgainstEvidence(
      ["India won by 4 wickets with a final score of 278."],
      evidence,
    );
    assert.equal(supported[0]?.supported, true);

    const unsupported = checkClaimsAgainstEvidence(
      ["Australia won by 200 runs in Perth."],
      evidence,
    );
    assert.equal(unsupported[0]?.supported, false);
  });

  it("fails safely on weak token overlap without treating it as semantic proof", () => {
    const evidence = [
      createEvidence({
        type: "web",
        source: "blog",
        content: "Ocean temperatures vary by season and latitude worldwide.",
        url: "https://example.com/ocean",
      }),
    ];
    const weak = checkClaimsAgainstEvidence(
      ["The Pacific Ocean average temperature is exactly 42.7 degrees Celsius according to NASA."],
      evidence,
    );
    assert.equal(weak[0]?.supported, false);
  });

  it("extracts factual sentences and skips unverified notices", () => {
    const claims = extractFactualClaims(
      `${UNVERIFIED_NOTICE}\nIndia won by 4 wickets according to the match report.`,
    );
    assert.ok(claims.some((c) => /India won/i.test(c)));
    assert.ok(claims.every((c) => !/couldn't verify/i.test(c)));
  });
});

describe("VerificationEngine", () => {
  const engine = new VerificationEngine();

  it("fails evidence-required answers when nothing was retrieved", () => {
    const result = engine.verifyFactualClaims({
      question: "latest ind vs wi score",
      draftAnswer: "India probably won.",
      evidence: [],
      evidenceRequired: true,
      timeSensitive: true,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.reason, UNVERIFIED_NOTICE);
    assert.equal(typeof result.confidence, "number");
    assert.ok((result.confidence ?? 1) < 1);
  });

  it("does not invent confidence when there are no checks", () => {
    assert.equal(confidenceFromChecks([]), undefined);
  });

  it("marks snippet-only web evidence as uncertain, not verified", () => {
    const snippet = createEvidence({
      type: "web",
      source: "duckduckgo",
      title: "Match report",
      url: "https://www.espncricinfo.com/match",
      content: "India won by 4 wickets in a low-scoring thriller in Florida.",
      metadata: { snippetOnly: true },
    });
    const result = engine.verifyWebEvidence({
      question: "latest ind vs wi score today",
      evidence: [snippet],
      evidenceRequired: true,
      timeSensitive: true,
    });
    assert.equal(result.status, "uncertain");
    assert.ok(result.checks.some((c) => c.name === "page_fetch" && !c.passed));
  });

  it("verifies code from actual pipeline checks", () => {
    const result = engine.verifyGeneratedCode({
      steps: [
        { name: "build", passed: true, details: "Build passed", outcome: "PASSED" },
        { name: "unit_tests", passed: false, details: "Expected 2, received 1", outcome: "FAILED" },
      ],
      report: {
        status: "FAILED",
        build: "PASSED",
        tests: "FAILED",
        security: "NOT_IMPLEMENTED",
        attempts: 1,
      },
    });
    assert.equal(result.status, "failed");
    assert.equal(result.passed, false);
  });

  it("marks NO_TESTS as uncertain via report, not TESTS_PASSED", () => {
    const result = engine.verifyGeneratedCode({
      steps: [
        { name: "build", passed: true, outcome: "PASSED" },
        { name: "unit_tests", passed: true, outcome: "NO_TESTS", details: "NO_TESTS" },
        { name: "security_checks", passed: true, outcome: "NOT_IMPLEMENTED" },
      ],
      report: {
        status: "UNCERTAIN",
        build: "PASSED",
        tests: "NO_TESTS",
        security: "NOT_IMPLEMENTED",
        attempts: 1,
        modelQuality: "MODEL_QUALITY_NOT_VERIFIED",
      },
    });
    assert.equal(result.status, "uncertain");
    assert.match(result.reason, /MODEL_QUALITY_NOT_VERIFIED|NO_TESTS|incomplete/i);
  });

  it("treats successful tool result as TOOL_SUCCEEDED not CLAIM_VERIFIED", () => {
    const step: PlanStep = {
      id: "s1",
      description: "search",
      toolName: "search_web",
      successCriteria: "results",
    };
    const verification = engine.verifyToolResult(step, {
      stepId: "s1",
      durationMs: 10,
      timestamp: new Date(),
      output: {
        success: true,
        output: {
          provider: "duckduckgo",
          results: [
            {
              title: "A",
              url: "https://www.bbc.com/news",
              snippet: "Headline about the parliamentary vote held this morning in London.",
            },
          ],
        },
      },
    });
    assert.equal(verification.passed, true);
    assert.equal(verification.status, "not_verified");
    assert.match(verification.reason, /TOOL_SUCCEEDED/);
    assert.ok(verification.evidence.length > 0);
  });
});

describe("evidence-first policy", () => {
  it("requires web evidence for current-event questions and not for local file actions", () => {
    assert.equal(requiresExternalEvidence("latest ind vs wi score"), true);
    assert.equal(classifyEvidenceNeed("latest ind vs wi score").timeSensitive, true);
    assert.equal(requiresExternalEvidence("who is the hero of gbu"), true);
    assert.equal(requiresExternalEvidence("who directed Titanic"), true);
    assert.equal(requiresExternalEvidence("who is virat kohli"), false);
    assert.equal(requiresExternalEvidence("what is 2+2"), false);
    assert.equal(requiresExternalEvidence("create a school management system"), false);
    assert.equal(requiresExternalEvidence("create folder notes in downloads"), false);
    assert.equal(classifyEvidenceNeed("write code for fizzbuzz").coding, true);
  });

  it("uses local time for current date — does not force web search", () => {
    const need = classifyEvidenceNeed("What is the current date?");
    assert.equal(need.localTime, true);
    assert.equal(need.web, false);
    assert.equal(requiresExternalEvidence("What is the current date?"), false);
  });

  it("triggers RAG for project documentation phrasing", () => {
    assert.equal(
      classifyEvidenceNeed("What does my project documentation say about authentication?").rag,
      true,
    );
    assert.equal(classifyEvidenceNeed("according to my docs what is auth?").rag, true);
    assert.equal(classifyEvidenceNeed("what do the project files say about login?").rag, true);
  });

  it("detects specialist capabilities without making specialists the primary brain", () => {
    assert.equal(specialistCapabilityFor("Please review this code carefully"), "code_review");
    assert.equal(specialistCapabilityFor("fix the bug in the test suite"), "code_fix");
    assert.equal(specialistCapabilityFor("Hello"), undefined);
    assert.equal(specialistCapabilityFor("Explain recursion"), undefined);
    assert.equal(specialistCapabilityFor("Create hello.py that prints Hello World."), "coding");
  });

  it("hard-fails evidence-required answers when verification failed", () => {
    const engine = new VerificationEngine();
    const verification = engine.verifyFactualClaims({
      question: "who won today",
      draftAnswer: "They won.",
      evidence: [],
      evidenceRequired: true,
      timeSensitive: true,
    });
    const text = applyVerificationPolicy("They won.", verification, true);
    assert.match(text, new RegExp(FAILED_NOTICE));
    assert.match(text, new RegExp(UNVERIFIED_NOTICE));
    assert.doesNotMatch(text, /^They won\./);
  });

  it("does not present uncertain drafts as facts", () => {
    const evidence = [
      createEvidence({
        type: "web",
        source: "news",
        title: "Match",
        url: "https://www.espncricinfo.com/a",
        content: "Some match notes without a clear winner declared in this excerpt for verification.",
        publishedAt: new Date(),
      }),
    ];
    const verification = {
      passed: false,
      criteria: "x",
      status: "uncertain" as const,
      evidence,
      checks: [{ name: "claim_support", passed: false, details: "unsupported" }],
      reason: "Claims unsupported",
    };
    const text = applyVerificationPolicy(
      "Australia definitely won by 200 runs. https://evil.example/fake",
      verification,
      true,
    );
    assert.match(text, /UNCERTAIN/);
    assert.doesNotMatch(text, /Australia definitely won/);
    assert.doesNotMatch(text, /evil\.example/);
  });

  it("strips fabricated citations not present in evidence", () => {
    const evidence = [
      createEvidence({
        type: "web",
        source: "ok",
        content: "Enough content here to count as usable evidence for tests and checks.",
        url: "https://www.espncricinfo.com/real",
      }),
    ];
    const cleaned = stripFabricatedCitations(
      "According to https://totally-fake.example/x and https://www.espncricinfo.com/real",
      evidence,
    );
    assert.match(cleaned, /espncricinfo\.com\/real/);
    assert.match(cleaned, /citation removed/);
    assert.doesNotMatch(cleaned, /totally-fake/);
  });

  it("redacts secrets from evidence content including groq/cerebras-shaped keys", () => {
    const e = createEvidence({
      type: "tool",
      source: "read_file",
      content: "api_key=sk-abcdefghijklmnopqrstuvwxyz123456 password=hunter2 extra",
    });
    assert.equal(e.content.includes("sk-"), false);
    assert.match(e.content, /\[REDACTED\]/);
    assert.equal(redactSecrets("token sk-abcdefghijklmnopqrstuvwxyz123456 extra").includes("sk-"), false);
    assert.equal(
      redactSecrets("GROQ gsk_abcdefghijklmnopqrstuvwxyz1234567890").includes("gsk_"),
      false,
    );
  });

  it("treats short empty evidence as inadequate", () => {
    assert.equal(hasAdequateEvidence([]), false);
    assert.equal(
      hasAdequateEvidence([
        createEvidence({ type: "web", source: "x", content: "too short" }),
      ]),
      false,
    );
  });
});
