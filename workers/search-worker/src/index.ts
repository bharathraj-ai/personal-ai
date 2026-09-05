/**
 * Search Worker — handles asynchronous web search jobs off the request path.
 * 
 * Supports:
 * - Queued web searches (DuckDuckGo / Brave / Tavily)
 * - Evidence collection
 * - Result caching (TTL: 5 minutes)
 *
 * Job lifecycle: QUEUED → RUNNING → COMPLETED | FAILED
 */

export interface SearchJob {
  id: string;
  query: string;
  userId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  results?: Array<{ title: string; url: string; snippet: string }>;
  answer?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  /** Cache key — identical queries share results within TTL */
  cacheKey: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const jobs = new Map<string, SearchJob>();
const cache = new Map<string, { result: Pick<SearchJob, "results" | "answer">; expiresAt: number }>();

export function enqueueSearch(
  job: Omit<SearchJob, "status" | "createdAt" | "updatedAt" | "cacheKey">,
): SearchJob {
  const cacheKey = `search:${job.query.toLowerCase().trim()}`;

  // Return cached result if available
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const now = new Date();
    const entry: SearchJob = {
      ...job,
      cacheKey,
      status: "COMPLETED",
      results: cached.result.results,
      answer: cached.result.answer,
      createdAt: now,
      updatedAt: now,
    };
    jobs.set(job.id, entry);
    return entry;
  }

  const now = new Date();
  const entry: SearchJob = { ...job, cacheKey, status: "QUEUED", createdAt: now, updatedAt: now };
  jobs.set(job.id, entry);
  return entry;
}

export function getSearchJob(id: string): SearchJob | undefined {
  return jobs.get(id);
}

export function listSearchJobs(userId: string): SearchJob[] {
  return [...jobs.values()].filter((j) => j.userId === userId);
}

export function completeSearch(
  id: string,
  result: Pick<SearchJob, "results" | "answer">,
): SearchJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  const updated: SearchJob = { ...job, ...result, status: "COMPLETED", updatedAt: new Date() };
  jobs.set(id, updated);
  // Cache the result
  cache.set(job.cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return updated;
}

export function failSearch(id: string, error: string): SearchJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  const updated: SearchJob = { ...job, error, status: "FAILED", updatedAt: new Date() };
  jobs.set(id, updated);
  return updated;
}

// Cleanup stale jobs older than 1 hour
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt.getTime() < cutoff && (job.status === "COMPLETED" || job.status === "FAILED")) {
      jobs.delete(id);
    }
  }
  // Cleanup expired cache entries
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt < Date.now()) cache.delete(key);
  }
}, 10 * 60 * 1000);

console.log("[search-worker] ready — in-memory queue with 5-min result cache active");
