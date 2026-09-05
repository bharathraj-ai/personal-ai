import type { VerificationCheck, VerificationResult, VerificationStatus } from "@personal-ai/shared";
import type { Evidence, ClaimCheck } from "@personal-ai/shared";

/** Confidence is passedChecks / totalChecks. Omitted when there are no checks. */
export function confidenceFromChecks(checks: VerificationCheck[]): number | undefined {
  if (checks.length === 0) return undefined;
  const passed = checks.filter((c) => c.passed).length;
  return passed / checks.length;
}

export function buildVerificationResult(input: {
  passed: boolean;
  criteria: string;
  details?: string;
  status: VerificationStatus;
  evidence?: Evidence[];
  checks?: VerificationCheck[];
  reason: string;
  claims?: ClaimCheck[];
}): VerificationResult {
  const checks = input.checks ?? [];
  return {
    passed: input.passed,
    criteria: input.criteria,
    details: input.details,
    status: input.status,
    evidence: input.evidence ?? [],
    checks,
    reason: input.reason,
    confidence: confidenceFromChecks(checks),
    claims: input.claims,
  };
}
