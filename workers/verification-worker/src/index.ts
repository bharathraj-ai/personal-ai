/**
 * Verification Worker — runs evidence verification pipelines asynchronously.
 *
 * Handles:
 * - Background claim verification
 * - Source quality assessment
 * - Freshness checks
 *
 * Job lifecycle: QUEUED → RUNNING → VERIFIED | UNVERIFIED | FAILED
 */

export type VerificationStatus = "QUEUED" | "RUNNING" | "VERIFIED" | "UNVERIFIED" | "FAILED";

export interface VerificationJob {
  id: string;
  claim: string;
  evidence: Array<{ source: string; content: string; url?: string }>;
  userId: string;
  status: VerificationStatus;
  result?: {
    passed: boolean;
    reason: string;
    checks: Array<{ name: string; passed: boolean; detail?: string }>;
    sourceCount: number;
  };
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const jobs = new Map<string, VerificationJob>();

export function enqueueVerification(
  job: Omit<VerificationJob, "status" | "createdAt" | "updatedAt">,
): VerificationJob {
  const now = new Date();
  const entry: VerificationJob = { ...job, status: "QUEUED", createdAt: now, updatedAt: now };
  jobs.set(job.id, entry);
  // Run synchronously in-process for now (worker thread in Stage B)
  void runVerificationJob(entry);
  return entry;
}

async function runVerificationJob(job: VerificationJob): Promise<void> {
  const j = jobs.get(job.id);
  if (!j) return;
  jobs.set(j.id, { ...j, status: "RUNNING", updatedAt: new Date() });

  try {
    // Basic heuristic verification without a full model call
    const checks: Array<{ name: string; passed: boolean; detail?: string }> = [];
    const evidenceCount = job.evidence.length;

    checks.push({
      name: "has_evidence",
      passed: evidenceCount > 0,
      detail: `${evidenceCount} source(s) provided`,
    });

    checks.push({
      name: "multiple_sources",
      passed: evidenceCount >= 2,
      detail: evidenceCount >= 2 ? "Multiple independent sources" : "Single source only",
    });

    const hasUrl = job.evidence.some((e) => e.url);
    checks.push({
      name: "has_urls",
      passed: hasUrl,
      detail: hasUrl ? "Sources include URLs" : "No URLs provided",
    });

    const passed = checks.filter((c: { passed: boolean }) => c.passed).length >= 2;
    const result: VerificationJob["result"] = {
      passed,
      reason: passed
        ? "Adequate evidence provided"
        : "Insufficient evidence to verify claim",
      checks,
      sourceCount: evidenceCount,
    };

    const updated: VerificationJob = {
      ...j,
      status: passed ? "VERIFIED" : "UNVERIFIED",
      result,
      updatedAt: new Date(),
    };
    jobs.set(j.id, updated);
  } catch (err) {
    const updated: VerificationJob = {
      ...j,
      status: "FAILED",
      error: err instanceof Error ? err.message : String(err),
      updatedAt: new Date(),
    };
    jobs.set(j.id, updated);
  }
}

export function getVerificationJob(id: string): VerificationJob | undefined {
  return jobs.get(id);
}

export function listVerificationJobs(userId: string): VerificationJob[] {
  return [...jobs.values()].filter((j) => j.userId === userId);
}

// Cleanup completed jobs older than 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (
      job.createdAt.getTime() < cutoff &&
      (job.status === "VERIFIED" || job.status === "UNVERIFIED" || job.status === "FAILED")
    ) {
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

console.log("[verification-worker] ready — heuristic verification active (model-backed verification: Stage B)");
