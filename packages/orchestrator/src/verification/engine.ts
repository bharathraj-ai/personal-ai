import type {
  Evidence,
  PlanStep,
  StepObservation,
  ToolResult,
  VerificationCheck,
  VerificationResult,
} from "@personal-ai/shared";
import { checkClaimsAgainstEvidence, extractFactualClaims } from "./claims.js";
import {
  createEvidence,
  hasAdequateEvidence,
  hasFetchedPageEvidence,
  hasUsableContent,
  isSnippetOnly,
} from "./evidence.js";
import { checkEvidenceFreshness, isTimeSensitiveQuery } from "./freshness.js";
import { evidenceFromToolResult } from "./from-tools.js";
import { buildVerificationResult } from "./result.js";

export const UNVERIFIED_NOTICE =
  "I couldn't verify this information from the available sources.";

export interface VerifyAnswerInput {
  question: string;
  draftAnswer?: string;
  evidence: Evidence[];
  evidenceRequired: boolean;
  timeSensitive?: boolean;
}

export interface CodePipelineStep {
  name: string;
  passed: boolean;
  details?: string;
  /** Honest outcome when available (NO_TESTS ≠ PASSED). */
  outcome?: string;
}

export interface VerifyCodeInput {
  steps: CodePipelineStep[];
  passed?: boolean;
  criteria?: string;
  /** Structured report from VerificationPipeline when available. */
  report?: {
    status: "VERIFIED" | "UNCERTAIN" | "FAILED" | "NOT_VERIFIED";
    build?: string;
    tests?: string;
    runtime?: string;
    security?: string;
    attempts?: number;
    modelQuality?: string;
  };
}

/**
 * Central verification engine.
 * Never invents confidence; never treats source quality as proof of a claim.
 */
export class VerificationEngine {
  verifyToolResult(step: PlanStep, observation: StepObservation): VerificationResult {
    const output = observation.output as ToolResult | string;
    const evidence = typeof output === "object" && output !== null
      ? evidenceFromToolResult(step.toolName ?? "model", output, observation.timestamp)
      : [];

    if (typeof output === "object" && output !== null && "success" in output) {
      const ok = output.success === true;
      const checks: VerificationCheck[] = [
        {
          name: "tool_success",
          passed: ok,
          details: ok ? `${step.toolName ?? "tool"} succeeded` : output.error ?? "Tool failed",
        },
      ];
      if (step.toolName === "search_web") {
        const hasHits = evidence.some(hasUsableContent);
        checks.push({
          name: "search_results",
          passed: hasHits,
          details: hasHits ? `Retrieved ${evidence.length} search hits` : "Search returned no usable results",
        });
      }
      if (step.toolName === "run_tests" || step.toolName === "run_build") {
        const meta = evidence[0]?.metadata as { exitCode?: number; timedOut?: boolean } | undefined;
        checks.push({
          name: "exit_code",
          passed: ok && meta?.exitCode === 0 && !meta.timedOut,
          details: meta?.timedOut ? "Timed out" : `exitCode=${meta?.exitCode ?? (ok ? 0 : 1)}`,
        });
      }
      return buildVerificationResult({
        passed: ok,
        criteria: step.successCriteria,
        details: output.error,
        // Tool success ≠ claim verified
        status: ok ? "not_verified" : "failed",
        evidence,
        checks,
        reason: ok
          ? `TOOL_SUCCEEDED (${step.toolName ?? "tool"}) — not CLAIM_VERIFIED`
          : output.error ?? "Tool failed",
      });
    }

    if (typeof output === "string" && output.length > 0) {
      return buildVerificationResult({
        passed: true,
        criteria: step.successCriteria,
        details: "Model response received",
        status: "uncertain",
        evidence,
        checks: [
          {
            name: "model_output",
            passed: true,
            details: "A model response is not evidence that claims are true",
          },
        ],
        reason: "Model-only step: output received but not evidence-grounded",
      });
    }

    return buildVerificationResult({
      passed: false,
      criteria: step.successCriteria,
      details: "Empty observation",
      status: "failed",
      evidence,
      checks: [{ name: "observation", passed: false, details: "No output" }],
      reason: "Step produced no observable output",
    });
  }

  verifyWebEvidence(input: VerifyAnswerInput): VerificationResult {
    const web = input.evidence.filter((e) => e.type === "web");
    const checks: VerificationCheck[] = [];

    const hasResults = web.some(hasUsableContent);
    checks.push({
      name: "web_results",
      passed: hasResults,
      details: hasResults ? `${web.filter(hasUsableContent).length} web evidence items` : "No usable web evidence",
    });

    const fetched = hasFetchedPageEvidence(web);
    const snippetOnly = web.length > 0 && web.every(isSnippetOnly);
    checks.push({
      name: "page_fetch",
      passed: fetched,
      details: fetched
        ? "At least one full page was retrieved"
        : snippetOnly
          ? "Only search snippets were available; page content was not retrieved"
          : "No page content retrieved",
    });

    const timeSensitive = input.timeSensitive ?? isTimeSensitiveQuery(input.question);
    if (timeSensitive) {
      checks.push(checkEvidenceFreshness(web, input.question));
    }

    const status = !hasResults
      ? "failed"
      : fetched && checks.every((c) => c.passed)
        ? "verified"
        : "uncertain";

    return buildVerificationResult({
      passed: status !== "failed",
      criteria: "Web evidence supports answering the question",
      status,
      evidence: web,
      checks,
      reason:
        status === "verified"
          ? "Web pages were retrieved and freshness checks passed"
          : status === "failed"
            ? UNVERIFIED_NOTICE
            : "Web evidence is incomplete (snippets, missing dates, or failed freshness)",
    });
  }

  verifyRagEvidence(evidence: Evidence[], query: string): VerificationResult {
    const docs = evidence.filter((e) => e.type === "document" || e.type === "memory");
    const usable = docs.filter(hasUsableContent);
    const checks: VerificationCheck[] = [
      {
        name: "rag_hits",
        passed: usable.length > 0,
        details: usable.length > 0 ? `${usable.length} memory/document chunks` : "No RAG/memory hits",
      },
    ];
    return buildVerificationResult({
      passed: usable.length > 0,
      criteria: `RAG/memory evidence for: ${query}`,
      status: usable.length > 0 ? "verified" : "failed",
      evidence: docs,
      checks,
      reason:
        usable.length > 0
          ? "Retrieved personal memory or document chunks"
          : "No matching memory or document evidence",
    });
  }

  verifyGeneratedCode(input: VerifyCodeInput): VerificationResult {
    const checks: VerificationCheck[] = input.steps.map((s) => {
      const outcome = s.outcome ?? (s.passed ? "PASSED" : "FAILED");
      // NO_TESTS / NOT_IMPLEMENTED must not count as a green "passed" claim
      const claimPassed =
        outcome === "PASSED" ||
        outcome === "SKIPPED" ||
        outcome === "NO_TESTS" ||
        outcome === "TEST_NOT_CONFIGURED" ||
        outcome === "NOT_IMPLEMENTED" ||
        outcome === "NOT_RUN";
      const criticalFail = outcome === "FAILED" || outcome === "TEST_ERROR";
      return {
        name: s.name,
        passed: !criticalFail && (s.passed || claimPassed),
        details: s.details ? `${outcome}: ${s.details}` : outcome,
      };
    });

    const reportStatus = input.report?.status;
    let status: VerificationResult["status"];
    if (reportStatus === "VERIFIED") status = "verified";
    else if (reportStatus === "FAILED") status = "failed";
    else if (reportStatus === "UNCERTAIN") status = "uncertain";
    else if (reportStatus === "NOT_VERIFIED") status = "not_verified";
    else {
      const hardFail = input.steps.some(
        (s) => s.outcome === "FAILED" || s.outcome === "TEST_ERROR" || (!s.passed && !s.outcome),
      );
      const noTests = input.steps.some(
        (s) => s.outcome === "NO_TESTS" || s.outcome === "TEST_NOT_CONFIGURED",
      );
      if (hardFail) status = "failed";
      else if (noTests) status = "uncertain";
      else if (input.passed ?? checks.every((c) => c.passed)) status = "verified";
      else status = "not_verified";
    }

    const evidence: Evidence[] = input.steps.map((s) =>
      createEvidence({
        type: "code-test",
        source: s.name,
        title: s.name,
        content: s.details ?? s.outcome ?? (s.passed ? "passed" : "failed"),
        metadata: {
          passed: s.passed,
          outcome: s.outcome,
          report: input.report,
        },
      }),
    );

    const modelNote =
      input.report?.modelQuality === "MODEL_QUALITY_NOT_VERIFIED"
        ? " MODEL_QUALITY_NOT_VERIFIED — execution success ≠ scientific correctness."
        : "";

    return buildVerificationResult({
      passed: status === "verified" || status === "uncertain",
      criteria: input.criteria ?? "Generated code builds and tests (honest outcomes)",
      status,
      evidence,
      checks,
      reason:
        (status === "verified"
          ? "BUILD/TESTS verified via workspace pipeline"
          : status === "uncertain"
            ? "Code checks incomplete (e.g. NO_TESTS) — not fully verified"
            : status === "failed"
              ? `Failed checks: ${checks.filter((c) => !c.passed).map((c) => c.name).join(", ") || "unknown"}`
              : "Code generation success ≠ verification") + modelNote,
    });
  }

  /**
   * Claim-to-evidence check on a draft answer (or on the question when there is no draft).
   */
  verifyFactualClaims(input: VerifyAnswerInput): VerificationResult {
    const timeSensitive = input.timeSensitive ?? isTimeSensitiveQuery(input.question);
    const checks: VerificationCheck[] = [];
    const adequate = hasAdequateEvidence(input.evidence);

    checks.push({
      name: "evidence_present",
      passed: adequate,
      details: adequate
        ? `${input.evidence.filter(hasUsableContent).length} usable evidence items`
        : "No adequate evidence retrieved",
    });

    if (input.evidence.some((e) => e.type === "web")) {
      const fetched = hasFetchedPageEvidence(input.evidence);
      checks.push({
        name: "page_content",
        passed: fetched || !input.evidenceRequired,
        details: fetched
          ? "Full page content retrieved for at least one source"
          : "Relied on search snippets because page fetch was unavailable",
      });
    }

    if (timeSensitive) {
      checks.push(checkEvidenceFreshness(input.evidence, input.question));
    }

    const claims = input.draftAnswer
      ? extractFactualClaims(input.draftAnswer)
      : [];
    const claimChecks = claims.length
      ? checkClaimsAgainstEvidence(claims, input.evidence)
      : [];

    if (input.draftAnswer && claims.length > 0) {
      const supported = claimChecks.filter((c) => c.supported).length;
      checks.push({
        name: "claim_support",
        passed: supported === claims.length,
        details: `${supported}/${claims.length} important claims have supporting evidence`,
      });
    } else if (input.evidenceRequired && input.draftAnswer) {
      checks.push({
        name: "claim_support",
        passed: adequate,
        details: "No extractable factual claims; evidence presence used instead",
      });
    }

    const failedRequired = input.evidenceRequired && !adequate;
    const claimsUnsupported = claimChecks.some((c) => !c.supported);
    const checksFailed = checks.some((c) => !c.passed);

    let status: VerificationResult["status"];
    let reason: string;

    if (failedRequired) {
      status = "failed";
      reason = UNVERIFIED_NOTICE;
    } else if (claimsUnsupported || checksFailed) {
      status = "uncertain";
      reason = claimsUnsupported
        ? "One or more important claims are not supported by retrieved evidence"
        : checks.find((c) => !c.passed)?.details ?? "Evidence is incomplete";
    } else if (input.evidenceRequired || claims.length > 0) {
      status = "verified";
      reason = "Important claims are supported by retrieved evidence";
    } else {
      status = "uncertain";
      reason = "No external evidence was required or retrieved; claims were not independently verified";
    }

    return buildVerificationResult({
      passed: status === "verified",
      criteria: "Important factual claims are supported by evidence",
      details: reason,
      status,
      evidence: input.evidence,
      checks,
      reason,
      claims: claimChecks,
    });
  }

  isSufficientlySupported(result: VerificationResult): boolean {
    return result.status === "verified" && result.checks.length > 0 && result.checks.every((c) => c.passed);
  }
}
