import type { CodingWorkspace } from "./coding-workspace.js";

export type PythonEnvCapability =
  | "READY"
  | "PIP_UNAVAILABLE"
  | "PYTEST_UNAVAILABLE"
  | "PYTHON_UNAVAILABLE";

/** Probe Python toolchain inside a workspace without claiming success. */
export async function probePythonEnvironment(
  workspaceId: string,
  workspaces: CodingWorkspace,
): Promise<{ capability: PythonEnvCapability; detail: string }> {
  const py = await workspaces.exec(workspaceId, "python3 --version", { timeoutMs: 15_000 });
  if (py.timedOut || py.exitCode !== 0) {
    return {
      capability: "PYTHON_UNAVAILABLE",
      detail: (py.stderr || py.stdout || "python3 not available").slice(0, 200),
    };
  }
  const pip = await workspaces.exec(workspaceId, "python3 -m pip --version", { timeoutMs: 15_000 });
  if (pip.timedOut || pip.exitCode !== 0) {
    return {
      capability: "PIP_UNAVAILABLE",
      detail: (pip.stderr || pip.stdout || "python3 -m pip not available").slice(0, 200),
    };
  }
  const pytest = await workspaces.exec(workspaceId, "python3 -m pytest --version", {
    timeoutMs: 15_000,
  });
  if (pytest.timedOut || pytest.exitCode !== 0) {
    return {
      capability: "PYTEST_UNAVAILABLE",
      detail: (pytest.stderr || pytest.stdout || "pytest not available").slice(0, 200),
    };
  }
  return { capability: "READY", detail: "python3 + pip + pytest available" };
}
