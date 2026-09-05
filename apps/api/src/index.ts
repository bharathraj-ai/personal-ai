import Fastify from "fastify";
import cors from "@fastify/cors";
import { resolve } from "node:path";
import { createOwnModelAdapter, OpenAICompatibleAdapter } from "@personal-ai/ai-core";
import type { OwnModelAdapterType } from "@personal-ai/ai-core";
import { CodingAgent, createCodingWorkspaceFromEnv, CODING_STRUCTURED_SYSTEM, parseStructuredCodingOutput, toProposedFiles, stripJsonFence } from "@personal-ai/coding-agent";
import { createDatabase, runMigrations, type DatabaseClient } from "@personal-ai/db";
import {
  createEmbeddingProvider,
  InMemoryMemoryService,
  InMemoryProjectService,
  NoopConversationService,
  PostgresConversationService,
  PostgresMemoryService,
  PostgresProjectService,
  PostgresProjectPlanStore,
  InMemoryProjectPlanStore,
  type ConversationService,
  type EmbeddingProvider,
  type MemoryService,
  type ProjectService,
  type ProjectPlanStore,
} from "@personal-ai/memory";
import { ApiRecommender, Orchestrator, classifyCodingTask, budgetCodingUserContent } from "@personal-ai/orchestrator";
import {
  ProviderManager,
  ProviderKeyManager,
  SPECIALIST_CAPABILITIES,
  ownCapabilitiesFromSuite,
  runOwnModelCapabilitySuite,
} from "@personal-ai/providers";
import {
  InMemoryRagService,
  PostgresRagService,
  type RagService,
} from "@personal-ai/rag";
import { InMemorySecretVault } from "@personal-ai/security";
import {
  createStorageFromEnv,
  ProjectPersistenceService,
  type StorageService,
} from "@personal-ai/storage";
import {
  InMemoryAuditLogService,
  PostgresAuditLogService,
  type AuditLogService,
} from "@personal-ai/audit";
import type { ApprovalRequest, Message, OrchestratorPhase } from "@personal-ai/shared";
import { createDefaultTools } from "@personal-ai/tools";
import { AuthService, registerAuth, requireAuth, AuthError } from "./auth/index.js";
import { loadApiEnv } from "./load-env.js";
import { ApprovalStore } from "./services/approval-store.js";
import { OrchestrationSessionStore } from "./services/orchestration-session.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerWorkspaceRoutes, storeTaskResult } from "./routes/workspaces.js";
import { registerStorageRoutes } from "./routes/storage.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { gatewayDiagnostics, GATEWAY_BUILD_ID, VERIFICATION_PIPELINE_VERSION } from "./build-info.js";
import { proposeStructuredModuleFile } from "./structured-coding-propose.js";

loadApiEnv();

const PORT = Number(process.env.PORT ?? 3001);
const ADAPTER_TYPE = (process.env.OWN_MODEL_ADAPTER ?? "bharath") as OwnModelAdapterType;
const SANDBOX_ROOT =
  process.env.SANDBOX_ROOT ?? resolve(process.cwd(), "../../sandbox/workspaces");

const RAG_CONFIG = {
  topK: Number(process.env.RAG_TOP_K ?? 5),
  similarityThreshold: Number(process.env.RAG_SIMILARITY_THRESHOLD ?? 0.25),
  chunkSize: Number(process.env.RAG_CHUNK_SIZE ?? 800),
  chunkOverlap: Number(process.env.RAG_CHUNK_OVERLAP ?? 100),
  maxContextChars: Number(process.env.RAG_MAX_CONTEXT_CHARS ?? 6000),
};

function createModelFromEnv() {
  if (ADAPTER_TYPE === "openai-compatible") {
    return createOwnModelAdapter({
      type: "openai-compatible",
      openaiCompatible: {
        baseUrl: process.env.OWN_MODEL_URL ?? "http://localhost:8000/v1",
        model: process.env.OWN_MODEL_NAME ?? "default",
        apiKey: process.env.OWN_MODEL_API_KEY,
      },
    });
  }

  return createOwnModelAdapter({
    type: "bharath",
    bharath: {
      baseUrl: process.env.BHARATH_AI_URL ?? "http://localhost:8000",
      useRag: process.env.BHARATH_USE_RAG !== "false",
      useMemory: process.env.BHARATH_USE_MEMORY !== "false",
    },
  });
}

async function initKnowledgeLayer(log: {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}): Promise<{
  db: DatabaseClient | null;
  embeddings: EmbeddingProvider;
  memory: MemoryService;
  rag: RagService;
  projects: ProjectService;
  conversations: ConversationService;
  postgresReady: boolean;
  pgvector: boolean;
}> {
  const embeddings = createEmbeddingProvider({
    dimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? 384),
    apiUrl: process.env.EMBEDDING_API_URL,
    apiKey: process.env.EMBEDDING_API_KEY,
    model: process.env.EMBEDDING_MODEL,
  });

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    log.warn({}, "DATABASE_URL not set — using in-memory memory/RAG (non-persistent)");
    return {
      db: null,
      embeddings,
      memory: new InMemoryMemoryService(),
      rag: new InMemoryRagService(RAG_CONFIG),
      projects: new InMemoryProjectService(),
      conversations: new NoopConversationService(),
      postgresReady: false,
      pgvector: false,
    };
  }

  const maxAttempts = Number(process.env.DB_INIT_RETRIES ?? 3);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const db = await createDatabase(databaseUrl);
      const applied = await runMigrations(db);
      const health = await db.healthCheck();
      log.info(
        {
          attempt,
          applied,
          embedding: embeddings.id,
          host: health.host,
          hostKind: health.hostKind,
          usesInternet: health.usesInternet,
          pooler: health.pooler,
          pgvector: health.pgvector,
          latencyMs: health.latencyMs,
        },
        "Postgres knowledge layer ready",
      );

      return {
        db,
        embeddings,
        memory: new PostgresMemoryService(db, embeddings, {
          topK: RAG_CONFIG.topK,
          similarityThreshold: RAG_CONFIG.similarityThreshold,
        }),
        rag: new PostgresRagService(db, embeddings, RAG_CONFIG),
        projects: new PostgresProjectService(db),
        conversations: new PostgresConversationService(db),
        postgresReady: health.healthy,
        pgvector: health.pgvector,
      };
    } catch (err) {
      lastErr = err;
      log.warn(
        {
          attempt,
          maxAttempts,
          err: err instanceof Error ? err.message : String(err),
        },
        "Postgres init attempt failed",
      );
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
  }

  log.warn(
    { err: lastErr instanceof Error ? lastErr.message : String(lastErr) },
    "Postgres init failed — falling back to in-memory knowledge layer",
  );
  return {
    db: null,
    embeddings,
    memory: new InMemoryMemoryService(),
    rag: new InMemoryRagService(RAG_CONFIG),
    projects: new InMemoryProjectService(),
    conversations: new NoopConversationService(),
    postgresReady: false,
    pgvector: false,
  };
}

async function main() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const authService = new AuthService();
  await registerAuth(app, {
    auth: authService,
    publicPaths: [
      { method: "GET", path: "/health" },
      { method: "GET", path: "/health/db" },
    ],
  });

  const ownModel = createModelFromEnv();
  const approvalStore = new ApprovalStore();
  const recommender = new ApiRecommender(undefined, {
    searchConnected: Boolean(process.env.SEARCH_API_URL),
  });

  // CodingWorkspace — local (dev host exec) or container (docker isolation). Never claim cloud unless e2b/daytona/modal.
  const workspaces = await createCodingWorkspaceFromEnv(
    {
      rootDir: SANDBOX_ROOT,
      defaultLifetimeDays: Number(process.env.WORKSPACE_LIFETIME_DAYS ?? 30),
    },
    app.log,
  );
  const restored = await workspaces.restoreFromDisk();

  /** Per-user active workspace / project — keyed by authenticated userId */
  const activeWorkspaceByUser = new Map<string, string>();
  const activeProjectByUser = new Map<string, string>();

  const knowledge = await initKnowledgeLayer(app.log);

  app.log.info(
    {
      adapter: ownModel.id,
      name: ownModel.name,
      type: ADAPTER_TYPE,
      restored,
      sandboxProvider: workspaces.providerKind,
    },
    "Own model adapter initialized (LOCAL WORKSPACE ≠ CLOUD SANDBOX)",
  );

  const providerManager = new ProviderManager(ownModel);

  const providerHealthTimeoutMs = Number(process.env.PROVIDER_HEALTH_TIMEOUT_MS ?? 20_000);

  /** Register an OpenAI-compatible specialist when enabled (API key required unless requireKey=false). */
  const registerSpecialist = (opts: {
    id: string;
    name: string;
    type: string;
    apiKey?: string;
    baseUrl: string;
    model: string;
    enabledEnv?: string;
    priority: number;
    requireKey?: boolean;
    capabilities?: (typeof SPECIALIST_CAPABILITIES)[string];
  }) => {
    try {
      const key = opts.apiKey?.trim();
      if (opts.requireKey !== false && !key) {
        app.log.info({ specialist: opts.id }, "Specialist skipped — API key not configured");
        return;
      }
      if (opts.enabledEnv === "false") {
        app.log.info({ specialist: opts.id }, "Specialist disabled via env");
        return;
      }
      if (!opts.baseUrl?.trim()) {
        app.log.warn({ specialist: opts.id }, "Specialist skipped — base URL missing");
        return;
      }

      const adapter = new OpenAICompatibleAdapter(opts.id, opts.name, {
        baseUrl: opts.baseUrl.replace(/\/$/, ""),
        model: opts.model,
        apiKey: key,
        healthTimeoutMs: providerHealthTimeoutMs,
        timeoutMs: Number(process.env.PROVIDER_GENERATE_TIMEOUT_MS ?? 120_000),
      });
      const capabilities =
        opts.capabilities ??
        SPECIALIST_CAPABILITIES[opts.id] ??
        SPECIALIST_CAPABILITIES[opts.type] ??
        ["generation", "streaming"];
      providerManager.registerSpecialist(
        {
          id: opts.id,
          name: opts.name,
          type: opts.type,
          enabled: true,
          priority: opts.priority,
          model: opts.model,
          capabilities,
        },
        adapter,
      );
      // Never log apiKey
      app.log.info(
        { specialist: opts.id, model: opts.model, priority: opts.priority, capabilities },
        "Specialist provider registered",
      );
    } catch (err) {
      app.log.error(
        {
          specialist: opts.id,
          error: err instanceof Error ? err.message : String(err),
        },
        "Specialist registration failed",
      );
    }
  };

  // Groq / Gemini / Cerebras — optional specialists (never replace Bharath as default)
  registerSpecialist({
    id: "groq",
    name: "Groq",
    type: "groq",
    apiKey: process.env.GROQ_API_KEY,
    baseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
    enabledEnv: process.env.GROQ_ENABLED,
    priority: Number(process.env.GROQ_PRIORITY ?? 10),
    capabilities: SPECIALIST_CAPABILITIES.groq,
  });
  registerSpecialist({
    id: "gemini",
    name: "Gemini",
    type: "gemini",
    apiKey: process.env.GEMINI_API_KEY,
    baseUrl:
      process.env.GEMINI_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta/openai",
    model: process.env.GEMINI_MODEL ?? "gemini-flash-latest",
    enabledEnv: process.env.GEMINI_ENABLED,
    priority: Number(process.env.GEMINI_PRIORITY ?? 20),
    capabilities: SPECIALIST_CAPABILITIES.gemini,
  });
  registerSpecialist({
    id: "cerebras",
    name: "Cerebras",
    type: "cerebras",
    apiKey: process.env.CEREBRAS_API_KEY,
    baseUrl: process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1",
    model: process.env.CEREBRAS_MODEL ?? "llama3.1-8b",
    enabledEnv: process.env.CEREBRAS_ENABLED,
    priority: Number(process.env.CEREBRAS_PRIORITY ?? 30),
    capabilities: SPECIALIST_CAPABILITIES.cerebras,
  });

  const keyManager = new ProviderKeyManager({
    rotation: process.env.PROVIDER_KEY_ROTATION !== "false",
    maxAttempts: Number(process.env.PROVIDER_MAX_ATTEMPTS ?? 3),
    cooldownBaseMs: Number(process.env.PROVIDER_COOLDOWN_BASE_SECONDS ?? 30) * 1000,
    cooldownMaxMs: Number(process.env.PROVIDER_COOLDOWN_MAX_SECONDS ?? 900) * 1000,
  });
  keyManager.loadFromEnv();
  providerManager.attachKeyManager(keyManager);

  if (process.env.FALLBACK_PROVIDER_URL) {
    registerSpecialist({
      id: "fallback",
      name: "Fallback",
      type: "openai",
      apiKey: process.env.FALLBACK_PROVIDER_API_KEY,
      baseUrl: process.env.FALLBACK_PROVIDER_URL,
      model: process.env.FALLBACK_PROVIDER_MODEL ?? "gpt-4o-mini",
      priority: Number(process.env.FALLBACK_PROVIDER_PRIORITY ?? 100),
      requireKey: false,
      capabilities: SPECIALIST_CAPABILITIES.fallback,
    });
  }

  // Coding agent with optional specialist-backed auto-fix (keys never leave adapters)
  const codingAgent = new CodingAgent(workspaces, undefined, {
    maxFixAttempts: 3,
    proposeFiles: async ({
      goal,
      inspectionSummary,
      existingFiles,
      packageJson,
      planSummary,
      requestScale,
      resume,
      moduleName,
      moduleContract,
      targetFiles,
      chunkIndex,
      chunkCount,
      relevantSnippets,
    }) => {
      const codingClass = classifyCodingTask(goal);
      const preferOwnModel =
        codingClass === "TRIVIAL" || codingClass === "SMALL_EDIT";
      const preferredProvider = /hello2\.py|Hello from Gemini/i.test(goal)
        ? "gemini"
        : /hello_rotation\.py/i.test(goal)
          ? "groq"
          : undefined;
      const target = targetFiles?.[0];
      const allowedPaths = (targetFiles ?? []).map((f) => f.path).filter(Boolean);
      const waitPayload = (executed: { waitingForProvider?: { retryAt?: string; reason: string }; parsed?: unknown }) => {
        if (executed.waitingForProvider) {
          return [
            {
              path: ".__wait",
              content: JSON.stringify(executed.waitingForProvider),
              purpose: "WAITING_FOR_PROVIDER",
              operation: "create" as const,
            },
          ];
        }
        return null;
      };

      const structuredOpts = {
        capability: "json_structured_output" as const,
        preferOwnModel: moduleContract ? false : preferOwnModel,
        taskType: "complex_coding" as const,
        preferredProvider,
      };

      if (target && (requestScale === "FULL_APPLICATION" || requestScale === "LARGE_SYSTEM" || moduleContract)) {
        return (
          (await proposeStructuredModuleFile({
            providerManager,
            log: app.log,
            structuredOpts,
            moduleContract,
            target,
            allowedPaths,
            relevantSnippets,
          })) ?? null
        );
      }

      const boundedGoal = moduleName
        ? `Implement only: ${moduleName}. ${goal.slice(0, 400)}`
        : goal;
      const executed = await providerManager.executeStructured(
        structuredOpts,
        {
          messages: [
            {
              role: "system",
              content: CODING_STRUCTURED_SYSTEM,
            },
            {
              role: "user",
              content: budgetCodingUserContent({
                goal: boundedGoal,
                scale: requestScale,
                planSummary: [
                  planSummary,
                  targetFiles?.length
                    ? `Target files only:\n${targetFiles.map((f) => `- ${f.path}`).join("\n")}`
                    : "",
                  chunkIndex != null
                    ? `Chunk ${chunkIndex + 1}/${chunkCount ?? chunkIndex + 1}`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
                inspectionSummary,
                existingFiles,
                packageJson,
                resume,
                providerId: preferredProvider ?? (preferOwnModel ? "bharath-ai" : "groq"),
              }),
            },
          ],
          temperature: 0.2,
          maxTokens: 2048,
          responseFormat: "json_object",
        },
        (text) => parseStructuredCodingOutput(text, { allowedPaths: allowedPaths.length ? allowedPaths : undefined }),
      );
      const trace = providerManager.getLastStructuredTrace();
      app.log.info(
        {
          selectedProvider: executed.selectedProvider,
          fallbackUsed: executed.fallbackUsed,
          fallbackReason: executed.fallbackReason,
          error: executed.error,
          attemptCount: executed.attemptCount,
          validation: executed.validation,
          attempted: executed.attempted,
          routing: trace,
        },
        "coding structured output",
      );
      if (!executed.parsed) {
        const wait = waitPayload(executed);
        if (wait) return wait;
        return [
          {
            path: ".__wait",
            content: JSON.stringify({
              reason: executed.failureKind ?? "INVALID_STRUCTURED_OUTPUT",
              detail: executed.fallbackReason ?? executed.error,
              failureKind: executed.failureKind,
            }),
            purpose: "WAITING_FOR_PROVIDER",
            operation: "create" as const,
          },
        ];
      }
      return toProposedFiles(executed.parsed);
    },
    proposePatch: async ({ errorSummary, files, attempt }) => {
      const executed = await providerManager.executeWithFallback(
        {
          capability: "code_fix",
          preferOwnModel: false,
          taskType: "fix",
        },
        {
          messages: [
            {
              role: "system",
              content:
                'Suggest one workspace-relative file patch as JSON only: {"path":"...","content":"...","reason":"..."}. Never include API keys.',
            },
            {
              role: "user",
              content: `Attempt ${attempt}. Files: ${files.slice(0, 40).join(", ")}\nErrors:\n${errorSummary.slice(0, 3000)}`,
            },
          ],
          temperature: 0.1,
        },
      );
      if (!executed.result?.content) return null;
      try {
        const { text } = stripJsonFence(executed.result.content);
        const parsed = JSON.parse(text) as {
          path?: string;
          content?: string;
          reason?: string;
        };
        if (!parsed.path || typeof parsed.content !== "string") return null;
        if (parsed.path.includes("..") || parsed.path.startsWith("/")) return null;
        return {
          path: parsed.path,
          content: parsed.content,
          reason: parsed.reason,
        };
      } catch {
        return null;
      }
    },
    onEvent: (ev) => {
      app.log.info(
        { codingEvent: ev.event, detail: ev.detail, attempt: ev.attempt, path: ev.path },
        "coding auto-fix event",
      );
    },
  });

  void runOwnModelCapabilitySuite(ownModel)
    .then((suite) => {
      providerManager.setOwnCapabilities(ownCapabilitiesFromSuite(suite));
      for (const [name, result] of Object.entries(suite)) {
        providerManager.setCapabilityTest(name, result);
      }
      app.log.info(
        { suite, capabilities: providerManager.getOwnCapabilities() },
        "Bharath capability probe (PASS/FAIL from live tests, not hardcoded)",
      );
    })
    .catch((err) => {
      app.log.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Bharath capability probe failed — coding will use specialists",
      );
    });

  const secretVault = new InMemorySecretVault();
  const seedSecrets: Array<[string, string | undefined]> = [
    ["GROQ_API", process.env.GROQ_API_KEY],
    ["GEMINI_API", process.env.GEMINI_API_KEY],
    ["CEREBRAS_API", process.env.CEREBRAS_API_KEY],
    ["NEON_DATABASE_URL", process.env.DATABASE_URL],
    ["S3_ACCESS_KEY", process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID],
    ["S3_SECRET_KEY", process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY],
    ["AUTH_DEV_TOKEN", process.env.AUTH_DEV_TOKEN],
  ];
  for (const [id, value] of seedSecrets) {
    if (value?.trim()) await secretVault.store(id, value.trim());
  }
  const orchestrationSessions = new OrchestrationSessionStore();

  const storage: StorageService = createStorageFromEnv();
  const projectPersistence = new ProjectPersistenceService(storage, workspaces);
  const storageHealth = await storage.healthCheck();
  app.log.info(
    { storage: storageHealth.state, provider: storage.id, path: storageHealth.bucket },
    "Persistent storage initialized",
  );

  const auditLog: AuditLogService = knowledge.db
    ? new PostgresAuditLogService(knowledge.db)
    : new InMemoryAuditLogService();
  const projectPlanStore: ProjectPlanStore = knowledge.db
    ? new PostgresProjectPlanStore(knowledge.db)
    : new InMemoryProjectPlanStore();

  let requestUserId = "anonymous";
  let requestProjectId: string | undefined;
  let requestWorkspaceId: string | undefined;

  const approvalHandler = async ({
    toolName,
    args,
    reason,
  }: {
    toolName: string;
    args: Record<string, unknown>;
    reason: string;
  }) => {
    const request: ApprovalRequest = {
      id: crypto.randomUUID(),
      action: toolName,
      toolName,
      toolArgs: args,
      reason,
      requestedAt: new Date(),
    };
    approvalStore.create(request);
    app.log.warn({ approvalId: request.id, toolName }, "HIGH_RISK action awaiting approval");
    return approvalStore.waitForApproval(request.id);
  };

  const liveTools = createDefaultTools({
    searchApiUrl: process.env.SEARCH_API_URL,
    searchApiKey: process.env.SEARCH_API_KEY,
    workspaces,
    getWorkspaceId: () =>
      requestWorkspaceId ?? activeWorkspaceByUser.get(requestUserId),
    memory: knowledge.memory,
    rag: knowledge.rag,
    getUserId: () => requestUserId,
    getProjectId: () =>
      requestProjectId ?? activeProjectByUser.get(requestUserId),
    onWorkspaceCreated: (workspaceId) => {
      activeWorkspaceByUser.set(requestUserId, workspaceId);
      requestWorkspaceId = workspaceId;
    },
    permissions: {
      onApprovalRequired: approvalHandler,
    },
  });

  app.addHook("preHandler", async (request) => {
    if (request.auth) {
      requestUserId = request.auth.userId;
      requestWorkspaceId = activeWorkspaceByUser.get(request.auth.userId);
      requestProjectId = activeProjectByUser.get(request.auth.userId);
    }
  });

  const orchestrator = new Orchestrator(
    {
      model: ownModel,
      tools: liveTools,
      providerManager,
      onPhaseChange: (phase: OrchestratorPhase, detail?: string) => {
        app.log.info({ phase, detail }, "orchestrator phase");
      },
      onEvent: (event) => {
        app.log.info({ event }, "orchestrator event");
        void auditLog.record({
          userId: requestUserId,
          projectId: requestProjectId,
          taskId: event.taskId,
          event: mapOrchestratorEventToAudit(event.event),
          detail: {
            phase: event.phase,
            tool: event.tool,
            provider: event.provider,
            status: event.status,
            detail: event.detail,
          },
        }).catch(() => {});
      },
      onApprovalRequired: async (request: ApprovalRequest) => {
        approvalStore.create(request);
        app.log.warn(
          { approvalId: request.id, tool: request.toolName },
          "HIGH_RISK awaiting approval",
        );
        return approvalStore.waitForApproval(request.id);
      },
      getStoredArchitecture: async (ctx) => {
        const rec = await projectPlanStore.getLatest({
          userId: ctx.userId,
          projectId: ctx.projectId,
          workspaceId: ctx.workspaceId,
        });
        return rec?.plan.architecture ?? ctx.architecture;
      },
      codingAgent,
      artifactStorageLabel: process.env.S3_BUCKET
        ? `s3://${storageHealth.bucket ?? process.env.S3_BUCKET}`
        : "S3 NOT CONFIGURED",
      persistProjectPlan: async ({ context, taskId, workspaceId, plan, classification, completeness }) => {
        await projectPlanStore.save({
          userId: context.userId,
          projectId: context.projectId ?? taskId,
          taskId,
          workspaceId,
          classification: classification ?? "FULL_APPLICATION",
          projectStatus: completeness?.status ?? "PROJECT_INCOMPLETE",
          plan,
          completeness,
          storageRefs: completeness?.storage ?? [storage.id],
        });
      },
      getStoredProject: async (ctx) => {
        const rec = await projectPlanStore.getLatest({
          userId: ctx.userId,
          projectId: ctx.projectId,
          workspaceId: ctx.workspaceId,
        });
        if (!rec) return null;
        return {
          workspaceId: rec.workspaceId,
          plan: rec.plan,
          projectId: rec.projectId ?? rec.taskId ?? ctx.projectId,
        };
      },
      isWorkspaceActive: (userId, workspaceId) =>
        workspaces.getOwned(workspaceId, userId)?.status === "active",
      restoreProjectWorkspace: async ({
        userId,
        projectId,
        projectName,
        sourceWorkspaceId,
      }) => {
        const existing = workspaces.getOwned(sourceWorkspaceId, userId);
        if (existing?.status === "active") {
          const artifactCount = await workspaces.countArtifactFiles(sourceWorkspaceId);
          if (artifactCount > 0) {
            activeWorkspaceByUser.set(userId, sourceWorkspaceId);
            requestWorkspaceId = sourceWorkspaceId;
            return {
              workspaceId: sourceWorkspaceId,
              restored: 0,
              errors: [],
              status: "REUSED_LOCAL" as const,
            };
          }
        }
        const { workspaceId, restore, status } = await projectPersistence.restoreProjectFromS3(
          userId,
          projectId,
          projectName,
          sourceWorkspaceId,
        );
        if (status !== "RESTORE_FAILED") {
          activeWorkspaceByUser.set(userId, workspaceId);
          requestWorkspaceId = workspaceId;
        }
        return {
          workspaceId,
          restored: restore.restored,
          errors: restore.errors,
          status,
        };
      },
    },
    { maxRetries: 3 },
  );

  registerHealthRoutes(app, {
    ownModel,
    providerManager,
    secretVault,
    db: knowledge.db,
    embeddings: knowledge.embeddings,
    postgresReady: knowledge.postgresReady,
    pgvector: knowledge.pgvector,
    port: PORT,
    workspaceBackend: workspaces.providerKind,
    s3Configured: Boolean(process.env.S3_BUCKET),
  });

  registerChatRoutes(app, {
    orchestrator,
    ownModel,
    secretVault,
    recommender,
    getActiveWorkspaceId: (userId) => activeWorkspaceByUser.get(userId),
    getActiveProjectId: (userId) => activeProjectByUser.get(userId),
    clearActiveWorkspace: (userId) => {
      activeWorkspaceByUser.delete(userId);
    },
    clearActiveProject: (userId) => {
      activeProjectByUser.delete(userId);
    },
    getStoredProject: async ({ userId, projectId, workspaceId }) => {
      const rec = await projectPlanStore.getLatest({ userId, projectId, workspaceId });
      if (!rec) return null;
      return {
        projectId: rec.projectId,
        workspaceId: rec.workspaceId,
      };
    },
    onTaskComplete: (result, ownerUserId) => {
      storeTaskResult(result, ownerUserId);
      const wsId = result.observations
        .flatMap((o) => {
          const out = o.output as { workspaceId?: string; output?: { workspaceId?: string } } | null;
          if (!out || typeof out !== "object") return [];
          if (typeof out.workspaceId === "string") return [out.workspaceId];
          if (out.output?.workspaceId) return [out.output.workspaceId];
          return [];
        })
        .find(Boolean);
      const projId = activeProjectByUser.get(ownerUserId) ?? result.taskId;
      activeProjectByUser.set(ownerUserId, projId);
      if (result.projectPlan) {
        void projectPlanStore
          .save({
            userId: ownerUserId,
            projectId: projId,
            taskId: result.taskId,
            workspaceId: wsId,
            classification: result.requestScale ?? "FULL_APPLICATION",
            projectStatus: result.projectStatus ?? "PROJECT_INCOMPLETE",
            plan: result.projectPlan,
            completeness: result.completeness,
            storageRefs: result.completeness?.storage ?? [storage.id],
          })
          .catch((err) => app.log.warn({ err: String(err) }, "project plan metadata save failed"));
      }
      if (wsId && (result.status === "completed" || result.status === "partial" || result.status === "waiting_provider")) {
        void projectPersistence
          .syncWorkspaceToS3(ownerUserId, projId, wsId)
          .then((sync) => {
            app.log.info({ sync, taskId: result.taskId }, "PROJECT_SAVED to storage");
            void auditLog.record({
              userId: ownerUserId,
              projectId: projId,
              taskId: result.taskId,
              event: "PROJECT_SAVED",
              detail: { uploaded: sync.uploaded, prefix: sync.s3Prefix, provider: storage.id },
            });
          })
          .catch((err) => {
            app.log.warn({ err: String(err) }, "PROJECT_SAVED failed");
          });
      }
    },
    memory: knowledge.memory,
    rag: knowledge.rag,
    conversations: knowledge.conversations,
    orchestrationSessions,
    providerManager,
  });

  registerSystemRoutes(app, {
    ownModel,
    providerManager,
    secretVault,
    approvalStore,
    recommender,
    sandboxProvider: workspaces.providerKind,
    postgresReady: knowledge.postgresReady,
    pgvector: knowledge.pgvector,
    embeddingProvider: knowledge.embeddings.id,
    s3Health: storageHealth,
    storageProvider: storage.id,
    googleDriveConfigured: Boolean(
      process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() && process.env.GOOGLE_DRIVE_ACCESS_TOKEN?.trim(),
    ),
    getLastSearchDebug: () => orchestrator.getLastSearchDebug(),
  });

  registerStorageRoutes(app, {
    storage,
    projectPersistence,
    getActiveProjectId: (userId) => activeProjectByUser.get(userId),
  });

  registerAuditRoutes(app, { audit: auditLog });

  registerWorkspaceRoutes(app, {
    workspaces,
    codingAgent,
    orchestrator,
    permissions: liveTools.permissionManager,
    getActiveWorkspaceId: (userId) => activeWorkspaceByUser.get(userId),
    setActiveWorkspaceId: (userId, id) => {
      if (id) activeWorkspaceByUser.set(userId, id);
      else activeWorkspaceByUser.delete(userId);
    },
  });

  registerKnowledgeRoutes(app, {
    memory: knowledge.memory,
    rag: knowledge.rag,
    projects: knowledge.projects,
    conversations: knowledge.conversations,
    projectPlanStore,
  });

  app.post<{ Body: { projectId?: string; userId?: string; workspaceId?: string } }>(
    "/context",
    async (request, reply) => {
      try {
        const auth = requireAuth(request);
        if (request.body.userId && request.body.userId !== auth.userId) {
          return reply.status(403).send({
            error: "Client userId does not match authenticated identity",
          });
        }
        if (request.body.projectId !== undefined) {
          if (request.body.projectId) {
            activeProjectByUser.set(auth.userId, request.body.projectId);
          } else {
            activeProjectByUser.delete(auth.userId);
          }
        }
        if (request.body.workspaceId) {
          const ws = workspaces.getOwned(request.body.workspaceId, auth.userId);
          if (!ws) {
            return reply.status(404).send({ error: "Workspace not found" });
          }
          activeWorkspaceByUser.set(auth.userId, ws.id);
        }
        return {
          activeUserId: auth.userId,
          activeProjectId: activeProjectByUser.get(auth.userId),
          activeWorkspaceId: activeWorkspaceByUser.get(auth.userId),
        };
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get("/context", async (request, reply) => {
    try {
      const auth = requireAuth(request);
      return {
        activeUserId: auth.userId,
        activeProjectId: activeProjectByUser.get(auth.userId),
        activeWorkspaceId: activeWorkspaceByUser.get(auth.userId),
      };
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  setInterval(() => {
    void workspaces.cleanupExpired().then((n) => {
      if (n > 0) app.log.info({ cleaned: n }, "Expired workspaces cleaned");
    });
  }, 60 * 60 * 1000);

  const shutdown = async () => {
    if (knowledge.db) await knowledge.db.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await app.listen({ port: PORT, host: "0.0.0.0" });
  const dbLive = knowledge.db ? await knowledge.db.healthCheckLite().catch(() => null) : null;
  const providerHealth = await providerManager.healthCheckAll({ force: false });
  const diag = gatewayDiagnostics({
    port: PORT,
    workspaceBackend: workspaces.providerKind,
    neonConnected: Boolean(dbLive?.healthy),
    neonSelect1: Boolean(dbLive?.healthy),
    s3Configured: Boolean(process.env.S3_BUCKET),
    providers: Object.fromEntries(
      [...providerHealth.entries()].map(([id, h]) => [id, { healthy: h.healthy }]),
    ),
  });
  app.log.info(`AI Gateway listening on http://localhost:${PORT}`);
  app.log.info(
    {
      gatewayBuildId: GATEWAY_BUILD_ID,
      verificationPipelineVersion: VERIFICATION_PIPELINE_VERSION,
      diagnostics: diag,
    },
    "Gateway startup diagnostics",
  );
  app.log.info(
    `Sandbox root: ${SANDBOX_ROOT} (provider=${workspaces.providerKind}; LOCAL ≠ CLOUD SANDBOX)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export type { Message };

function mapOrchestratorEventToAudit(
  event?: string,
): import("@personal-ai/audit").AuditEventName {
  const allowed = new Set([
    "PLAN_CREATED",
    "CLARIFICATION_REQUESTED",
    "APPROVAL_REQUESTED",
    "APPROVAL_GRANTED",
    "APPROVAL_DENIED",
    "TOOL_SELECTED",
    "TOOL_EXECUTED",
    "PROVIDER_SELECTED",
    "PROVIDER_FAILED",
    "SEARCH_EXECUTED",
    "EVIDENCE_COLLECTED",
    "VERIFICATION_STARTED",
    "VERIFICATION_PASSED",
    "VERIFICATION_FAILED",
    "FIX_ATTEMPTED",
    "PROJECT_SAVED",
    "TASK_COMPLETED",
    "TASK_FAILED",
  ]);
  if (event && allowed.has(event)) {
    return event as import("@personal-ai/audit").AuditEventName;
  }
  return "TOOL_EXECUTED";
}
