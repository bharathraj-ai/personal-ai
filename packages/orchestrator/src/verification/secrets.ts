/**
 * Strip secret-like material from evidence. Evidence must never store credentials.
 */

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[a-zA-Z0-9]{20,}\b/g,
  /\bgsk_[a-zA-Z0-9]{20,}\b/g,
  /\bcsk-[a-zA-Z0-9]{20,}\b/g,
  /\bAIza[0-9A-Za-z\-_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[a-zA-Z0-9]{36,}\b/g,
  /\bgithub_pat_[a-zA-Z0-9_]{20,}\b/g,
  /\b(api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/gi,
  /\b(password|passwd|pwd)\s*[:=]\s*["']?[^\s"']+/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/g,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\b(postgres|mysql|mongodb(\+srv)?|redis):\/\/[^\s]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
];

export function redactSecrets(content: string): string {
  let out = content;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}
