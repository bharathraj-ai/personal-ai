import type { Evidence, VerificationCheck } from "@personal-ai/shared";

const TIME_SENSITIVE_RE =
  /\b(latest|today|tonight|current|currently|now|right now|this week|this month|live|breaking|as of|updated|score|scores|price|prices|weather|forecast|standings|who won|just happened|this morning|this evening)\b/i;

export function isTimeSensitiveQuery(text: string): boolean {
  return TIME_SENSITIVE_RE.test(text);
}

export interface FreshnessPolicy {
  maxAgeMs: number;
  label: string;
}

export function freshnessPolicyFor(query: string): FreshnessPolicy | undefined {
  if (!isTimeSensitiveQuery(query)) return undefined;
  const q = query.toLowerCase();
  if (/\b(this month)\b/.test(q)) {
    return { maxAgeMs: 31 * 24 * 60 * 60 * 1000, label: "this month" };
  }
  if (/\b(this week)\b/.test(q)) {
    return { maxAgeMs: 7 * 24 * 60 * 60 * 1000, label: "this week" };
  }
  if (/\b(latest|current|currently)\b/.test(q) && !/\b(today|now|live|score|weather|price)\b/.test(q)) {
    return { maxAgeMs: 7 * 24 * 60 * 60 * 1000, label: "latest/current" };
  }
  return { maxAgeMs: 24 * 60 * 60 * 1000, label: "today/now" };
}

function ageMs(date: Date, now: Date): number {
  return now.getTime() - date.getTime();
}

/**
 * Freshness uses publication/update time when present.
 * `retrievedAt` is when we fetched the page — it does not make stale content current.
 */
export function checkEvidenceFreshness(
  evidence: Evidence[],
  query: string,
  now: Date = new Date(),
): VerificationCheck {
  const policy = freshnessPolicyFor(query);
  if (!policy) {
    return {
      name: "freshness",
      passed: true,
      details: "Query is not time-sensitive; freshness not required",
    };
  }

  const dated = evidence.filter((e) => e.publishedAt instanceof Date && !Number.isNaN(e.publishedAt.getTime()));
  if (dated.length === 0) {
    return {
      name: "freshness",
      passed: false,
      details:
        `Time-sensitive query (${policy.label}) but no source publication/update date could be established`,
    };
  }

  const fresh = dated.filter((e) => ageMs(e.publishedAt!, now) <= policy.maxAgeMs);
  if (fresh.length === 0) {
    const newest = dated.reduce((a, b) =>
      a.publishedAt!.getTime() > b.publishedAt!.getTime() ? a : b,
    );
    return {
      name: "freshness",
      passed: false,
      details: `Newest dated source is ${newest.publishedAt!.toISOString()} which exceeds ${policy.label} window`,
    };
  }

  return {
    name: "freshness",
    passed: true,
    details: `${fresh.length}/${dated.length} dated sources are within the ${policy.label} window`,
  };
}
