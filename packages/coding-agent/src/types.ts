export type {
  CodingWorkspace,
  CreateWorkspaceOptions,
  SandboxProviderKind,
  WorkspaceExecOptions,
  WorkspaceExecResult,
  WorkspaceInfo,
} from "./coding-workspace.js";

export type { CodeVerificationReport, VerificationStep, VerificationPipelineResult } from "./verification-pipeline.js";

/** @deprecated Prefer WorkspaceInfo / CodingWorkspace — kept for CodingAgent types. */
export interface WorkspaceConfig {
  id: string;
  userId: string;
  expiresAt: Date;
  sandboxProvider: "e2b" | "daytona" | "modal" | "self-hosted";
}

export interface CodingTask {
  description: string;
  workspaceId: string;
}

export interface ProposedPatch {
  path: string;
  content: string;
  reason?: string;
  diff?: string;
}

export interface CodingResult {
  success: boolean;
  summary: string;
  previewUrl?: string;
  errors?: string[];
  filesCreated?: string[];
  patchesApplied?: string[];
  moduleProgress?: CodingModuleProgress[];
  repairHistory?: RepairAttemptRecord[];
  waitingForProvider?: { retryAt?: string; reason: string };
  /** Workspace verification pipeline output — consumed by VerificationEngine. */
  verification?: {
    passed: boolean;
    steps: Array<{ name: string; passed: boolean; details?: string; outcome?: string }>;
    report?: import("./verification-pipeline.js").CodeVerificationReport;
  };
}

export interface CodingModuleProgress {
  id: string;
  name: string;
  status: "verified" | "partial" | "failed" | "skipped" | "waiting" | "blocked";
  files: string[];
}

export interface RepairAttemptRecord {
  repairAttempt: number;
  provider?: string;
  filesChanged: string[];
  error: string;
  result: "PASSED" | "FAILED" | "PARTIAL" | "NO_PATCH";
}
