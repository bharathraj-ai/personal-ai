import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasSourcesWithoutAnswer,
  isRenderLeakContent,
  normalizeAssistantContent,
} from "./message-content.js";

describe("message-content rendering guards", () => {
  it("rejects React cleanup / return () => leaks", () => {
    assert.equal(isRenderLeakContent("return () => --"), true);
    assert.equal(isRenderLeakContent("return () =>"), true);
    assert.equal(isRenderLeakContent("return 0) --"), true);
    assert.equal(isRenderLeakContent("return 0)"), true);
    assert.equal(isRenderLeakContent("() => stopSpeaking()"), true);
    assert.equal(isRenderLeakContent(""), true);
    assert.equal(
      isRenderLeakContent("Virat Kohli is an Indian international cricketer."),
      false,
    );
  });

  it("rejects leaked planner / tool schema prompts", () => {
    const leak = `{"reasoning":"string","steps":[{"id":"s1","description":"...","toolName":"optional","successCriteria":"..."}]}
Use only listed tool names. Keep the plan short. Do not invent tools.
Goal: create we site for iron box company
WorkspaceId: 670642f3-3338-4b29-b676-f3a250fff2ef
Need: chat
Tools: get_current_time, search_memory`;
    assert.equal(isRenderLeakContent(leak), true);
    assert.equal(normalizeAssistantContent(leak), "");
  });

  it("strips return () => from assistant content", () => {
    const cleaned = normalizeAssistantContent("return () => --\n\nVirat Kohli is a cricketer.");
    assert.equal(/return\s*\(\)\s*=>/i.test(cleaned), false);
    assert.match(cleaned, /Virat Kohli/);
    const cleaned2 = normalizeAssistantContent("return 0) --");
    assert.equal(cleaned2, "");
  });

  it("detects sources-without-answer failure mode", () => {
    assert.equal(hasSourcesWithoutAnswer("return () => --", 3), true);
    assert.equal(hasSourcesWithoutAnswer("return 0) --", 3), true);
    assert.equal(hasSourcesWithoutAnswer("", 2), true);
    assert.equal(
      hasSourcesWithoutAnswer("Virat Kohli is an Indian international cricketer.", 3),
      false,
    );
  });
});
