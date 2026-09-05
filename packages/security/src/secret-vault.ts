/**
 * Secret vault interface — wrap HashiCorp Vault or a managed secrets manager.
 * Raw secrets never reach the model, logs, RAG, or conversation history.
 * The model only sees placeholder tokens like `<GROQ_API>`.
 */

export interface SecretAccessAuditEntry {
  secretId: string;
  accessor: string;
  purpose: string;
  timestamp: Date;
  success: boolean;
}

export interface SecretVault {
  /** Store a secret; returns its ID. */
  store(secretId: string, value: string, metadata?: Record<string, string>): Promise<void>;

  /** Resolve a secret at tool execution time — never inject into prompts. */
  resolve(secretId: string, accessor: string, purpose: string): Promise<string>;

  /** Rotate a secret value. */
  rotate(secretId: string, newValue: string): Promise<void>;

  /** List secret IDs (never values). */
  list(): Promise<string[]>;

  /** Redact known secret patterns from text before logging. */
  redact(text: string): string;

  /** Audit log of all secret accesses. */
  getAuditLog(limit?: number): Promise<SecretAccessAuditEntry[]>;
}

const SECRET_PATTERNS = [
  /\b(sk-[a-zA-Z0-9]{20,})\b/g,
  /\b(gsk_[a-zA-Z0-9]{20,})\b/g,
  /\b(csk-[a-zA-Z0-9]{20,})\b/g,
  /\b(AIza[0-9A-Za-z\-_]{20,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(postgres(?:ql)?:\/\/[^\s"']+)/gi,
  /\b(api[_-]?key\s*[:=]\s*["']?[\w-]{16,}["']?)/gi,
];

/** In-memory vault for MVP/dev — replace with Vault integration in production. */
export class InMemorySecretVault implements SecretVault {
  private readonly secrets = new Map<string, string>();
  private readonly audit: SecretAccessAuditEntry[] = [];

  async store(secretId: string, value: string): Promise<void> {
    this.secrets.set(secretId, value);
  }

  async resolve(secretId: string, accessor: string, purpose: string): Promise<string> {
    const value = this.secrets.get(secretId);
    const success = value !== undefined;

    this.audit.push({
      secretId,
      accessor,
      purpose,
      timestamp: new Date(),
      success,
    });

    if (!success) {
      throw new Error(`Secret not found: ${secretId}`);
    }

    return value;
  }

  async rotate(secretId: string, newValue: string): Promise<void> {
    if (!this.secrets.has(secretId)) {
      throw new Error(`Secret not found: ${secretId}`);
    }
    this.secrets.set(secretId, newValue);
  }

  async list(): Promise<string[]> {
    return [...this.secrets.keys()];
  }

  redact(text: string): string {
    let redacted = text;
    for (const pattern of SECRET_PATTERNS) {
      redacted = redacted.replace(pattern, "[REDACTED]");
    }
    for (const id of this.secrets.keys()) {
      const value = this.secrets.get(id);
      if (value) {
        redacted = redacted.replaceAll(value, `<${id}>`);
      }
    }
    return redacted;
  }

  async getAuditLog(limit = 100): Promise<SecretAccessAuditEntry[]> {
    return this.audit.slice(-limit);
  }
}

/** Replace placeholder tokens in tool args with resolved secrets at execution time. */
export async function resolveSecretPlaceholders(
  args: Record<string, unknown>,
  vault: SecretVault,
  accessor: string,
  purpose: string,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.startsWith("<") && value.endsWith(">")) {
      const secretId = value.slice(1, -1);
      resolved[key] = await vault.resolve(secretId, accessor, purpose);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}
