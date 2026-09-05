import type { SourceQuality } from "@personal-ai/shared";

/**
 * Domain-based source classification.
 * A higher rank is only a retrieval preference — not proof the content supports a claim.
 */

const GOVERNMENT_HOST_RE =
  /(^|\.)(gov|mil|gov\.uk|gov\.in|gov\.au|gov\.nz|europa\.eu|who\.int|un\.org|nih\.gov|cdc\.gov|nasa\.gov|data\.gov)$/i;

const OFFICIAL_DOCS_HOSTS = new Set([
  "docs.python.org",
  "docs.oracle.com",
  "docs.github.com",
  "docs.microsoft.com",
  "learn.microsoft.com",
  "developer.mozilla.org",
  "developer.apple.com",
  "nodejs.org",
  "kubernetes.io",
  "react.dev",
  "nextjs.org",
  "www.w3.org",
  "www.ietf.org",
  "datatracker.ietf.org",
  "www.iso.org",
  "www.rfc-editor.org",
  "go.dev",
  "doc.rust-lang.org",
  "www.postgresql.org",
  "www.typescriptlang.org",
]);

const RESEARCH_HOSTS = new Set([
  "arxiv.org",
  "export.arxiv.org",
  "pubmed.ncbi.nlm.nih.gov",
  "www.ncbi.nlm.nih.gov",
  "www.nature.com",
  "www.science.org",
  "www.cell.com",
  "journals.plos.org",
  "www.pnas.org",
  "dl.acm.org",
  "ieeexplore.ieee.org",
  "www.biorxiv.org",
  "www.medrxiv.org",
]);

const REPUTABLE_SECONDARY_HOSTS = new Set([
  "en.wikipedia.org",
  "www.wikipedia.org",
  "wikipedia.org",
  "www.reuters.com",
  "apnews.com",
  "www.apnews.com",
  "www.bbc.com",
  "www.bbc.co.uk",
  "www.npr.org",
  "www.theguardian.com",
  "www.nytimes.com",
  "www.wsj.com",
  "www.economist.com",
  "www.espn.com",
  "www.espncricinfo.com",
  "www.cricbuzz.com",
  "www.skysports.com",
  "www.weather.gov",
  "www.imdb.com",
  "imdb.com",
  "www.britannica.com",
]);

const QUALITY_RANK: Record<SourceQuality, number> = {
  official_primary: 0,
  government_official: 1,
  original_research: 2,
  reputable_secondary: 3,
  other: 4,
  unknown: 5,
};

export function hostnameOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function hostMatchesGov(host: string): boolean {
  if (GOVERNMENT_HOST_RE.test(host)) return true;
  if (host.endsWith(".gov") || host.endsWith(".mil")) return true;
  if (host.endsWith(".gov.uk") || host.endsWith(".gov.in") || host.endsWith(".gov.au")) {
    return true;
  }
  return (
    host === "who.int" ||
    host.endsWith(".who.int") ||
    host === "un.org" ||
    host.endsWith(".un.org") ||
    host === "europa.eu" ||
    host.endsWith(".europa.eu")
  );
}

function inHostSet(host: string, set: Set<string>): boolean {
  if (set.has(host) || set.has(`www.${host}`)) return true;
  for (const candidate of set) {
    const c = candidate.replace(/^www\./, "");
    if (host === c || host.endsWith(`.${c}`)) return true;
  }
  return false;
}

/**
 * Classify a URL/host. Returns `unknown` when there is no URL.
 * Does not label a source "authoritative" — only records a retrieval-preference class.
 */
export function classifySourceQuality(url?: string, extraHost?: string): SourceQuality {
  const host = hostnameOf(url) ?? extraHost?.toLowerCase().replace(/^www\./, "");
  if (!host) return "unknown";

  if (hostMatchesGov(host)) return "government_official";
  if (inHostSet(host, OFFICIAL_DOCS_HOSTS) || host.endsWith(".edu")) {
    // .edu pages are often original research or official university docs.
    if (host.endsWith(".edu")) return "original_research";
    return "official_primary";
  }
  if (inHostSet(host, RESEARCH_HOSTS)) return "original_research";
  if (inHostSet(host, REPUTABLE_SECONDARY_HOSTS)) return "reputable_secondary";
  return "other";
}

export function sourceQualityRank(quality: SourceQuality): number {
  return QUALITY_RANK[quality];
}

export function compareSourceQuality(a: SourceQuality, b: SourceQuality): number {
  return sourceQualityRank(a) - sourceQualityRank(b);
}
