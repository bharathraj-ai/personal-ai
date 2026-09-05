import type { RequestScale } from "@personal-ai/shared";
import type { CodeVerificationReport } from "./verification-pipeline.js";

/**
 * FULL_APPLICATION / MVP must not treat NO_TESTS or UNCERTAIN as success.
 * Build passed ≠ application verified.
 */
export function isStrictCodingSuccess(
  report: CodeVerificationReport | undefined,
  scale?: RequestScale,
  opts?: { requireRealTests?: boolean },
): boolean {
  if (!report || report.status === "FAILED") return false;
  const strict =
    scale === "FULL_APPLICATION" ||
    scale === "LARGE_SYSTEM" ||
    scale === "MVP" ||
    Boolean(opts?.requireRealTests);
  if (strict) {
    return report.build !== "FAILED" && report.tests === "PASSED";
  }
  return (
    report.status === "VERIFIED" ||
    (report.status === "UNCERTAIN" && report.build !== "FAILED" && report.tests === "PASSED")
  );
}
