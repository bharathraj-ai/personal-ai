import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError, AuthService, type AuthContext } from "./auth-service.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by auth middleware — AUTHENTICATED USER ID ≠ CLIENT-SUPPLIED userId */
    auth?: AuthContext;
  }
}

export interface AuthPluginOptions {
  auth: AuthService;
  /**
   * Paths that skip authentication (exact or prefix with trailing *).
   * Default: GET /health only.
   */
  publicPaths?: Array<{ method?: string; path: string }>;
}

function isPublic(
  method: string,
  url: string,
  publicPaths: Array<{ method?: string; path: string }>,
): boolean {
  const pathOnly = url.split("?")[0] ?? url;
  for (const rule of publicPaths) {
    if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) continue;
    if (rule.path.endsWith("*")) {
      const prefix = rule.path.slice(0, -1);
      if (pathOnly.startsWith(prefix)) return true;
    } else if (pathOnly === rule.path) {
      return true;
    }
  }
  return false;
}

/**
 * Registers a preHandler that authenticates every non-public route.
 * Attaches request.auth with server-derived userId.
 */
export async function registerAuth(
  app: FastifyInstance,
  options: AuthPluginOptions,
): Promise<void> {
  const publicPaths = options.publicPaths ?? [
    { method: "GET", path: "/health" },
  ];

  app.decorateRequest("auth", undefined);

  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublic(request.method, request.url, publicPaths)) {
      return;
    }

    try {
      // Never log Authorization header or token values
      request.auth = options.auth.authenticate(request.headers.authorization);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });
}

/** Require auth already attached — throws 401 response helper. */
export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw new AuthError("Unauthorized");
  }
  return request.auth;
}

/**
 * Ignore client-supplied userId as authority.
 * Optionally reject when a mismatched userId is explicitly provided (dev safety).
 */
export function resolveUserId(
  request: FastifyRequest,
  clientUserId?: string | null,
  options: { rejectMismatch?: boolean } = {},
): string {
  const auth = requireAuth(request);
  if (
    options.rejectMismatch !== false &&
    clientUserId &&
    clientUserId !== auth.userId &&
    process.env.AUTH_REJECT_USERID_MISMATCH !== "false"
  ) {
    throw new AuthError(
      "Client userId does not match authenticated identity — userId is server-derived",
      403,
    );
  }
  return auth.userId;
}

export { AuthService, AuthError, type AuthContext };
