import type { CheckOutcome } from "@personal-ai/shared";
import type { CodingResult, CodingTask, ProposedPatch, CodingModuleProgress } from "./types.js";
import type { CodingWorkspace } from "./coding-workspace.js";
import { inspectWorkspace, type WorkspaceInspection } from "./inspect-workspace.js";
import { PathEscapeError } from "./path-safety.js";
import { buildModuleContract, shouldSkipExistingFile } from "./module-contract.js";
import {
  VerificationPipeline,
  type CodeVerificationReport,
  type VerificationPipelineResult,
} from "./verification-pipeline.js";
import { isStrictCodingSuccess } from "./verification-success.js";
import { goalRequiresRealTests } from "./verification-project.js";
import type { RequestScale } from "@personal-ai/shared";

export type ProposePatchFn = (input: {
  workspaceId: string;
  errorSummary: string;
  failedSteps: Array<{ name: string; outcome: CheckOutcome; details?: string }>;
  files: string[];
  attempt: number;
}) => Promise<ProposedPatch | null>;

export type ProposeFilesFn = (input: {
  workspaceId: string;
  goal: string;
  inspectionSummary: string;
  existingFiles: string[];
  packageJson?: string;
  planSummary?: string;
  requestScale?: string;
  resume?: boolean;
  moduleId?: string;
  moduleName?: string;
  targetFiles?: Array<{ path: string; purpose: string }>;
  relevantSnippets?: string;
  chunkIndex?: number;
  chunkCount?: number;
  moduleContract?: import("./module-contract.js").ModuleContract;
}) => Promise<Array<{
  path: string;
  content: string;
  purpose?: string;
  operation?: "create" | "edit" | "delete";
}> | null>;

export interface CodingAgentOptions {
  maxFixAttempts?: number;
  /** Optional specialist/Bharath-backed patch suggester. File ops stay in the workspace. */
  proposePatch?: ProposePatchFn;
  /** File generation for FULL_APPLICATION — never a static template dump. */
  proposeFiles?: ProposeFilesFn;
  onEvent?: (event: {
    event: string;
    detail?: string;
    attempt?: number;
    path?: string;
  }) => void;
}

/**
 * Coding agent — creates/edits projects inside an isolated workspace.
 * Bharath AI (via orchestrator) decides what to write; this agent executes safely.
 * Auto-fix: BUILD/TEST fail → capture error → propose patch → apply in workspace → re-verify (max 3).
 */
export class CodingAgent {
  private readonly maxFixAttempts: number;
  private readonly proposePatch?: ProposePatchFn;
  private readonly proposeFiles?: ProposeFilesFn;
  private readonly onEvent?: CodingAgentOptions["onEvent"];
  private readonly verifier: VerificationPipeline;

  constructor(
    private readonly workspaces: CodingWorkspace,
    verifier?: VerificationPipeline,
    options: CodingAgentOptions = {},
  ) {
    this.verifier = verifier ?? new VerificationPipeline(3);
    this.maxFixAttempts = options.maxFixAttempts ?? 3;
    this.proposePatch = options.proposePatch;
    this.proposeFiles = options.proposeFiles;
    this.onEvent = options.onEvent;
  }

  /**
   * Inspect existing architecture, write proposed files (no overwrite unless empty),
   * then BUILD → TEST → FIX (max 3) → RETEST.
   */
  async implement(input: {
    workspaceId: string;
    goal: string;
    overwriteExisting?: boolean;
    planSummary?: string;
    requestScale?: RequestScale;
    resume?: boolean;
    schedule?: Array<{
      id: string;
      name: string;
      dependsOn: string[];
      requirements: string[];
      fileHints: string[];
      acceptance: string[];
    }>;
    fileManifest?: {
      project: string;
      files: Array<{ path: string; purpose: string; module: string }>;
    };
    completedModuleIds?: string[];
  }): Promise<CodingResult & { inspection?: WorkspaceInspection; moduleProgress?: CodingModuleProgress[] }> {
    const inspection = await inspectWorkspace(this.workspaces, input.workspaceId);
    this.onEvent?.({
      event: "TOOL_SELECTED",
      detail: `UNDERSTAND: ${inspection.summary}`,
    });

    if (!this.proposeFiles) {
      return {
        success: false,
        summary:
          "CodingAgent has no file proposer. Cannot implement a full application from a static template.",
        errors: ["proposeFiles not configured"],
        inspection,
      };
    }

    const incremental =
      (input.requestScale === "FULL_APPLICATION" || input.requestScale === "LARGE_SYSTEM") &&
      Boolean(input.schedule?.length);
    if (incremental) {
      return this.implementIncremental(input, inspection);
    }

    const proposed = await this.proposeFiles({
      workspaceId: input.workspaceId,
      goal: input.goal,
      inspectionSummary: inspection.summary,
      existingFiles: inspection.files,
      packageJson: inspection.packageJson,
      planSummary: input.planSummary,
      requestScale: input.requestScale,
      resume: input.resume,
    });

    if (!proposed?.length) {
      return {
        success: false,
        summary:
          "No implementation files were generated. Provider unavailable or response was not usable JSON. Not substituting a static template.",
        errors: ["NO_IMPLEMENTATION_FILES"],
        inspection,
      };
    }

    const written = await this.applyFiles(input.workspaceId, proposed, {
      overwriteExisting: input.overwriteExisting,
      resume: input.resume,
      existingCount: inspection.files.length,
    });
    if (written.error) {
      return {
        success: false,
        summary: written.error,
        errors: [written.error],
        filesCreated: written.paths,
        inspection,
      };
    }

    await this.maybeNpmInstall(input.workspaceId, written.paths, inspection.files);
    const verified = await this.verifyWithAutoFix(input.workspaceId);
    const files = await this.workspaces.listFiles(input.workspaceId);
    const report = verified.report;
    const success = isStrictCodingSuccess(report, input.requestScale, {
      requireRealTests: goalRequiresRealTests(input.goal),
    });
    return {
      success,
      summary: this.summarize(input.goal, report, files.length),
      filesCreated: files,
      patchesApplied: [...written.paths, ...verified.patchesApplied],
      repairHistory: verified.repairHistory,
      inspection,
      verification: {
        passed: verified.passed,
        steps: verified.steps.map((s) => ({
          name: s.name,
          passed: s.passed,
          details: s.details,
          outcome: s.outcome,
        })),
        report,
      },
      errors:
        report.status === "FAILED"
          ? verified.steps
              .filter((s) => s.outcome === "FAILED" || s.outcome === "TEST_ERROR")
              .map((s) => s.details ?? s.name)
          : undefined,
    };
  }

  async execute(task: CodingTask): Promise<CodingResult> {
    const ws = this.workspaces.get?.(task.workspaceId);
    if (!ws || ws.status !== "active") {
      return {
        success: false,
        summary: `Workspace ${task.workspaceId} is not available`,
        errors: ["Workspace missing or expired"],
      };
    }

    try {
      const result = await this.verifyWithAutoFix(task.workspaceId);
      const files = await this.workspaces.listFiles(task.workspaceId);
      const report = result.report;

      return {
        success: report.status === "VERIFIED" || report.status === "UNCERTAIN",
        summary: this.summarize(task.description, report, files.length),
        filesCreated: files,
        verification: {
          passed: result.passed,
          steps: result.steps.map((s) => ({
            name: s.name,
            passed: s.passed,
            details: s.details,
            outcome: s.outcome,
          })),
          report,
        },
        errors:
          report.status === "FAILED"
            ? result.steps
                .filter((s) => s.outcome === "FAILED" || s.outcome === "TEST_ERROR")
                .map((s) => s.details ?? s.name)
            : undefined,
        patchesApplied: result.patchesApplied,
      };
    } catch (err) {
      return {
        success: false,
        summary: "Coding agent execution failed",
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  }

  /**
   * Run verification; on failure, propose+apply bounded patches and re-verify.
   */
  async verifyWithAutoFix(workspaceId: string): Promise<
    VerificationPipelineResult & { patchesApplied: string[]; repairHistory: import("./types.js").RepairAttemptRecord[] }
  > {
    const patchesApplied: string[] = [];
    const repairHistory: import("./types.js").RepairAttemptRecord[] = [];
    let last: VerificationPipelineResult | undefined;

    for (let attempt = 1; attempt <= this.maxFixAttempts; attempt++) {
      last = await this.verifier.verify(workspaceId, this.workspaces, attempt);
      const report = last.report;

      const verificationDone =
        report.status === "VERIFIED" ||
        (report.build !== "FAILED" && report.tests === "PASSED");
      if (verificationDone) {
        if (repairHistory.length) {
          repairHistory[repairHistory.length - 1]!.result = "PASSED";
        }
        return { ...last, patchesApplied, repairHistory };
      }

      const failed = last.steps.filter(
        (s) =>
          s.outcome === "FAILED" ||
          s.outcome === "TEST_ERROR" ||
          s.outcome === "NO_TESTS",
      );
      if (failed.length === 0 || !this.proposePatch) {
        return { ...last, patchesApplied, repairHistory };
      }

      if (attempt >= this.maxFixAttempts) {
        repairHistory.push({
          repairAttempt: attempt,
          filesChanged: [],
          error: failed.map((s) => `${s.name}: ${s.details ?? s.outcome}`).join("\n"),
          result: "FAILED",
        });
        this.onEvent?.({
          event: "RETRY_STARTED",
          detail: "Max fix attempts reached",
          attempt,
        });
        return { ...last, patchesApplied, repairHistory };
      }

      const errorSummary = failed.map((s) => `${s.name}: ${s.details ?? s.outcome}`).join("\n");
      this.onEvent?.({
        event: "RETRY_STARTED",
        detail: `Auto-fix attempt ${attempt}: ${errorSummary.slice(0, 200)}`,
        attempt,
      });

      const files = await this.workspaces.listFiles(workspaceId);
      const patch = await this.proposePatch({
        workspaceId,
        errorSummary,
        failedSteps: failed.map((s) => ({
          name: s.name,
          outcome: s.outcome,
          details: s.details,
        })),
        files,
        attempt,
      });

      if (!patch?.path || typeof patch.content !== "string") {
        repairHistory.push({
          repairAttempt: attempt,
          filesChanged: [],
          error: errorSummary,
          result: "NO_PATCH",
        });
        this.onEvent?.({
          event: "PATCH_GENERATED",
          detail: "No usable patch proposed — stopping auto-fix",
          attempt,
        });
        return { ...last, patchesApplied, repairHistory };
      }

      this.onEvent?.({
        event: "PATCH_GENERATED",
        detail: patch.reason ?? "Patch suggested",
        attempt,
        path: patch.path,
      });

      try {
        await this.applyPatch(workspaceId, patch);
        patchesApplied.push(patch.path);
        repairHistory.push({
          repairAttempt: attempt,
          filesChanged: [patch.path],
          error: errorSummary,
          result: "PARTIAL",
        });
        this.onEvent?.({
          event: "PATCH_APPLIED",
          detail: patch.diff?.slice(0, 200) ?? `Applied ${patch.path}`,
          attempt,
          path: patch.path,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        repairHistory.push({
          repairAttempt: attempt,
          filesChanged: patch.path ? [patch.path] : [],
          error: `${errorSummary}\nPatch rejected: ${msg}`,
          result: "FAILED",
        });
        this.onEvent?.({
          event: "PATCH_APPLIED",
          detail: `Patch rejected: ${msg}`,
          attempt,
          path: patch.path,
        });
        return { ...last, patchesApplied, repairHistory };
      }

    }

    return {
      ...(last ?? {
        passed: false,
        steps: [],
        retriesUsed: 0,
        report: {
          status: "FAILED",
          build: "NOT_RUN",
          tests: "NOT_RUN",
          runtime: "NOT_RUN",
          security: "NOT_IMPLEMENTED",
          attempts: this.maxFixAttempts,
        } satisfies CodeVerificationReport,
      }),
      patchesApplied,
      repairHistory,
    };
  }

  /** Apply patch only inside the workspace (path-safe write). */
  async applyPatch(workspaceId: string, patch: ProposedPatch): Promise<void> {
    if (!patch.path || patch.path.includes("\0")) {
      throw new PathEscapeError("Invalid patch path");
    }
    // writeFile implementations must use resolveSafePath — LocalWorkspaceManager does.
    await this.workspaces.writeFile(workspaceId, patch.path, patch.content);
  }

  private async implementIncremental(
    input: {
      workspaceId: string;
      goal: string;
      overwriteExisting?: boolean;
      planSummary?: string;
      requestScale?: RequestScale;
      resume?: boolean;
      schedule?: Array<{
        id: string;
        name: string;
        dependsOn: string[];
        requirements: string[];
        fileHints: string[];
        acceptance: string[];
      }>;
      fileManifest?: {
        project: string;
        files: Array<{ path: string; purpose: string; module: string }>;
      };
      completedModuleIds?: string[];
    },
    inspection: WorkspaceInspection,
  ): Promise<CodingResult & { inspection?: WorkspaceInspection; moduleProgress?: CodingModuleProgress[] }> {
    const schedule = (input.schedule ?? []).filter(
      (m) => !(input.completedModuleIds ?? []).includes(m.id),
    );
    const allWritten: string[] = [];
    const patches: string[] = [];
    const moduleProgress: CodingModuleProgress[] = [];
    let lastVerified: Awaited<ReturnType<CodingAgent["verifyWithAutoFix"]>> | undefined;
    let emptyProposals = 0;
    let stopGeneration = false;
    let waitingForProvider: { retryAt?: string; reason: string } | undefined;

    const filesByModule = new Map<string, Array<{ path: string; purpose: string }>>();
    for (const f of input.fileManifest?.files ?? []) {
      const list = filesByModule.get(f.module) ?? [];
      list.push({ path: f.path, purpose: f.purpose });
      filesByModule.set(f.module, list);
    }

    const satisfied = new Set(input.completedModuleIds ?? []);
    const failedOrWaiting = new Set<string>();

    for (const mod of schedule) {
      if (stopGeneration) {
        moduleProgress.push({
          id: mod.id,
          name: mod.name,
          status: waitingForProvider ? "waiting" : failedOrWaiting.size ? "blocked" : "failed",
          files: [],
        });
        continue;
      }
      const unmet = mod.dependsOn.filter((d) => !satisfied.has(d) && failedOrWaiting.has(d));
      if (unmet.length) {
        moduleProgress.push({ id: mod.id, name: mod.name, status: "blocked", files: [] });
        failedOrWaiting.add(mod.id);
        this.onEvent?.({ event: "TOOL_SELECTED", detail: `BLOCKED_BY_MODULE ${mod.name} depends on ${unmet.join(",")}` });
        continue;
      }
      this.onEvent?.({ event: "TOOL_SELECTED", detail: `MODULE ${mod.name} (${mod.id})` });
      const contract = buildModuleContract(mod);
      const targets =
        filesByModule.get(mod.id)?.length
          ? filesByModule.get(mod.id)!
          : (mod.fileHints.length
              ? mod.fileHints.map((path) => ({ path, purpose: mod.name }))
              : []);
      const usable = targets.filter((t) => t.path);
      const chunks = chunkGenerationTargets(usable);

      if (usable.length === 0) {
        moduleProgress.push({ id: mod.id, name: mod.name, status: "failed", files: [] });
        failedOrWaiting.add(mod.id);
        this.onEvent?.({ event: "PATCH_APPLIED", detail: `${mod.name}=failed (no files in manifest)` });
        continue;
      }

      let moduleFiles: string[] = [];
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci]!;
        const inspect = await inspectWorkspace(this.workspaces, input.workspaceId);
        const stillNeeded: typeof chunk = [];
        for (const target of chunk) {
          const exists = await this.workspaces.fileExists?.(input.workspaceId, target.path);
          if (exists) {
            try {
              const body = await this.workspaces.readFile(input.workspaceId, target.path);
              if (shouldSkipExistingFile(target.path, body)) {
                moduleFiles.push(target.path);
                continue;
              }
            } catch {
              /* regenerate */
            }
          }
          stillNeeded.push(target);
        }
        if (stillNeeded.length === 0) {
          continue;
        }
        if (ci > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        const snippets = await this.readRelevant(input.workspaceId, inspect.files, stillNeeded);
        const proposed = await this.proposeFiles!({
          workspaceId: input.workspaceId,
          goal: `Implement module ${mod.name} only. Do not generate the rest of the application.`,
          inspectionSummary: inspect.summary,
          existingFiles: inspect.files.slice(0, 40),
          packageJson: inspect.packageJson,
          planSummary: JSON.stringify(contract),
          requestScale: input.requestScale,
          resume: true,
          moduleId: mod.id,
          moduleName: mod.name,
          moduleContract: contract,
          relevantSnippets: snippets,
          targetFiles: stillNeeded.filter((c) => c.path),
          chunkIndex: ci,
          chunkCount: chunks.length,
        });
        const waitMarker = proposed?.find((f) => f.path === ".__wait" || f.purpose === "WAITING_FOR_PROVIDER");
        if (waitMarker) {
          try {
            waitingForProvider = JSON.parse(waitMarker.content) as { retryAt?: string; reason: string };
          } catch {
            waitingForProvider = { reason: waitMarker.content.slice(0, 200) || "provider unavailable" };
          }
          moduleProgress.push({ id: mod.id, name: mod.name, status: "waiting", files: moduleFiles });
          failedOrWaiting.add(mod.id);
          this.onEvent?.({ event: "TOOL_SELECTED", detail: `WAITING_FOR_PROVIDER ${waitingForProvider.reason}` });
          stopGeneration = true;
          break;
        }
        if (!proposed?.length) {
          emptyProposals += 1;
          if (emptyProposals >= 3) {
            waitingForProvider = { reason: "NO_ELIGIBLE_PROVIDER" };
            moduleProgress.push({ id: mod.id, name: mod.name, status: "waiting", files: moduleFiles });
            failedOrWaiting.add(mod.id);
            this.onEvent?.({
              event: "TOOL_SELECTED",
              detail: "WAITING_FOR_PROVIDER after empty specialist responses (not project FAILED)",
            });
            stopGeneration = true;
            break;
          }
          continue;
        }
        emptyProposals = 0;
        const written = await this.applyFiles(input.workspaceId, proposed.slice(0, 2), {
          overwriteExisting: true,
          resume: true,
          existingCount: inspect.files.length,
        });
        moduleFiles.push(...written.paths);
        allWritten.push(...written.paths);
        if (written.error) {
          moduleProgress.push({ id: mod.id, name: mod.name, status: "failed", files: moduleFiles });
          failedOrWaiting.add(mod.id);
          break;
        }
      }

      if (moduleProgress.some((p) => p.id === mod.id)) {
        continue;
      }
        if (moduleFiles.length === 0) {
        moduleProgress.push({ id: mod.id, name: mod.name, status: "failed", files: [] });
        failedOrWaiting.add(mod.id);
        continue;
      }

      await this.maybeNpmInstall(input.workspaceId, moduleFiles, inspection.files);
      lastVerified = await this.verifyWithAutoFix(input.workspaceId);
      patches.push(...lastVerified.patchesApplied);
      const testsOk = lastVerified.report.tests === "PASSED";
      const buildFailed = lastVerified.report.build === "FAILED";
      const status: CodingModuleProgress["status"] = buildFailed
        ? "failed"
        : testsOk
          ? "verified"
          : "partial";
      moduleProgress.push({ id: mod.id, name: mod.name, status, files: moduleFiles });
      if (status === "failed") failedOrWaiting.add(mod.id);
      else satisfied.add(mod.id);
      this.onEvent?.({ event: "PATCH_APPLIED", detail: `${mod.name}=${status}` });
    }

    const files = await this.workspaces.listFiles(input.workspaceId);
    if (!lastVerified) {
      lastVerified = await this.verifyWithAutoFix(input.workspaceId);
    }
    const report = lastVerified.report;
    const anyFiles = allWritten.length > 0;
    const allVerified =
      moduleProgress.length > 0 && moduleProgress.every((m) => m.status === "verified");
    const waiting = Boolean(waitingForProvider);
    const success =
      !waiting &&
      anyFiles &&
      isStrictCodingSuccess(report, input.requestScale, {
        requireRealTests: goalRequiresRealTests(input.goal),
      }) &&
      allVerified;
    return {
      success,
      summary: [
        this.summarize(input.goal, report, files.length),
        `Modules: ${moduleProgress.map((m) => `${m.name}=${m.status}`).join(", ")}`,
        waiting ? `WAITING_FOR_PROVIDER ${waitingForProvider?.reason}` : "",
      ]
        .filter(Boolean)
        .join(" "),
      waitingForProvider,
      filesCreated: files,
      patchesApplied: [...allWritten, ...patches],
      moduleProgress,
      inspection,
      verification: {
        passed: lastVerified.passed,
        steps: lastVerified.steps.map((s) => ({
          name: s.name,
          passed: s.passed,
          details: s.details,
          outcome: s.outcome,
        })),
        report,
      },
      errors: anyFiles
        ? report.status === "FAILED"
          ? lastVerified.steps
              .filter((s) => s.outcome === "FAILED" || s.outcome === "TEST_ERROR")
              .map((s) => s.details ?? s.name)
          : undefined
        : ["NO_IMPLEMENTATION_FILES"],
    };
  }

  private async readRelevant(
    workspaceId: string,
    existing: string[],
    chunk: Array<{ path: string }>,
  ): Promise<string> {
    const wanted = new Set(chunk.map((c) => c.path));
    const related = existing.filter(
      (f) =>
        wanted.has(f) ||
        /package\.json$|tsconfig|schema|auth|store|db\./i.test(f),
    );
    const parts: string[] = [];
    for (const path of related.slice(0, 6)) {
      try {
        const body = await this.workspaces.readFile(workspaceId, path);
        parts.push(`--- ${path} ---\n${body.slice(0, 1200)}`);
      } catch {
        /* missing */
      }
    }
    return parts.length ? `Relevant files:\n${parts.join("\n")}` : "";
  }

  private async applyFiles(
    workspaceId: string,
    proposed: Array<{ path: string; content: string; purpose?: string; operation?: "create" | "edit" | "delete" }>,
    opts: { overwriteExisting?: boolean; resume?: boolean; existingCount: number },
  ): Promise<{ paths: string[]; error?: string }> {
    const written: string[] = [];
    for (const file of proposed) {
      if (!file.path || file.path.includes("\0") || file.path.includes("..") || file.path.startsWith("/")) {
        continue;
      }
      const operation = file.operation ?? "create";
      if (operation === "delete") {
        try {
          await this.workspaces.deleteFile(workspaceId, file.path);
          written.push(`${file.path} (deleted)`);
        } catch (err) {
          return { paths: written, error: err instanceof Error ? err.message : String(err) };
        }
        continue;
      }
      if (!opts.overwriteExisting && !opts.resume && operation !== "edit") {
        const exists = await this.workspaces.fileExists?.(workspaceId, file.path);
        if (exists && opts.existingCount > 2) continue;
      }
      try {
        await this.workspaces.writeFile(workspaceId, file.path, file.content);
        written.push(file.path);
        this.onEvent?.({ event: "PATCH_APPLIED", path: file.path, detail: file.purpose });
      } catch (err) {
        return { paths: written, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return { paths: written };
  }

  private async maybeNpmInstall(
    workspaceId: string,
    written: string[],
    existing: string[],
  ): Promise<void> {
    const hasPkg = written.includes("package.json") || existing.some((f) => f.endsWith("package.json"));
    if (!hasPkg) return;
    let needsInstall = true;
    try {
      const raw = await this.workspaces.readFile(workspaceId, "package.json");
      const pkg = JSON.parse(raw) as { dependencies?: object; devDependencies?: object };
      needsInstall = Boolean(
        (pkg.dependencies && Object.keys(pkg.dependencies).length) ||
          (pkg.devDependencies && Object.keys(pkg.devDependencies).length),
      );
    } catch {
      needsInstall = true;
    }
    if (!needsInstall) return;
    this.onEvent?.({ event: "RETRY_STARTED", detail: "npm install (workspace-isolated env)" });
    await this.workspaces.exec(workspaceId, "npm install --ignore-scripts", {
      timeoutMs: Number(process.env.NPM_INSTALL_TIMEOUT_MS ?? 300_000),
    });
  }

  private summarize(
    description: string,
    report: CodeVerificationReport,
    fileCount: number,
  ): string {
    const base = `Workspace (${fileCount} entries). build=${report.build} tests=${report.tests} security=${report.security} status=${report.status} attempts=${report.attempts}.`;
    const quality =
      report.modelQuality === "MODEL_QUALITY_NOT_VERIFIED"
        ? " MODEL_QUALITY_NOT_VERIFIED (script ran ≠ model scientifically verified)."
        : "";
    return `${base}${quality} ${description}`;
  }
}

function isHeavySource(path: string): boolean {
  return /\.(js|mjs|cjs|ts|tsx|sql|json)$/i.test(path);
}

/** One JS/SQL file per call so JSON output stays within provider limits. */
export function chunkGenerationTargets<T extends { path: string }>(files: T[]): T[][] {
  const chunks: T[][] = [];
  for (const file of files) {
    if (isHeavySource(file.path)) {
      chunks.push([file]);
      continue;
    }
    const last = chunks[chunks.length - 1];
    if (last && last.length < 2 && last.every((f) => !isHeavySource(f.path))) {
      last.push(file);
    } else {
      chunks.push([file]);
    }
  }
  return chunks;
}
