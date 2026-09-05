/**
 * Learning pipeline — §5
 * Information -> Security -> Quality -> Duplicate -> Approval -> Approved Knowledge
 * Secrets, passwords, unverified code, and raw scraped web never auto-enter.
 */

export interface LearningCandidate {
  content: string;
  source: "user_feedback" | "conversation" | "document" | "web";
  userId: string;
  metadata?: Record<string, string>;
}

export interface LearningPipelineResult {
  approved: boolean;
  rejectedAt?: "security" | "quality" | "duplicate" | "approval";
  reason?: string;
  sanitizedContent?: string;
}

const SECRET_PATTERNS = [
  /\b(sk-[a-zA-Z0-9]{20,})\b/,
  /\b(api[_-]?key\s*[:=]\s*["']?[\w-]{16,}["']?)/i,
  /\b(password\s*[:=]\s*["']?[^\s"']+["']?)/i,
  /\b(AKIA[0-9A-Z]{16})\b/,
  /\b(ghp_[a-zA-Z0-9]{36,})\b/,
];

const BLOCKED_SOURCES_FOR_AUTO = new Set(["web"]);

export class LearningPipeline {
  private readonly seenHashes = new Set<string>();

  /** Run full pipeline; returns approved content ready for memory/RAG. */
  async process(
    candidate: LearningCandidate,
    options: { autoApproveThreshold?: number; userApproved?: boolean } = {},
  ): Promise<LearningPipelineResult> {
    const security = this.securityFilter(candidate);
    if (!security.passed) {
      return { approved: false, rejectedAt: "security", reason: security.reason };
    }

    const quality = this.qualityFilter(candidate.content);
    if (!quality.passed) {
      return { approved: false, rejectedAt: "quality", reason: quality.reason };
    }

    const duplicate = this.duplicateFilter(candidate.content);
    if (!duplicate.passed) {
      return { approved: false, rejectedAt: "duplicate", reason: duplicate.reason };
    }

    if (BLOCKED_SOURCES_FOR_AUTO.has(candidate.source) && !options.userApproved) {
      return {
        approved: false,
        rejectedAt: "approval",
        reason: "Web content requires explicit user approval before entering memory",
      };
    }

    if (!options.userApproved && (options.autoApproveThreshold ?? 0.9) > 0.99) {
      return {
        approved: false,
        rejectedAt: "approval",
        reason: "Awaiting user approval or confidence threshold",
      };
    }

    if (!options.userApproved) {
      return {
        approved: false,
        rejectedAt: "approval",
        reason: "User approval required",
      };
    }

    return { approved: true, sanitizedContent: security.sanitized };
  }

  private securityFilter(candidate: LearningCandidate): { passed: boolean; reason?: string; sanitized?: string } {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(candidate.content)) {
        return { passed: false, reason: "Content contains secret-like patterns" };
      }
    }

    let sanitized = candidate.content;
    for (const pattern of SECRET_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED]");
    }

    return { passed: true, sanitized };
  }

  private qualityFilter(content: string): { passed: boolean; reason?: string } {
    if (content.trim().length < 10) {
      return { passed: false, reason: "Content too short to be useful knowledge" };
    }
    if (content.length > 50_000) {
      return { passed: false, reason: "Content exceeds maximum size for memory ingestion" };
    }
    return { passed: true };
  }

  private duplicateFilter(content: string): { passed: boolean; reason?: string } {
    const hash = simpleHash(content.trim().toLowerCase());
    if (this.seenHashes.has(hash)) {
      return { passed: false, reason: "Duplicate content already ingested" };
    }
    this.seenHashes.add(hash);
    return { passed: true };
  }
}

function simpleHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return String(h);
}
