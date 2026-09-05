import type { FastifyInstance } from "fastify";
import type { ModelAdapter } from "@personal-ai/ai-core";
import type { DatabaseClient } from "@personal-ai/db";
import type { EmbeddingProvider } from "@personal-ai/memory";
import type { ProviderManager } from "@personal-ai/providers";
import type { SecretVault } from "@personal-ai/security";
import { gatewayDiagnostics } from "../build-info.js";

const HEALTH_HANDLER_TIMEOUT_MS = Number(process.env.HEALTH_HANDLER_TIMEOUT_MS ?? 8_000);

function withHandlerTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`health handler timeout after ${ms}ms`)), ms),
    ),
  ]);
}

export function registerHealthRoutes(
  app: FastifyInstance,
  deps: {
    ownModel: ModelAdapter;
    providerManager: ProviderManager;
    secretVault: SecretVault;
    db?: DatabaseClient | null;
    embeddings?: EmbeddingProvider;
    postgresReady?: boolean;
    pgvector?: boolean;
    port?: number;
    workspaceBackend?: string;
    s3Configured?: boolean;
  },
) {
  app.get("/health", async () => {
    return withHandlerTimeout(buildHealthPayload(deps), HEALTH_HANDLER_TIMEOUT_MS).catch(
      (err) => ({
        status: "degraded",
        error: err instanceof Error ? err.message : String(err),
        model: { healthy: false, modelLoaded: false, ready: false },
        providers: {},
        database: {
          healthy: false,
          pgvector: deps.pgvector ?? false,
          message: "health handler timeout",
        },
        embeddings: { healthy: false, message: "health handler timeout" },
        memory: { available: true },
        rag: { available: true },
        workspace: { healthy: true, provider: "self-hosted", isolation: "path-boundary-only" },
        network: { databaseUsesInternet: Boolean(process.env.DATABASE_URL?.includes("neon.tech")) },
      }),
    );
  });

  app.get("/health/secrets", async () => {
    const ids = await deps.secretVault.list();
    return { count: ids.length, ids };
  });

  app.get("/health/db", async () => {
    if (!deps.db) {
      return {
        healthy: false,
        select1: false,
        message: process.env.DATABASE_URL?.trim()
          ? "DATABASE_URL set but Postgres client not initialized"
          : "DATABASE_URL not configured",
      };
    }
    try {
      const result = await deps.db.healthCheckLite();
      return {
        healthy: result.healthy,
        select1: result.healthy,
        latencyMs: result.latencyMs,
        hostKind: result.hostKind,
        host: result.host,
        message: result.message,
      };
    } catch (err) {
      return {
        healthy: false,
        select1: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

async function buildHealthPayload(deps: {
  ownModel: ModelAdapter;
  providerManager: ProviderManager;
  db?: DatabaseClient | null;
  embeddings?: EmbeddingProvider;
  pgvector?: boolean;
  postgresReady?: boolean;
  port?: number;
  workspaceBackend?: string;
  s3Configured?: boolean;
}) {
  const [providersMap, dbHealth, embeddingHealth] = await Promise.all([
    deps.providerManager.healthCheckAll({ force: false }),
    deps.db
      ? deps.db.healthCheckLite()
      : Promise.resolve({
          healthy: false,
          pgvector: false,
          message: "DATABASE_URL not configured",
          usesInternet: false,
          hostKind: "none" as const,
        }),
    deps.embeddings
      ? deps.embeddings.healthCheck()
      : Promise.resolve({ healthy: false, message: "no embedding provider" }),
  ]);

  const modelHealth =
    providersMap.get(deps.ownModel.id) ?? (await deps.ownModel.healthCheck());

  const ok =
    modelHealth.healthy &&
    modelHealth.modelLoaded !== false &&
    dbHealth.healthy &&
    embeddingHealth.healthy;

  return {
    status: ok ? "ok" : "degraded",
    diagnostics: gatewayDiagnostics({
      port: deps.port ?? Number(process.env.PORT ?? 3001),
      workspaceBackend: deps.workspaceBackend ?? "self-hosted",
      neonConnected: Boolean(dbHealth.healthy),
      neonSelect1: Boolean(dbHealth.healthy),
      s3Configured: deps.s3Configured ?? Boolean(process.env.S3_BUCKET),
      providers: Object.fromEntries(
        [...providersMap.entries()].map(([id, h]) => [id, { healthy: h.healthy }]),
      ),
    }),
    model: {
      ...modelHealth,
      modelLoaded: modelHealth.modelLoaded ?? modelHealth.healthy,
      ready: Boolean(modelHealth.healthy && modelHealth.modelLoaded !== false),
    },
    providers: Object.fromEntries(providersMap),
    database: {
      healthy: dbHealth.healthy,
      pgvector: deps.pgvector ?? dbHealth.pgvector,
      message: dbHealth.message,
      latencyMs: "latencyMs" in dbHealth ? dbHealth.latencyMs : undefined,
      hostKind: "hostKind" in dbHealth ? dbHealth.hostKind : undefined,
      host: "host" in dbHealth ? dbHealth.host : undefined,
      usesInternet: "usesInternet" in dbHealth ? dbHealth.usesInternet : false,
      pooler: "pooler" in dbHealth ? dbHealth.pooler : undefined,
    },
    embeddings: {
      provider: deps.embeddings?.id,
      dimensions: deps.embeddings?.dimensions,
      ...embeddingHealth,
    },
    memory: { available: true },
    rag: { available: true },
    workspace: {
      healthy: true,
      provider: "self-hosted",
      isolation: "path-boundary-only",
    },
    network: {
      databaseUsesInternet: Boolean(
        "usesInternet" in dbHealth ? dbHealth.usesInternet : false,
      ),
      embeddingsUseInternet: Boolean(process.env.EMBEDDING_API_URL),
      searchUsesInternet: Boolean(process.env.SEARCH_API_URL),
      fallbackUsesInternet: Boolean(process.env.FALLBACK_PROVIDER_URL),
      duckduckgoAvailable: true,
    },
  };
}
