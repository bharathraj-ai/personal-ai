import type { CheckOutcome } from "@personal-ai/shared";
import type { CodingWorkspace } from "./coding-workspace.js";
import { pickVerificationPort, verificationPortEnv } from "./verification-port.js";
import {
  detectProjectType,
  hasBehavioralTestSignal,
  isNodeTestFile,
  isPlaceholderTestCommand,
  isPythonTestFile,
  isVacuousTestSource,
} from "./verification-project.js";
import { inspectWorkspace } from "./inspect-workspace.js";
import { probePythonEnvironment } from "./python-env.js";

export interface VerificationStep {
  name: string;
  passed: boolean;
  outcome: CheckOutcome;
  details?: string;
}

export interface CodeVerificationReport {
  status: "VERIFIED" | "UNCERTAIN" | "FAILED" | "NOT_VERIFIED";
  build: CheckOutcome;
  tests: CheckOutcome;
  runtime: CheckOutcome;
  security: CheckOutcome;
  attempts: number;
  modelQuality?: "MODEL_QUALITY_NOT_VERIFIED" | "NOT_APPLICABLE";
  verificationPort?: number;
}

export interface VerificationPipelineResult {
  passed: boolean;
  steps: VerificationStep[];
  retriesUsed: number;
  report: CodeVerificationReport;
}

function hasTestScript(pkgJson: string): boolean {
  try {
    const pkg = JSON.parse(pkgJson) as { scripts?: Record<string, string> };
    const script = pkg.scripts?.test ?? "";
    if (!script.trim()) return false;
    return !isPlaceholderTestCommand(script);
  } catch {
    return false;
  }
}

function hasBuildScript(pkgJson: string): boolean {
  try {
    const pkg = JSON.parse(pkgJson) as { scripts?: Record<string, string> };
    return Boolean(pkg.scripts?.build?.trim());
  } catch {
    return false;
  }
}

function isVacuousNpmTest(pkgJson: string, output: string, files: string[]): boolean {
  try {
    const pkg = JSON.parse(pkgJson) as { scripts?: Record<string, string> };
    if (isPlaceholderTestCommand(pkg.scripts?.test ?? "")) return true;
  } catch {
    /* ignore */
  }
  const testFiles = files.filter(isNodeTestFile);
  if (testFiles.length === 0) return true;
  if (/No tests specified|echo .*No tests/i.test(output)) return true;
  return false;
}

async function readTestContents(
  workspaceId: string,
  workspaces: CodingWorkspace,
  files: string[],
  filter: (f: string) => boolean,
): Promise<string[]> {
  const bodies: string[] = [];
  for (const f of files.filter(filter).slice(0, 8)) {
    try {
      bodies.push(await workspaces.readFile(workspaceId, f));
    } catch {
      /* skip */
    }
  }
  return bodies;
}

/**
 * Code verification pipeline — runs real checks inside the workspace.
 * Distinguishes NO_TESTS / NOT_IMPLEMENTED from PASSED.
 */
export class VerificationPipeline {
  constructor(private readonly maxRetries = 3) {}

  async verify(
    workspaceId: string,
    workspaces?: CodingWorkspace,
    attempts = 1,
  ): Promise<VerificationPipelineResult> {
    const steps: VerificationStep[] = [];

    if (!workspaces) {
      const report: CodeVerificationReport = {
        status: "FAILED",
        build: "NOT_RUN",
        tests: "NOT_RUN",
        runtime: "NOT_RUN",
        security: "NOT_IMPLEMENTED",
        attempts,
      };
      return {
        passed: false,
        steps: [{ name: "workspace", passed: false, outcome: "FAILED", details: "No workspace manager" }],
        retriesUsed: 0,
        report,
      };
    }

    const exists = workspaces.fileExists?.bind(workspaces);
    const inspection = await inspectWorkspace(workspaces, workspaceId);
    const files = inspection.files;
    const detected = detectProjectType(files);
    let verificationPort: number | undefined;

    steps.push({
      name: "project_structure",
      passed: detected.type !== "unsupported",
      outcome: detected.type !== "unsupported" ? "PASSED" : "FAILED",
      details:
        detected.type === "node"
          ? "Node.js project detected"
          : detected.type === "python"
            ? "Python project detected"
            : "Unsupported or empty project layout",
    });

    let buildOutcome: CheckOutcome = "NOT_RUN";
    let testsOutcome: CheckOutcome = "NOT_RUN";

    if (detected.type === "node") {
      let pkgText = "";
      try {
        pkgText = await workspaces.readFile(workspaceId, "package.json");
      } catch {
        pkgText = "";
      }
      const canBuild = hasBuildScript(pkgText);
      const canTest = hasTestScript(pkgText);
      const hasNodeModules = exists ? await exists(workspaceId, "node_modules") : false;

      let needsInstall = false;
      try {
        const pkg = JSON.parse(pkgText) as { dependencies?: object; devDependencies?: object };
        needsInstall = Boolean(
          Object.keys(pkg.dependencies ?? {}).length ||
            Object.keys(pkg.devDependencies ?? {}).length,
        );
      } catch {
        needsInstall = false;
      }

      if (needsInstall && !hasNodeModules) {
        const installTimeoutMs = Number(process.env.NPM_INSTALL_TIMEOUT_MS ?? 300_000);
        const install = await workspaces.exec(workspaceId, "npm install --ignore-scripts", {
          timeoutMs: installTimeoutMs,
        });
        if (install.timedOut || install.exitCode !== 0) {
          buildOutcome = "FAILED";
          steps.push({
            name: "dependencies",
            passed: false,
            outcome: "FAILED",
            details: `npm install failed: ${(install.stderr || install.stdout).slice(0, 400)}`,
          });
        } else {
          steps.push({
            name: "dependencies",
            passed: true,
            outcome: "PASSED",
            details: "npm install completed",
          });
        }
      }

      if (buildOutcome !== "FAILED") {
        if (!canBuild) {
          buildOutcome = "SKIPPED";
          steps.push({
            name: "build",
            passed: true,
            outcome: "SKIPPED",
            details: "No build script configured",
          });
        } else {
          const build = await workspaces.exec(workspaceId, "npm run build", { timeoutMs: 120_000 });
          buildOutcome = build.timedOut || build.exitCode !== 0 ? "FAILED" : "PASSED";
          steps.push({
            name: "build",
            passed: buildOutcome === "PASSED",
            outcome: buildOutcome,
            details: build.timedOut
              ? "Build timed out"
              : buildOutcome === "PASSED"
                ? "npm run build passed"
                : (build.stderr || build.stdout).slice(0, 500),
          });
        }
      }

      if (buildOutcome !== "FAILED") {
        if (!canTest) {
          testsOutcome = "NO_TESTS";
          steps.push({
            name: "unit_tests",
            passed: false,
            outcome: "NO_TESTS",
            details: "NO_TESTS — no real test script configured",
          });
        } else {
          const testBodies = await readTestContents(workspaceId, workspaces, files, isNodeTestFile);
          if (
            testBodies.length === 0 ||
            testBodies.every((b) => isVacuousTestSource(b) || !hasBehavioralTestSignal(b))
          ) {
            testsOutcome = "NO_TESTS";
            steps.push({
              name: "unit_tests",
              passed: false,
              outcome: "NO_TESTS",
              details: "NO_TESTS — no behavioral test files found",
            });
          } else {
            try {
              verificationPort = await pickVerificationPort();
              steps.push({
                name: "verification_port",
                passed: true,
                outcome: "PASSED",
                details: `verification port ${verificationPort}`,
              });
            } catch (err) {
              testsOutcome = "TEST_ERROR";
              steps.push({
                name: "verification_port",
                passed: false,
                outcome: "TEST_ERROR",
                details: err instanceof Error ? err.message : String(err),
              });
            }

            if (testsOutcome !== "TEST_ERROR") {
              const test = await workspaces.exec(workspaceId, "npm test", {
                timeoutMs: 120_000,
                env: verificationPortEnv(verificationPort!),
              });
              if (test.timedOut) {
                testsOutcome = "TEST_ERROR";
              } else if (
                test.exitCode === 0 &&
                isVacuousNpmTest(pkgText, test.stdout + test.stderr, files)
              ) {
                testsOutcome = "NO_TESTS";
              } else if (test.exitCode === 0) {
                testsOutcome = "PASSED";
              } else {
                testsOutcome = "FAILED";
              }
              steps.push({
                name: "unit_tests",
                passed: testsOutcome === "PASSED",
                outcome: testsOutcome,
                details: test.timedOut
                  ? "Tests timed out"
                  : testsOutcome === "NO_TESTS"
                    ? "NO_TESTS — vacuous or missing behavioral assertions"
                    : testsOutcome === "PASSED"
                      ? `TESTS_PASSED on port ${verificationPort}`
                      : (test.stderr || test.stdout).slice(0, 500),
              });
            }
          }
        }
      }
    } else if (detected.type === "python") {
      buildOutcome = "SKIPPED";
      steps.push({
        name: "build",
        passed: true,
        outcome: "SKIPPED",
        details: "Python project — compile via tests",
      });

      const pyFiles = files.filter((f) => f.endsWith(".py") && !f.includes("node_modules"));
      const testFiles = pyFiles.filter(isPythonTestFile);
      const hasRequirements = files.some(
        (f) => f === "requirements.txt" || f.endsWith("/requirements.txt"),
      );
      const hasPyProject = files.some(
        (f) => f === "pyproject.toml" || f.endsWith("/pyproject.toml"),
      );

      if (testFiles.length === 0) {
        testsOutcome = "NO_TESTS";
        steps.push({
          name: "unit_tests",
          passed: false,
          outcome: "NO_TESTS",
          details: "NO_TESTS — no pytest files found",
        });
      } else {
        const testBodies = await readTestContents(workspaceId, workspaces, files, isPythonTestFile);
        if (testBodies.some(isVacuousTestSource) || !testBodies.some(hasBehavioralTestSignal)) {
          testsOutcome = "NO_TESTS";
          steps.push({
            name: "unit_tests",
            passed: false,
            outcome: "NO_TESTS",
            details: "NO_TESTS — vacuous or non-behavioral Python tests",
          });
        } else if (hasRequirements) {
          const envProbe = await probePythonEnvironment(workspaceId, workspaces);
          if (envProbe.capability !== "READY") {
            buildOutcome = "FAILED";
            testsOutcome = "FAILED";
            steps.push({
              name: "dependencies",
              passed: false,
              outcome: "FAILED",
              details: `ENV_CAPABILITY_FAILURE: ${envProbe.capability} — ${envProbe.detail}`,
            });
          } else {
            const install = await workspaces.exec(
              workspaceId,
              "python3 -m pip install -r requirements.txt -q",
              { timeoutMs: 120_000 },
            );
            if (install.timedOut || install.exitCode !== 0) {
              buildOutcome = "FAILED";
              testsOutcome = "FAILED";
              steps.push({
                name: "dependencies",
                passed: false,
                outcome: "FAILED",
                details: `pip install failed: ${(install.stderr || install.stdout).slice(0, 400)}`,
              });
            } else {
              steps.push({
                name: "dependencies",
                passed: true,
                outcome: "PASSED",
                details: "pip install completed",
              });
            }
          }
        } else if (hasPyProject) {
          steps.push({
            name: "dependencies",
            passed: true,
            outcome: "SKIPPED",
            details: "pyproject.toml present — assuming environment ready",
          });
        }

        if (testsOutcome !== "NO_TESTS" && buildOutcome !== "FAILED") {
          const test = await workspaces.exec(workspaceId, "python3 -m pytest -q", {
            timeoutMs: 120_000,
          });
          if (test.timedOut) testsOutcome = "TEST_ERROR";
          else if (test.exitCode === 0) testsOutcome = "PASSED";
          else testsOutcome = "FAILED";
          steps.push({
            name: "unit_tests",
            passed: testsOutcome === "PASSED",
            outcome: testsOutcome,
            details: (test.stderr || test.stdout).slice(0, 500),
          });
        }
      }
    } else {
      buildOutcome = "FAILED";
      testsOutcome = "NOT_RUN";
      steps.push({
        name: "build",
        passed: false,
        outcome: "FAILED",
        details: "Unsupported project type for automated verification",
      });
    }

    steps.push({
      name: "security_checks",
      passed: true,
      outcome: "NOT_IMPLEMENTED",
      details: "NOT_IMPLEMENTED — path sandbox only; no SCA executed",
    });

    const report = this.buildReport(buildOutcome, testsOutcome, attempts, verificationPort);
    const criticalFail = steps.some(
      (s) =>
        (s.name === "project_structure" ||
          s.name === "build" ||
          s.name === "dependencies") &&
        s.outcome === "FAILED",
    );

    return {
      passed: !criticalFail && testsOutcome === "PASSED",
      steps,
      retriesUsed: 0,
      report,
    };
  }

  buildReport(
    build: CheckOutcome,
    tests: CheckOutcome,
    attempts: number,
    verificationPort?: number,
  ): CodeVerificationReport {
    let status: CodeVerificationReport["status"];
    if (build === "FAILED" || tests === "FAILED" || tests === "TEST_ERROR") {
      status = "FAILED";
    } else if (tests === "NO_TESTS" || tests === "TEST_NOT_CONFIGURED") {
      status = build === "PASSED" || build === "SKIPPED" ? "UNCERTAIN" : "NOT_VERIFIED";
    } else if (tests === "PASSED") {
      status = "VERIFIED";
    } else {
      status = "NOT_VERIFIED";
    }

    return {
      status,
      build,
      tests,
      runtime: "NOT_RUN",
      security: "NOT_IMPLEMENTED",
      attempts,
      modelQuality: "MODEL_QUALITY_NOT_VERIFIED",
      verificationPort,
    };
  }

  get maxRetryCount(): number {
    return this.maxRetries;
  }
}
