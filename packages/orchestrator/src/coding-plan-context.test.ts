import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatPlanSummaryForCoding } from "./coding-plan-context.js";
import { schoolManagementProjectPlan } from "./project-plan.js";

describe("formatPlanSummaryForCoding", () => {
  it("includes requirements and modules from project plan", () => {
    const plan = schoolManagementProjectPlan(1);
    const summary = formatPlanSummaryForCoding(plan, {
      objective: "School management system",
      architecture: "Next.js + TypeScript",
      components: ["Auth", "Students"],
      scope: "FULL_APPLICATION",
    });
    assert.match(summary, /School management system/);
    assert.match(summary, /Requirements/);
    assert.match(summary, /Modules/);
    assert.match(summary, /Next\.js/);
  });
});
