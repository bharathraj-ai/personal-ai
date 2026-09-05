/** Tool permission levels — HIGH_RISK always requires explicit user approval. */
export enum ToolPermissionLevel {
  READ = "READ",
  WRITE = "WRITE",
  EXECUTE = "EXECUTE",
  HIGH_RISK = "HIGH_RISK",
}

/** Lifecycle states for an orchestrator run. */
export enum OrchestratorPhase {
  ANALYZE = "ANALYZE",
  CLARIFY = "CLARIFY",
  DECIDE = "DECIDE",
  PLAN = "PLAN",
  EXECUTE = "EXECUTE",
  OBSERVE = "OBSERVE",
  VERIFY = "VERIFY",
  RETRY = "RETRY",
  AWAIT_APPROVAL = "AWAIT_APPROVAL",
  WAITING_PROVIDER = "WAITING_PROVIDER",
  COMPLETE = "COMPLETE",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

/** Information tiers — do not conflate model knowledge, memory, and session context. */
export enum ContextTier {
  MODEL_KNOWLEDGE = "MODEL_KNOWLEDGE",
  PERSONAL_MEMORY = "PERSONAL_MEMORY",
  TEMPORARY_CONTEXT = "TEMPORARY_CONTEXT",
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface GenerateOptions {
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  /** When set, request JSON object mode from OpenAI-compatible APIs. */
  responseFormat?: "json_object";
}

export interface StreamChunk {
  type: "text" | "tool_call" | "done" | "error";
  content?: string;
  toolCall?: Partial<ToolCall>;
  error?: string;
}

export interface GenerateResult {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  finishReason?: "stop" | "tool_calls" | "length" | "error";
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface HealthStatus {
  healthy: boolean;
  latencyMs?: number;
  message?: string;
  /** Explicit model-weight readiness — false means NOT fully ready even if the service is up. */
  modelLoaded?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  permissionLevel: ToolPermissionLevel;
}

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
}

export interface PlanStep {
  id: string;
  description: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  successCriteria: string;
  dependsOn?: string[];
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
  reasoning?: string;
}

/** Important clarification question before large implementations. */
export interface ClarificationQuestion {
  id: string;
  question: string;
  category: "roles" | "architecture" | "integrations" | "security" | "deployment" | "scope";
  defaultDecision?: string;
}

/** How large the user's request actually is — never silently downgrade FULL_APPLICATION to a demo. */
export type RequestScale =
  | "SMALL_TASK"
  | "FEATURE"
  | "MVP"
  | "FULL_APPLICATION"
  | "LARGE_SYSTEM";

export type ProjectStatus =
  | "COMPLETE"
  | "PARTIAL"
  | "FAILED"
  | "PROJECT_INCOMPLETE"
  | "WAITING_FOR_PROVIDER";

export type PlanItemKind =
  | "module"
  | "page"
  | "component"
  | "api"
  | "database"
  | "auth"
  | "test"
  | "security"
  | "integration"
  | "dependency"
  | "milestone"
  | "requirement";

export type PlanItemStatus =
  | "planned"
  | "in_scope"
  | "in_progress"
  | "implemented"
  | "tested"
  | "verified"
  | "partial"
  | "failed"
  | "deferred";

/** Traceable plan item — every requested feature maps to IDs the Orchestrator can check. */
export interface PlanItem {
  id: string;
  kind: PlanItemKind;
  name: string;
  description?: string;
  moduleId?: string;
  requirementId?: string;
  status: PlanItemStatus;
  phase?: number;
  files?: string[];
}

export interface ProjectPhase {
  id: string;
  number: number;
  name: string;
  moduleIds: string[];
  summary: string;
}

export type FrameworkId =
  | "nextjs"
  | "react-vite"
  | "react-spa"
  | "static"
  | "node-stdlib"
  | "python"
  | "other";

export type ArchitectureLanguage = "typescript" | "javascript" | "python" | "other";

export type ArchitectureSource =
  | "user"
  | "existing_project"
  | "existing_plan"
  | "constraint"
  | "default";

/** Internal framework choice — shown as a statement, not a question, unless confirmation is required. */
export interface FrameworkDecision {
  framework: FrameworkId;
  language: ArchitectureLanguage;
  reason: string;
  confidence: "high" | "medium" | "low";
  user_confirmation_required: boolean;
}

/** Persisted stack for a project. Retrieved on resume so the AI does not ask again. */
export interface ArchitectureDecisions {
  framework: FrameworkId;
  language: ArchitectureLanguage;
  backend?: string;
  database?: string;
  storage?: string;
  testing?: string;
  deployment?: string;
  source: ArchitectureSource;
  decision: FrameworkDecision;
}

/**
 * Full decomposition before coding starts.
 * USER GOAL → PROJECT → MODULES → FEATURES → PAGES → COMPONENTS → API → DATABASE → AUTH → TESTS → SECURITY → DOCS
 */
export interface ProjectPlan {
  project: PlanItem;
  goal: string;
  scope: RequestScale;
  modules: PlanItem[];
  pages: PlanItem[];
  components: PlanItem[];
  backend: PlanItem[];
  database: PlanItem[];
  authentication: PlanItem[];
  integrations: PlanItem[];
  dependencies: PlanItem[];
  tests: PlanItem[];
  security: PlanItem[];
  milestones: PlanItem[];
  phases: ProjectPhase[];
  requirements: PlanItem[];
  /** Once set, do not re-ask framework/language unless the user changes requirements. */
  architecture?: ArchitectureDecisions;
  /** Incremental FULL_APPLICATION cursor — persisted in Neon with the plan JSON. */
  implementationProgress?: ImplementationProgress;
}

export interface FileManifestEntry {
  path: string;
  purpose: string;
  module: string;
}

export interface FileManifest {
  project: string;
  modules: Array<{ id: string; name: string; dependsOn?: string[] }>;
  files: FileManifestEntry[];
}

/** Immutable constraints derived from approved user decisions. */
export interface ArchitectureConstraints {
  database: "postgresql" | "file-json" | "sqlite" | "none";
  databaseProvider?: "neon" | "generic" | "local-file";
  authentication: "session" | "jwt" | "none" | "sso";
  roles: string[];
  storage: "storage-service" | "s3" | "local-file";
  storageFallback?: "local-file";
}

export type ProjectLifecycleState =
  | "DRAFT"
  | "CLARIFYING"
  | "PLANNED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "IMPLEMENTING"
  | "WAITING_FOR_PROVIDER"
  | "VERIFYING"
  | "REPAIRING"
  | "PARTIAL"
  | "COMPLETE"
  | "FAILED";

export interface ApprovedPlanRecord {
  approvalId: string;
  approvedAt: string;
  plan: ProjectPlan;
  requirements: PlanItem[];
  constraints: ArchitectureConstraints;
  implementationPlan?: ImplementationPlan;
  clarificationAnswers?: Record<string, string>;
}

export type PlanValidationStatus = "VALID_PLAN" | "PLAN_INVALID";

export interface PlanValidationResult {
  status: PlanValidationStatus;
  violations: string[];
}

export interface ImplementationProgress {
  fileManifest?: FileManifest;
  completedModuleIds: string[];
  failedModuleIds: string[];
  partialModuleIds: string[];
  waitingModuleIds?: string[];
  currentModuleId?: string;
  lifecycleState?: ProjectLifecycleState;
  architectureConstraints?: ArchitectureConstraints;
  approvedPlan?: ApprovedPlanRecord;
  providersUsed: string[];
  attemptCount: number;
  queue?: Array<{
    id: string;
    moduleId: string;
    state:
      | "PENDING"
      | "RUNNING"
      | "WAITING_PROVIDER"
      | "IMPLEMENTED"
      | "VERIFYING"
      | "FAILED"
      | "BLOCKED"
      | "VERIFIED";
    retryAt?: string;
    provider?: string;
    failure?: string;
  }>;
  retryAt?: string;
  waitReason?: string;
  repairHistory?: Array<{
    repairAttempt: number;
    provider?: string;
    filesChanged: string[];
    error: string;
    result: "PASSED" | "FAILED" | "PARTIAL" | "NO_PATCH";
  }>;
  clarificationAnswers?: Record<string, string>;
}

export interface CompletenessCounts {
  requirements: {
    requested: number;
    implemented: number;
    tested: number;
    verified: number;
    failed?: number;
    blocked?: number;
  };
  modules: { completed: number; total: number };
  pages: { completed: number; total: number };
  apis: { completed: number; total: number };
  tests: { passed: number; total: number };
  verification: { verified: number; total: number };
}

export interface CompletenessReport {
  status: ProjectStatus;
  reason: string;
  counts: CompletenessCounts;
  incompleteFeatures: string[];
  placeholders: string[];
  knownLimitations: string[];
  storage: string[];
  /** True when FULL_APPLICATION/LARGE_SYSTEM was reduced to a one-page demo. */
  singlePageDemo: boolean;
}

/** Structured implementation plan shown before AWAITING_IMPLEMENTATION_APPROVAL. */
export interface ImplementationPlan {
  objective: string;
  architecture: string;
  components: string[];
  database?: string;
  apis?: string[];
  frontend?: string;
  backend?: string;
  authentication?: string;
  roles?: string[];
  integrations?: string[];
  dependencies?: string[];
  files?: string[];
  testingStrategy?: string;
  security?: string[];
  deployment?: string;
  risks?: string[];
  commands?: string[];
  externalServices?: string[];
  /** Request scale — FULL_APPLICATION must not be treated as a one-page demo. */
  scope?: RequestScale;
  /** Mandatory decomposition for FULL_APPLICATION / LARGE_SYSTEM. */
  projectPlan?: ProjectPlan;
  phases?: ProjectPhase[];
  /** Structured stack decision (Next.js default, or preserved existing stack). */
  architectureDecisions?: ArchitectureDecisions;
}

export interface StepObservation {
  stepId: string;
  output: unknown;
  durationMs: number;
  timestamp: Date;
}

/** Evidence kinds collected during orchestration. Never store secrets in content. */
export type EvidenceType =
  | "web"
  | "document"
  | "memory"
  | "database"
  | "tool"
  | "code-test"
  | "runtime"
  | "provider";

/**
 * Source classification from observable signals (domain, URL, metadata).
 * Classification is not proof that content supports a claim.
 */
export type SourceQuality =
  | "official_primary"
  | "government_official"
  | "original_research"
  | "reputable_secondary"
  | "other"
  | "unknown";

export interface Evidence {
  id: string;
  type: EvidenceType;
  source: string;
  title?: string;
  url?: string;
  content: string;
  retrievedAt: Date;
  sourceQuality: SourceQuality;
  /** Source publication or last-update time when the page/tool actually provided one. */
  publishedAt?: Date;
  metadata?: Record<string, unknown>;
}

/** Developer/system-panel trace for one search-backed answer. Not shown as the user-facing answer. */
export interface SearchDebugTrace {
  original_query: string;
  detected_intent: string;
  answer_type?: string;
  relationship?: string;
  resolved_entity?: string;
  entity_candidates?: string[];
  generated_queries: string[];
  sources_consulted: Array<{ title?: string; url?: string; quality?: string }>;
  evidence_count: number;
  confidence: "high" | "medium" | "low";
  needs_clarification?: boolean;
  clarification_question?: string;
  analyzer: "search-intent" | "bharath";
  model_status?: string;
  final_answer_preview?: string;
}

/**
 * Claim/answer verification status.
 * Tool success is NOT the same as claim verification — use not_verified for tool-only success.
 */
export type VerificationStatus = "verified" | "uncertain" | "failed" | "not_verified";

/** Explicit check outcomes — never collapse NO_TESTS into PASSED. */
export type CheckOutcome =
  | "PASSED"
  | "FAILED"
  | "NO_TESTS"
  | "TEST_NOT_CONFIGURED"
  | "TEST_ERROR"
  | "NOT_RUN"
  | "NOT_IMPLEMENTED"
  | "SKIPPED";

export type ProviderCapability =
  | "chat"
  | "coding"
  | "code_review"
  | "code_fix"
  | "reasoning"
  | "generation"
  | "streaming"
  | "multimodal"
  | "verification"
  | "planning"
  | "json_structured_output"
  | "research"
  | "fast_response";

export interface VerificationCheck {
  name: string;
  passed: boolean;
  details?: string;
}

export interface ClaimCheck {
  claim: string;
  supported: boolean;
  evidenceIds: string[];
  reason: string;
}

/**
 * Step and answer verification.
 * `passed` remains the orchestrator retry signal (tool/step success).
 * `status` is the evidence-grounded outcome and must not be treated as "zero hallucination".
 * `confidence` is omitted unless it is computed from actual checks (passed / total).
 */
export interface VerificationResult {
  passed: boolean;
  criteria: string;
  details?: string;
  status: VerificationStatus;
  evidence: Evidence[];
  checks: VerificationCheck[];
  reason: string;
  confidence?: number;
  claims?: ClaimCheck[];
}

export interface OrchestratorResult {
  taskId: string;
  goal: string;
  plan: Plan;
  observations: StepObservation[];
  verifications: VerificationResult[];
  events: OrchestrationEvent[];
  finalResponse: string;
  retriesUsed: number;
  status:
    | "completed"
    | "partial"
    | "failed"
    | "cancelled"
    | "awaiting_clarification"
    | "awaiting_implementation_approval"
    | "waiting_provider"
    | "plan_invalid";
  completedAt: Date;
  evidence?: Evidence[];
  answerVerification?: VerificationResult;
  /** Set when important requirements are ambiguous */
  clarificationQuestions?: ClarificationQuestion[];
  /** Structured plan awaiting user approval before implementation */
  implementationPlan?: ImplementationPlan;
  analysisSummary?: string;
  /** SMALL_TASK … LARGE_SYSTEM — set before implementation. */
  requestScale?: RequestScale;
  /** Decomposition used for traceability (modules/pages/APIs/tests). */
  projectPlan?: ProjectPlan;
  /** CompletenessGuard outcome — a successful build is not automatic COMPLETE. */
  projectStatus?: ProjectStatus;
  completeness?: CompletenessReport;
  architecture?: ArchitectureDecisions;
}

/** Compatible event statuses — keep existing + richer event names in `phase` / `detail`. */
export type OrchestrationEventName =
  | "PLAN_CREATED"
  | "CLARIFICATION_REQUESTED"
  | "APPROVAL_REQUESTED"
  | "APPROVAL_GRANTED"
  | "APPROVAL_DENIED"
  | "TOOL_SELECTED"
  | "TOOL_EXECUTED"
  | "PROVIDER_SELECTED"
  | "PROVIDER_FAILED"
  | "SEARCH_EXECUTED"
  | "EVIDENCE_COLLECTED"
  | "VERIFICATION_STARTED"
  | "VERIFICATION_PASSED"
  | "VERIFICATION_FAILED"
  | "FIX_ATTEMPTED"
  | "PROJECT_SAVED"
  | "RETRY_STARTED"
  | "PATCH_GENERATED"
  | "PATCH_APPLIED"
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | "PLAN_INVALID"
  | "ARCHITECTURE_CONFLICT";

export interface OrchestrationEvent {
  taskId: string;
  stepId?: string;
  phase: string;
  event?: OrchestrationEventName;
  tool?: string;
  provider?: string;
  status: "started" | "completed" | "failed" | "retry" | "awaiting_approval";
  detail?: string;
  error?: string;
  durationMs?: number;
  retryCount?: number;
  timestamp: Date;
}

export interface ApprovalRequest {
  id: string;
  action: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  reason: string;
  requestedAt: Date;
}

export interface SecretReference {
  placeholder: string;
  secretId: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  priority: number;
  /** Declared capabilities — do not claim unsupported ones. */
  capabilities?: ProviderCapability[];
  model?: string;
}

export interface UserContext {
  userId: string;
  sessionId: string;
  conversationId?: string;
  workspaceId?: string;
  projectId?: string;
  /** Answers to clarification questions keyed by question id */
  clarificationAnswers?: Record<string, string>;
  /** Explicit user approval to begin implementation */
  implementationApproved?: boolean;
  /** Previously persisted stack — Orchestrator must not re-ask these choices. */
  architecture?: ArchitectureDecisions;
  /** When true, create_workspace must allocate a fresh workspace (acceptance / post-approval). */
  forceNewWorkspace?: boolean;
  /** When true, start a new project identity — do not reuse active project/session. */
  forceNewProject?: boolean;
}
