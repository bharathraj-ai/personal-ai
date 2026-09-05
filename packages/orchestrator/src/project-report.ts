import type { CompletenessReport, ProjectPlan, RequestScale } from "@personal-ai/shared";

export function formatProjectCompletionReport(input: {
  plan: ProjectPlan;
  report: CompletenessReport;
  workspaceId?: string;
  runtimeOk: boolean;
  testsOk: boolean;
  extraNotes?: string[];
}): string {
  const { plan, report } = input;
  const c = report.counts;
  const lines = [
    `PROJECT STATUS`,
    "",
    `Project: ${plan.project.name}`,
    "",
    `Status: ${report.status}`,
    "",
    `Requirements: ${c.requirements.requested} total`,
    `  Implemented: ${c.requirements.implemented}`,
    `  Tested: ${c.requirements.tested}`,
    `  Verified: ${c.requirements.verified}`,
    ...(c.requirements.failed != null
      ? [`  Failed: ${c.requirements.failed}`]
      : []),
    ...(c.requirements.blocked != null && c.requirements.blocked > 0
      ? [`  Blocked/deferred: ${c.requirements.blocked}`]
      : []),
    "",
    `Modules: ${c.modules.completed}/${c.modules.total}`,
    `Pages: ${c.pages.completed}/${c.pages.total}`,
    `APIs: ${c.apis.completed}/${c.apis.total}`,
    `Build: ${input.testsOk && input.runtimeOk ? "PASS" : input.runtimeOk ? "PARTIAL" : "FAIL"}`,
    `Tests: ${c.tests.passed}/${c.tests.total}`,
    `Verification: ${c.verification.verified}/${c.verification.total} (${report.status})`,
    "",
    `Storage: ${report.storage.length ? report.storage.join(" / ") : "S3 (or configured StorageService) — workspace is temporary"}`,
    "",
    report.reason,
  ];

  if (input.workspaceId) {
    lines.push("", `Workspace: ${input.workspaceId}`);
  }

  if (report.incompleteFeatures.length) {
    lines.push("", "Incomplete / deferred features:");
    for (const f of report.incompleteFeatures.slice(0, 20)) {
      lines.push(`- ${f}`);
    }
  }

  if (report.knownLimitations.length) {
    lines.push("", "Known limitations:");
    for (const l of report.knownLimitations) {
      lines.push(`- ${l}`);
    }
  }

  if (input.extraNotes?.length) {
    lines.push("", ...input.extraNotes);
  }

  lines.push(
    "",
    `Runtime: ${input.runtimeOk ? "CODE_EXECUTION_SUCCESS" : "CODE_EXECUTION_FAILED"}.`,
    `Tests: ${input.testsOk ? "TESTS_PASSED" : "TESTS_FAILED_OR_PARTIAL"}.`,
    "",
    "A successful website build is not equivalent to a successful project.",
  );

  if (report.status !== "COMPLETE") {
    lines.push("Do not treat this as a fully completed application.");
  }

  return lines.join("\n");
}

export function formatClassificationNote(scale: RequestScale): string {
  return `Request classified as ${scale} before implementation.`;
}
