import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateCompleteness, orchestratorStatusFor } from "./completeness-guard.js";
import { schoolManagementProjectPlan } from "./project-plan.js";
import { classifyRequest } from "./request-classification.js";

describe("CompletenessGuard", () => {
  it("marks SMALL_TASK complete when a real source file exists", () => {
    const plan = schoolManagementProjectPlan(1);
    const report = evaluateCompleteness({
      classification: "SMALL_TASK",
      plan,
      files: ["hello.py"],
      testsPassed: 1,
      testsTotal: 1,
      verificationPassed: 1,
      verificationTotal: 1,
      runtimeOk: true,
    });
    assert.equal(report.status, "COMPLETE");
  });

  it("blocks COMPLETE when FULL_APPLICATION has only one page", () => {
    const plan = schoolManagementProjectPlan(1);
    const report = evaluateCompleteness({
      classification: "FULL_APPLICATION",
      plan,
      files: ["app/page.tsx", "README.md"],
      testsPassed: 1,
      testsTotal: 1,
      verificationPassed: 1,
      verificationTotal: 1,
      runtimeOk: true,
    });
    assert.equal(report.status, "PROJECT_INCOMPLETE");
    assert.equal(report.singlePageDemo, true);
    assert.equal(orchestratorStatusFor(report), "partial");
    assert.equal(
      orchestratorStatusFor({ ...report, status: "WAITING_FOR_PROVIDER" }),
      "waiting_provider",
    );
    assert.doesNotMatch(report.reason, /Project completed/i);
  });

  it("reports PARTIAL for a real Phase 1 multi-page school app", () => {
    const plan = schoolManagementProjectPlan(1);
    const files = [
      "public/login.html",
      "public/dashboard.html",
      "public/students.html",
      "public/student-profile.html",
      "public/student-form.html",
      "public/teachers.html",
      "public/teacher-profile.html",
      "public/teacher-form.html",
      "public/attendance.html",
      "public/attendance-mark.html",
      "public/classes.html",
      "src/routes.js",
      "src/store.js",
      "src/auth.js",
      "src/rbac.js",
      "src/server.js",
      "test/rbac.test.js",
      "test/attendance.test.js",
      "schema/schema.sql",
    ];
    const report = evaluateCompleteness({
      classification: classifyRequest("Create a complete school management system."),
      plan,
      files,
      testsPassed: 5,
      testsTotal: 5,
      verificationPassed: 5,
      verificationTotal: 5,
      runtimeOk: true,
    });
    assert.notEqual(report.status, "COMPLETE");
    assert.notEqual(report.status, "PROJECT_INCOMPLETE");
    assert.equal(report.status, "PARTIAL");
    assert.equal(report.singlePageDemo, false);
    assert.ok(report.counts.pages.completed >= 3);
  });

  it("rejects UI-only FULL_APPLICATION missing auth and persistence", () => {
    const plan = schoolManagementProjectPlan(1);
    const report = evaluateCompleteness({
      classification: "FULL_APPLICATION",
      plan,
      files: [
        "public/login.html",
        "public/dashboard.html",
        "public/students.html",
        "src/app.js",
      ],
      testsPassed: 0,
      testsTotal: 0,
      verificationPassed: 0,
      verificationTotal: 1,
      runtimeOk: true,
    });
    assert.equal(report.status, "PROJECT_INCOMPLETE");
    assert.ok(report.incompleteFeatures.some((f) => /persist/i.test(f)));
  });
});
