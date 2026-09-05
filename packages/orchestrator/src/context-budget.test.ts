import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { budgetPlanningUserContent, contextTokenBudget } from "./context-budget.js";

describe("context budget", () => {
  it("keeps Bharath planning payload under the 1024-token char budget", () => {
    assert.equal(contextTokenBudget("bharath-ai"), 1024);
    const text = budgetPlanningUserContent({
      goal: "Create hello.py that prints Hello World.",
      workspaceId: "abc",
      needSummary: "coding",
      toolNames: Array.from({ length: 40 }, (_, i) => `tool_${i}`),
      history: [
        { role: "user", content: "x".repeat(5000) },
        { role: "assistant", content: "y".repeat(5000) },
      ],
      providerId: "bharath-ai",
    });
    assert.ok(text.length < 3200);
    assert.match(text, /Create hello\.py/);
    assert.doesNotMatch(text, /tool_39/);
  });
});
