/**
 * Minimal local-development authentication.
 *
 * AUTHENTICATED USER ID ≠ CLIENT-SUPPLIED userId
 *
 * Authorization: Bearer <development-session-token>
 *
 * Tokens are configured via AUTH_DEV_TOKENS (JSON map) or the default
 * single-token AUTH_DEV_TOKEN / AUTH_DEV_USER_ID pair.
 */

export interface AuthContext {
  /** Stable user id derived from the authenticated session — never from the client body. */
  userId: string;
  /** Opaque token id (not the secret value) for logging. */
  tokenId: string;
}

export class AuthError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

export interface TokenRecord {
  userId: string;
  tokenId: string;
}

/** Parse AUTH_DEV_TOKENS JSON: { "token-value": "user-id", ... } */
export function loadTokenMapFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Map<string, TokenRecord> {
  const map = new Map<string, TokenRecord>();

  const json = env.AUTH_DEV_TOKENS?.trim();
  if (json) {
    try {
      const parsed = JSON.parse(json) as Record<string, string>;
      for (const [token, userId] of Object.entries(parsed)) {
        if (token && userId) {
          map.set(token, { userId, tokenId: `tok_${hashShort(token)}` });
        }
      }
    } catch {
      // fall through to single-token defaults
    }
  }

  const single = env.AUTH_DEV_TOKEN?.trim() || "dev-token";
  const userId = env.AUTH_DEV_USER_ID?.trim() || "default-user";
  if (!map.has(single)) {
    map.set(single, { userId, tokenId: `tok_${hashShort(single)}` });
  }

  // Optional second user for isolation tests
  const altToken = env.AUTH_DEV_TOKEN_B?.trim();
  const altUser = env.AUTH_DEV_USER_ID_B?.trim();
  if (altToken && altUser && !map.has(altToken)) {
    map.set(altToken, { userId: altUser, tokenId: `tok_${hashShort(altToken)}` });
  }

  return map;
}

function hashShort(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).slice(0, 8);
}

export class AuthService {
  private readonly tokens: Map<string, TokenRecord>;

  constructor(tokens?: Map<string, TokenRecord>) {
    this.tokens = tokens ?? loadTokenMapFromEnv();
  }

  /** Extract Bearer token from Authorization header (never log the value). */
  extractBearer(authorization: string | undefined): string | null {
    if (!authorization) return null;
    const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    return m?.[1] ?? null;
  }

  authenticate(authorization: string | undefined): AuthContext {
    const token = this.extractBearer(authorization);
    if (!token) {
      throw new AuthError("Missing Authorization Bearer token");
    }
    const record = this.tokens.get(token);
    if (!record) {
      throw new AuthError("Invalid Authorization token");
    }
    return { userId: record.userId, tokenId: record.tokenId };
  }

  /** Known user ids (for tests / diagnostics — never includes secrets). */
  listUserIds(): string[] {
    return [...new Set([...this.tokens.values()].map((t) => t.userId))];
  }
}
