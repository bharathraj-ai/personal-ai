import type { FastifyInstance } from "fastify";
import type { ModelAdapter } from "@personal-ai/ai-core";
import { ApiRecommender } from "@personal-ai/orchestrator";
import type { ProviderManager } from "@personal-ai/providers";
import type { SecretVault } from "@personal-ai/security";
import type { ApprovalStore } from "../services/approval-store.js";
import { getLaptopStats } from "../laptop-stats.js";

export function registerSystemRoutes(
  app: FastifyInstance,
  deps: {
    ownModel: ModelAdapter;
    providerManager: ProviderManager;
    secretVault: SecretVault;
    approvalStore: ApprovalStore;
    recommender: ApiRecommender;
    /** Actual provider — never claim cloud when local. */
    sandboxProvider: "self-hosted" | "container" | "e2b" | "daytona" | "modal";
    postgresReady?: boolean;
    pgvector?: boolean;
    embeddingProvider?: string;
    s3Health?: { state: string; bucket?: string; message?: string };
    storageProvider?: string;
    googleDriveConfigured?: boolean;
    /** Last search-intent trace for the developer/system panel. */
    getLastSearchDebug?: () => unknown;
  },
) {
  app.get("/system/status", async () => {
    const modelHealth = await deps.ownModel.healthCheck();
    const providers = await deps.providerManager.healthCheckAll({ force: true });

    const isLocal = deps.sandboxProvider === "self-hosted";
    const isContainer = deps.sandboxProvider === "container";
    const isCloudProvider =
      deps.sandboxProvider === "e2b" ||
      deps.sandboxProvider === "daytona" ||
      deps.sandboxProvider === "modal";
    const s3Configured = Boolean(process.env.S3_BUCKET?.trim());
    const s3State = s3Configured ? (deps.s3Health?.state ?? "NOT_CONFIGURED") : "NOT_CONFIGURED";

    return {
      model: {
        id: deps.ownModel.id,
        name: deps.ownModel.name,
        ...modelHealth,
        modelLoaded: modelHealth.modelLoaded ?? modelHealth.healthy,
        ready: Boolean(modelHealth.healthy && modelHealth.modelLoaded !== false),
        state:
          modelHealth.modelLoaded === false
            ? "NOT_LOADED"
            : modelHealth.healthy
              ? "LOADED"
              : "UNAVAILABLE",
      },
      providers: Object.fromEntries(providers),
      pendingApprovals: deps.approvalStore.getPending().length,
      secretsConfigured: (await deps.secretVault.list()).length,
      embeddingProvider: deps.embeddingProvider ?? "unknown",
      network: {
        databaseUsesInternet: Boolean(process.env.DATABASE_URL?.includes("neon.tech")),
        embeddingsUseInternet: Boolean(process.env.EMBEDDING_API_URL),
        searchUsesInternet: Boolean(process.env.SEARCH_API_URL),
        fallbackUsesInternet: Boolean(process.env.FALLBACK_PROVIDER_URL),
        groqConfigured: Boolean(process.env.GROQ_API_KEY?.trim()),
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
        cerebrasConfigured: Boolean(process.env.CEREBRAS_API_KEY?.trim()),
        duckduckgoAvailable: true,
        googleDriveConfigured: Boolean(deps.googleDriveConfigured),
      },
      phases: {
        gateway: true,
        orchestrator: true,
        ownModel: modelHealth.healthy,
        modelLoaded: modelHealth.modelLoaded === true,
        /** LOCAL WORKSPACE ≠ CLOUD SANDBOX */
        cloudSandbox: isCloudProvider,
        localWorkspace: isLocal,
        containerWorkspace: isContainer,
        sandboxProvider: deps.sandboxProvider,
        postgres: deps.postgresReady ?? false,
        pgvector: deps.pgvector ?? false,
        memory: true,
        rag: true,
        searchProvider: true,
        search: "AVAILABLE",
        database: deps.postgresReady ? "CONNECTED" : "DISCONNECTED",
        workspaceKind: isCloudProvider ? "CLOUD" : isContainer ? "CONTAINER" : "LOCAL",
        workspaceProvider: deps.sandboxProvider.toUpperCase(),
        s3: s3State,
      },
      s3: {
        state: s3State,
        bucket: s3Configured ? deps.s3Health?.bucket : undefined,
        message: s3Configured
          ? deps.s3Health?.message
          : "S3 NOT CONFIGURED",
        provider: s3Configured ? (deps.storageProvider ?? "s3") : "local-file",
      },
      workspace: {
        provider: deps.sandboxProvider,
        kind: isCloudProvider ? "CLOUD" : isContainer ? "CONTAINER" : "LOCAL",
        isolation: isLocal
          ? "path-boundary-only (LOCAL WORKSPACE ≠ CLOUD SANDBOX)"
          : isContainer
            ? "docker container: network=none, cap-drop, memory/cpu/pids, workspace bind-mount only (not a cloud VM)"
            : "provider-managed",
      },
      lastSearch: deps.getLastSearchDebug?.() ?? null,
      capabilityViews: await deps.providerManager.listCapabilityViews(),
      bharathCapabilityTests: deps.providerManager.getCapabilityTests(),
    };
  });

  app.get("/system/laptop", async () => getLaptopStats());

  app.get("/providers", async () => ({
    ownModel: { id: deps.ownModel.id, name: deps.ownModel.name },
    specialists: await deps.providerManager.listCapabilityViews(),
    keys: deps.providerManager.getSafeProviderStatus?.() ?? {},
    events: deps.providerManager.getKeyManager?.()?.getEvents(20) ?? [],
  }));

  app.get<{ Params: { provider: string } }>("/providers/:provider", async (request, reply) => {
    const id = request.params.provider.toLowerCase();
    const views = await deps.providerManager.listCapabilityViews();
    const view = views.find(
      (v) =>
        v.provider === id ||
        v.id === id ||
        ((id === "bharath" || id === "bharath-ai") && (v.provider === "bharath-ai" || v.id === "bharath-ai")),
    );
    if (!view && !["groq", "gemini", "cerebras"].includes(id)) {
      return reply.status(404).send({ error: "unknown provider" });
    }
    const keyId = id === "bharath" ? "bharath-ai" : id;
    const keys = (deps.providerManager.getSafeProviderStatus?.() ?? {}) as Record<
      string,
      { available?: boolean }
    >;
    return {
      provider: keyId,
      available: Boolean(view?.available ?? keys[id]?.available),
      capability: view ?? null,
      keys: keys[id] ?? null,
      bharathCapabilityTests:
        keyId.includes("bharath") ? deps.providerManager.getCapabilityTests() : undefined,
    };
  });

  app.post<{ Params: { provider: string } }>("/providers/:provider/probe", async (request, reply) => {
    const id = request.params.provider.toLowerCase();
    const views = await deps.providerManager.listCapabilityViews();
    const view = views.find((v) => v.provider === id || v.id === id);
    if (!view) return reply.status(404).send({ error: "unknown provider" });
    return {
      provider: id,
      healthy: view.healthy,
      available: view.available,
      capabilities: view.capabilities,
      codingGrantedByHealth: false,
      note: "Health/latency is not coding capability. Bharath coding uses stored capability probes.",
      bharathCapabilityTests:
        id.includes("bharath") ? deps.providerManager.getCapabilityTests() : undefined,
      keys: deps.providerManager.getSafeProviderStatus?.()?.[id],
    };
  });

  app.post<{ Params: { provider: string } }>("/providers/:provider/reset", async (request, reply) => {
    const id = request.params.provider.toLowerCase();
    const km = deps.providerManager.getKeyManager?.();
    if (!km) return reply.status(400).send({ error: "key manager not attached" });
    if (!["groq", "gemini", "cerebras"].includes(id)) {
      return reply.status(400).send({ error: "reset applies to specialist key pools only" });
    }
    km.resetCooldowns(id);
    return { provider: id, keys: km.statusView()[id], note: "INVALID and PAYMENT_REQUIRED keys were not re-enabled" };
  });

  app.post<{ Body: { goal: string } }>("/api-requirements", async (request) => {
    const { goal } = request.body;
    if (!goal?.trim()) {
      return { error: "goal is required" };
    }
    return deps.recommender.analyze(goal);
  });

  app.get("/approvals", async () => ({
    pending: deps.approvalStore.getPending(),
  }));

  app.post<{ Params: { id: string }; Body: { approved: boolean } }>(
    "/approvals/:id",
    async (request, reply) => {
      const ok = deps.approvalStore.resolve(request.params.id, request.body.approved);
      if (!ok) return reply.status(404).send({ error: "Approval not found or already resolved" });
      return { status: request.body.approved ? "approved" : "denied" };
    },
  );
}
