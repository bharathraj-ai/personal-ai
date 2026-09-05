import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeConversation,
  classifyIntent,
  resolveConversationReferences,
  tryLocalCompute,
} from "./conversation-intent.js";
import { analyzeSearchIntent } from "./search-intent.js";
import { extractLeadAnswer, formatEvidenceAnswerWithoutModel, isLeakedSystemInstruction, isUnusableAssistantAnswer, sanitizeUserFacingAnswer, synthesizeAnswerFromEvidence } from "./verification/policy.js";
import { createEvidence } from "./verification/evidence.js";

describe("conversation intent", () => {
  it("classifies the documented examples", () => {
    assert.equal(classifyIntent("virat kohli"), "ENTITY_LOOKUP");
    assert.equal(classifyIntent("who is virat kohli?"), "ENTITY_LOOKUP");
    assert.equal(classifyIntent("who is the current captain of India?"), "CURRENT_FACTUAL");
    assert.equal(classifyIntent("compare React and Next.js"), "COMPARISON");
    assert.equal(classifyIntent("create a school management system"), "PROJECT");
    assert.equal(classifyIntent("how do I install Node.js?"), "HOW_TO");
    assert.equal(classifyIntent("hi"), "CHAT");
    assert.equal(classifyIntent("build a React app"), "CODING");
    assert.equal(classifyIntent("create we site for iron box company"), "CODING");
    assert.equal(classifyIntent("latest node.js version"), "CURRENT_FACTUAL");
    assert.equal(classifyIntent("what is 2+2?"), "FACTUAL");
  });

  it("does not search for chat, math, project, or coding", () => {
    assert.equal(analyzeConversation("hi", { modelReady: false }).shouldSearch, false);
    assert.equal(analyzeConversation("what is 2+2?", { modelReady: false }).shouldSearch, false);
    assert.equal(analyzeConversation("what is 2+2?").localAnswer, "4");
    assert.equal(
      analyzeConversation("create a school management system", { modelReady: false }).shouldSearch,
      false,
    );
    assert.equal(analyzeConversation("build a React app", { modelReady: false }).shouldSearch, false);
  });

  it("searches current facts and offline entity lookups, not stable entity lookups when Bharath is ready", () => {
    assert.equal(analyzeConversation("virat kohli", { modelReady: true }).shouldSearch, true);
    assert.equal(analyzeConversation("virat kohli", { modelReady: false }).shouldSearch, true);
    assert.equal(analyzeConversation("latest node.js version", { modelReady: true }).shouldSearch, true);
    assert.equal(analyzeConversation("latest node.js version").evidenceRequired, true);
  });

  it("treats virat koli as Virat Kohli and short names as introductions", () => {
    const a = analyzeConversation("virat koli", { modelReady: false });
    assert.match(a.resolvedQuery, /Virat Kohli/i);
    assert.equal(a.kind, "ENTITY_LOOKUP");
    assert.equal(a.answerLength, "brief");
    const intent = analyzeSearchIntent("virat koli");
    assert.ok(intent.generatedQueries.some((q) => /Virat Kohli biography career/i.test(q)));
  });

  it("resolves follow-ups from conversation context", () => {
    const history = [
      { role: "user", content: "Who is Virat Kohli?" },
      { role: "assistant", content: "Virat Kohli is an Indian cricketer." },
    ];
    const records = resolveConversationReferences("his records", history);
    assert.equal(records.followUp, true);
    assert.match(records.resolvedQuery, /Virat Kohli records/i);

    const age = analyzeConversation("how old is he?", { history, modelReady: false });
    assert.match(age.resolvedQuery, /Virat Kohli/i);
    assert.equal(age.shouldSearch, true);
  });

  it("does not invent a wellbeing answer for how is NAME", () => {
    const a = analyzeConversation("how is vj siddhu?", { modelReady: false });
    assert.equal(a.kind, "ENTITY_LOOKUP");
    assert.equal(a.wellbeingAmbiguous, true);
    const doing = analyzeConversation("how is vj siddhu doing?", { modelReady: false });
    assert.equal(doing.kind, "CURRENT_FACTUAL");
  });
});

describe("local compute", () => {
  it("evaluates simple arithmetic without search", () => {
    assert.equal(tryLocalCompute("what is 2+2?"), "4");
    assert.equal(tryLocalCompute("2+2"), "4");
  });
});

describe("user-facing search answers", () => {
  it("returns a short intro without model-status or URL dumps", () => {
    const evidence = [
      createEvidence({
        type: "web",
        source: "wikipedia",
        title: "Virat Kohli",
        url: "https://en.wikipedia.org/wiki/Virat_Kohli",
        content:
          "Virat Kohli is an Indian international cricketer and former captain of the Indian national cricket team. He is a right-handed batsman.",
        metadata: { snippetOnly: false },
      }),
    ];
    const lead = extractLeadAnswer("virat kohli", evidence);
    assert.ok(lead);
    assert.match(lead!, /Virat Kohli is an Indian/i);
    const text = formatEvidenceAnswerWithoutModel("virat kohli", evidence, {
      passed: false,
      criteria: "x",
      status: "not_verified",
      reason: "optional search",
      evidence,
      checks: [],
    });
    assert.match(text, /Virat Kohli is an Indian/i);
    assert.equal(/Web search — not independently verified/i.test(text), false);
    assert.equal(/model weights/i.test(text), false);
    assert.equal(/https?:\/\//.test(text), false);
    assert.equal(/Sources:/i.test(text), false);
  });

  it("strips internal notices from answers", () => {
    const cleaned = sanitizeUserFacingAnswer(
      "Virat Kohli is a cricketer.\n\n(Web search — not independently verified; Bharath model weights may be unloaded.)",
    );
    assert.equal(/model weights/i.test(cleaned), false);
    assert.match(cleaned, /Virat Kohli is a cricketer/);
  });

  it("strips leaked system instructions", () => {
    const cleaned = sanitizeUserFacingAnswer(
      "Resolve pronouns and short follow-ups to that entity. Answer the question first.\n\nVirat Kohli\n\n--\n## Module 8",
    );
    assert.equal(isLeakedSystemInstruction(cleaned), false);
    assert.match(cleaned, /Virat Kohli/);
  });

  it("rejects return () => code leaks as unusable answers", () => {
    assert.equal(isUnusableAssistantAnswer("return () => --"), true);
    assert.equal(isUnusableAssistantAnswer("return () =>"), true);
    assert.equal(isUnusableAssistantAnswer("return 0) --"), true);
    assert.equal(isUnusableAssistantAnswer("return 0)"), true);
    assert.equal(isUnusableAssistantAnswer(""), true);
    assert.equal(
      isUnusableAssistantAnswer(
        "Virat Kohli is an Indian international cricketer and former captain of India.",
      ),
      false,
    );
  });

  it("rejects leaked planner prompts as unusable answers", () => {
    const leak = `You are a task planner. Return ONLY JSON:
{"reasoning":"string","steps":[{"id":"s1","description":"...","toolName":"optional","successCriteria":"..."}]}
Use only listed tool names. Keep the plan short. Do not invent tools.
Goal: create we site for iron box company
WorkspaceId: 670642f3-3338-4b29-b676-f3a250fff2ef
Need: chat
Tools: get_current_time, search_memory, save_memory`;
    assert.equal(isLeakedSystemInstruction(leak), true);
    assert.equal(isUnusableAssistantAnswer(leak), true);
    assert.equal(sanitizeUserFacingAnswer(leak), "");
  });

  it("corrects viray kohli typo to Virat Kohli", () => {
    const a = analyzeConversation("viray kohli", { modelReady: false });
    assert.match(a.resolvedQuery, /Virat Kohli/i);
    assert.equal(a.shouldSearch, true);
  });

  it("synthesizes a natural-language answer from evidence, not source titles", () => {
    const evidence = [
      createEvidence({
        type: "web",
        source: "wikipedia",
        title: "Virat Kohli - Wikipedia",
        url: "https://en.wikipedia.org/wiki/Virat_Kohli",
        content:
          "Virat Kohli is an Indian international cricketer and former captain of the Indian national cricket team. He plays for Royal Challengers Bengaluru in the IPL.",
      }),
      createEvidence({
        type: "web",
        source: "web",
        title: "viratkohli",
        url: "https://www.viratkohli.online/",
        content: "Official site for Virat Kohli.",
      }),
    ];
    const verification = {
      passed: true,
      criteria: "x",
      status: "not_verified" as const,
      reason: "optional",
      evidence,
      checks: [],
    };
    for (const q of ["virat kohli", "who is virat kohli?", "tell me about virat kohli"]) {
      const answer = synthesizeAnswerFromEvidence(q, evidence, verification);
      assert.ok(answer.length > 20, `empty answer for ${q}`);
      assert.match(answer, /Virat Kohli/i);
      assert.equal(/return\s*\(\)\s*=>/i.test(answer), false);
      assert.equal(/^Wikipedia$/i.test(answer.trim()), false);
    }
  });

  it("does not treat hello as a search query", () => {
    assert.equal(analyzeConversation("hello", { modelReady: true }).shouldSearch, false);
    assert.equal(analyzeConversation("what is binary search?", { modelReady: true }).kind !== "SEARCH_REQUIRED", true);
  });

  it("classifies collage management project as PROJECT", () => {
    assert.equal(classifyIntent("create the collage management project"), "PROJECT");
    const a = analyzeConversation("create the collage management project", {
      history: [{ role: "user", content: "virat kohli" }],
      lastEntity: "Virat Kohli",
      modelReady: true,
    });
    assert.equal(a.kind, "PROJECT");
    assert.equal(a.entity, undefined);
  });
});
