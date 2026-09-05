import type { ClaimCheck, Evidence } from "@personal-ai/shared";

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "so", "of", "in", "on", "at", "to",
  "for", "from", "by", "with", "as", "is", "are", "was", "were", "be", "been", "being",
  "it", "its", "this", "that", "these", "those", "i", "we", "you", "they", "he", "she",
  "have", "has", "had", "do", "does", "did", "not", "no", "yes", "can", "could", "would",
  "should", "will", "may", "might", "about", "into", "over", "after", "before", "than",
  "also", "just", "more", "most", "some", "any", "all", "there", "here", "when", "what",
  "which", "who", "whom", "how", "why",
]);

const UNVERIFIED_MARKERS =
  /couldn't verify|could not verify|cannot verify|can't verify|insufficient evidence|not verified|unverified/i;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9.\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

function numbers(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 24);
}

/**
 * Important factual claims — heuristic extraction, not a model guess.
 * Skips questions, policy notices, and first-person hedging.
 */
export function extractFactualClaims(draftAnswer: string, limit = 8): string[] {
  if (!draftAnswer.trim()) return [];
  const sentences = splitSentences(draftAnswer);
  const claims: string[] = [];

  for (const sentence of sentences) {
    if (UNVERIFIED_MARKERS.test(sentence)) continue;
    if (/^(i |we |verification:|sources?:)/i.test(sentence)) continue;
    if (sentence.endsWith("?")) continue;

    const hasNumber = numbers(sentence).length > 0;
    const hasProper = /[A-Z][a-z]{2,}/.test(sentence);
    const hasFactCue =
      /\b(is|are|was|were|won|scored|announced|released|according|reported|located|founded|population|temperature|price)\b/i.test(
        sentence,
      );

    if (hasNumber || (hasProper && hasFactCue) || (hasFactCue && tokens(sentence).length >= 4)) {
      claims.push(sentence.replace(/\s+/g, " ").slice(0, 400));
    }
    if (claims.length >= limit) break;
  }

  return claims;
}

const SUPPORT_TOKEN_RATIO = 0.72;

/**
 * Lexical support check — NOT semantic proof.
 * Fail safely: weak overlap → unsupported (caller marks UNCERTAIN).
 */
export function evidenceSupportsClaim(claim: string, evidence: Evidence): { supported: boolean; reason: string } {
  const body = `${evidence.title ?? ""} ${evidence.content}`;
  const claimTokens = tokens(claim);
  const bodyNorm = normalize(body);

  if (claimTokens.length === 0 && numbers(claim).length === 0) {
    return { supported: false, reason: "Claim has no distinctive tokens to match" };
  }

  const claimNums = numbers(claim);
  const bodyNums = new Set(numbers(body));
  const missingNums = claimNums.filter((n) => !bodyNums.has(n));
  if (claimNums.length > 0 && missingNums.length > 0) {
    return {
      supported: false,
      reason: `Numeric values not found in source: ${missingNums.slice(0, 4).join(", ")}`,
    };
  }

  if (claimTokens.length === 0 && claimNums.length > 0 && missingNums.length === 0) {
    return { supported: true, reason: "Numeric values in claim appear in source (lexical only)" };
  }

  const matched = claimTokens.filter((t) => bodyNorm.includes(t));
  const ratio = claimTokens.length ? matched.length / claimTokens.length : 0;

  let hasPhrase = false;
  for (let i = 0; i < claimTokens.length - 1; i++) {
    const phrase = `${claimTokens[i]} ${claimTokens[i + 1]}`;
    if (bodyNorm.includes(phrase)) {
      hasPhrase = true;
      break;
    }
  }

  // Strong lexical signal: numbers align (when present) AND (contiguous phrase OR high overlap)
  if (ratio >= SUPPORT_TOKEN_RATIO && (hasPhrase || claimNums.length > 0)) {
    return {
      supported: true,
      reason: `${matched.length}/${claimTokens.length} tokens aligned (lexical only — not semantic proof)`,
    };
  }

  return {
    supported: false,
    reason: hasPhrase
      ? `Insufficient lexical support (${matched.length}/${claimTokens.length})`
      : "No contiguous phrase / weak overlap — fail-safe UNCERTAIN (not semantic proof)",
  };
}

export function checkClaimsAgainstEvidence(claims: string[], evidence: Evidence[]): ClaimCheck[] {
  return claims.map((claim) => {
    const supporting: string[] = [];
    const reasons: string[] = [];

    for (const item of evidence) {
      if (!item.content || item.content.trim().length < 8) continue;
      const result = evidenceSupportsClaim(claim, item);
      if (result.supported) {
        supporting.push(item.id);
        reasons.push(`${item.title || item.source}: ${result.reason}`);
      }
    }

    if (supporting.length === 0) {
      return {
        claim,
        supported: false,
        evidenceIds: [],
        reason: "No retrieved evidence contains supporting content for this claim",
      };
    }

    return {
      claim,
      supported: true,
      evidenceIds: supporting,
      reason: reasons[0] ?? "Supported by retrieved evidence",
    };
  });
}
