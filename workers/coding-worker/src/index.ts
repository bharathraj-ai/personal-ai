/**
 * Coding Worker — executes long-running coding tasks off the request path.
 * Polls a job queue (in-memory for now; Redis-backed in Stage B production).
 * 
 * Job lifecycle:
 *   QUEUED → RUNNING → COMPLETED | FAILED
 *
 * The API gateway posts jobs here; clients poll GET /workspaces/:id/status
 * to check progress.
 */

export interface CodingJob {
  id: string;
  workspaceId: string;
  goal: string;
  userId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  result?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const jobs = new Map<string, CodingJob>();

export function enqueueJob(job: Omit<CodingJob, "status" | "createdAt" | "updatedAt">): CodingJob {
  const now = new Date();
  const entry: CodingJob = { ...job, status: "QUEUED", createdAt: now, updatedAt: now };
  jobs.set(job.id, entry);
  return entry;
}

export function getJob(id: string): CodingJob | undefined {
  return jobs.get(id);
}

export function listJobs(userId: string): CodingJob[] {
  return [...jobs.values()].filter((j) => j.userId === userId);
}

export function updateJob(id: string, update: Partial<CodingJob>): CodingJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  const updated = { ...job, ...update, updatedAt: new Date() };
  jobs.set(id, updated);
  return updated;
}

// Heartbeat log — confirms worker is alive
const HEARTBEAT_MS = 30_000;
setInterval(() => {
  const pending = [...jobs.values()].filter((j) => j.status === "QUEUED" || j.status === "RUNNING").length;
  if (pending > 0) {
    console.log(`[coding-worker] ${new Date().toISOString()} — ${pending} job(s) pending/running`);
  }
}, HEARTBEAT_MS);

console.log("[coding-worker] ready — in-memory job queue active (Redis upgrade: Stage B)");
