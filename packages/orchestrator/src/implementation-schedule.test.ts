import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { schoolManagementProjectPlan } from "./project-plan.js";
import {
  buildImplementationSchedule,
  chunkManifestFiles,
  remainingSchedule,
} from "./implementation-schedule.js";

describe("implementation schedule", () => {
  it("orders in-scope school modules from phases without inventing extra names", () => {
    const plan = schoolManagementProjectPlan(1);
    const schedule = buildImplementationSchedule(plan);
    assert.ok(schedule.length >= 5);
    assert.equal(schedule[0]?.id, "MODULE-AUTH");
    assert.ok(schedule.every((m) => plan.modules.some((p) => p.id === m.id)));
    assert.ok(!schedule.some((m) => m.id === "MODULE-EXAM"));
  });

  it("chunks files to at most 2 per call by default", () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      path: `f${i}.ts`,
      purpose: "x",
      module: "MODULE-A",
    }));
    const chunks = chunkManifestFiles(files);
    assert.ok(chunks.every((c) => c.length <= 2));
    assert.equal(chunks.length, 3);
  });

  it("includes auth bootstrap files from the school plan, not a template dump", () => {
    const plan = schoolManagementProjectPlan(1);
    const schedule = buildImplementationSchedule(plan);
    const auth = schedule.find((m) => m.id === "MODULE-AUTH");
    const roles = schedule.find((m) => m.id === "MODULE-ROLES");
    assert.ok(auth?.fileHints.includes("src/auth.js"));
    assert.ok(auth?.fileHints.includes("package.json"));
    assert.ok(roles?.fileHints.includes("src/rbac.js"));
  });

  it("resume skips completed modules", () => {
    const plan = schoolManagementProjectPlan(1);
    const schedule = buildImplementationSchedule(plan);
    const rest = remainingSchedule(schedule, [schedule[0]!.id]);
    assert.equal(rest[0]?.id, schedule[1]?.id);
  });
});
