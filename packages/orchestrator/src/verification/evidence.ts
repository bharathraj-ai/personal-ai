import type { Evidence, EvidenceType, SourceQuality } from "@personal-ai/shared";
import { redactSecrets } from "./secrets.js";
import { classifySourceQuality } from "./source-quality.js";

const MAX_CONTENT = 4000;

export interface CreateEvidenceInput {
  type: EvidenceType;
  source: string;
  title?: string;
  url?: string;
  content: string;
  retrievedAt?: Date;
  publishedAt?: Date | string;
  sourceQuality?: SourceQuality;
  metadata?: Record<string, unknown>;
}

function parseDate(value: Date | string | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function createEvidence(input: CreateEvidenceInput): Evidence {
  const content = redactSecrets(input.content).slice(0, MAX_CONTENT);
  const truncated = redactSecrets(input.content).length > MAX_CONTENT;
  const publishedAt = parseDate(input.publishedAt);
  const quality = input.sourceQuality ?? classifySourceQuality(input.url);

  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  if (truncated) metadata.truncated = true;

  return {
    id: crypto.randomUUID(),
    type: input.type,
    source: input.source,
    title: input.title ? redactSecrets(input.title).slice(0, 240) : undefined,
    url: input.url,
    content,
    retrievedAt: input.retrievedAt ?? new Date(),
    sourceQuality: quality,
    publishedAt,
    metadata: Object.keys(metadata).length ? metadata : undefined,
  };
}

export function hasUsableContent(evidence: Evidence): boolean {
  return evidence.content.trim().length >= 40;
}

export function isSnippetOnly(evidence: Evidence): boolean {
  return evidence.metadata?.snippetOnly === true;
}

export function hasAdequateEvidence(evidence: Evidence[]): boolean {
  return evidence.some(hasUsableContent);
}

export function hasFetchedPageEvidence(evidence: Evidence[]): boolean {
  return evidence.some((e) => e.type === "web" && hasUsableContent(e) && !isSnippetOnly(e));
}
