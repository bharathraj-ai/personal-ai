import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateRequirementEvidence } from "./requirement-evidence.js";

describe("requirement evidence", () => {
  it("never marks VERIFIED without tests", () => {
    const rows = evaluateRequirementEvidence({
      requirements: [
        {
          id: "r1",
          kind: "requirement",
          name: "Create student",
          status: "in_scope",
        },
      ],
      files: ["app/students/page.tsx", "app/api/students/route.ts", "lib/store.ts"],
      testsPassed: false,
      buildPassed: true,
    });
    assert.equal(rows[0].status, "NOT_TESTED");
  });

  it("marks PARTIAL for hardcoded production arrays", () => {
    const rows = evaluateRequirementEvidence({
      requirements: [
        {
          id: "r1",
          kind: "requirement",
          name: "CRUD student records with database persistence",
          status: "in_scope",
        },
      ],
      files: ["app/students/page.tsx", "lib/data.ts"],
      contents: { "lib/data.ts": "const students = [{ id: 1 }];" },
      testsPassed: true,
      buildPassed: true,
    });
    assert.equal(rows[0].status, "PARTIAL");
  });

  it("marks REST API acceptance goal VERIFIED when tests pass", () => {
    const rows = evaluateRequirementEvidence({
      requirements: [
        {
          id: "REQ-CORE",
          kind: "requirement",
          name: "Create a small REST API with one endpoint and a real automated test.",
          status: "in_scope",
        },
      ],
      files: ["app.js", "app.test.js", "package.json"],
      testsPassed: true,
      buildPassed: true,
    });
    assert.equal(rows[0].status, "VERIFIED");
  });
});
