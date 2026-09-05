import { ToolPermissionLevel, type ToolResult } from "@personal-ai/shared";
import type { CodingWorkspace } from "@personal-ai/coding-agent";
import type { ToolHandler } from "./registry.js";

export interface CodingToolsDeps {
  /** Provider-agnostic workspace — never depend on LocalWorkspaceManager here. */
  workspaces: CodingWorkspace;
  /** Resolves active workspace for the current request; falls back to args.workspaceId */
  getWorkspaceId?: () => string | undefined;
  /** Authenticated user for create_workspace ownership. */
  getUserId?: () => string | undefined;
  /** Called when a workspace is created so the gateway can activate it. */
  onWorkspaceCreated?: (workspaceId: string, projectName: string) => void;
}

function resolveWorkspaceId(
  deps: CodingToolsDeps,
  args: Record<string, unknown>,
): string | undefined {
  return (
    (typeof args.workspaceId === "string" ? args.workspaceId : undefined) ??
    deps.getWorkspaceId?.()
  );
}

/**
 * Coding tools — operate only through CodingWorkspace (path-bounded local or future providers).
 * LOCAL WORKSPACE ≠ CLOUD SANDBOX
 */
export function createCodingTools(deps: CodingToolsDeps): ToolHandler[] {
  const needWs = (feature: string): ToolResult => ({
    success: false,
    output: null,
    error: `${feature}: no active workspace. Create one via POST /workspaces first.`,
  });

  return [
    {
      definition: {
        name: "create_project",
        description:
          "Create a named project workspace (alias for create_workspace). Use for new coding projects.",
        parameters: {
          type: "object",
          properties: {
            projectName: { type: "string" },
            description: { type: "string" },
          },
          required: ["projectName"],
        },
        permissionLevel: ToolPermissionLevel.WRITE,
      },
      async execute(args) {
        const userId = deps.getUserId?.();
        if (!userId) {
          return {
            success: false,
            output: null,
            error: "create_project requires authenticated user context",
          };
        }
        const projectName = String(args.projectName ?? "project").trim() || "project";
        try {
          const ws = await deps.workspaces.create(userId, projectName);
          deps.onWorkspaceCreated?.(ws.id, ws.projectName);
          return {
            success: true,
            output: {
              projectName: ws.projectName,
              workspaceId: ws.id,
              description: args.description ?? null,
              isolation: "path-boundary-only",
            },
          };
        } catch (err) {
          return {
            success: false,
            output: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    },
    {
      definition: {
        name: "create_workspace",
        description:
          "Create (or reuse) an isolated coding workspace for a project name. Prefer this over host Desktop/Downloads.",
        parameters: {
          type: "object",
          properties: {
            projectName: { type: "string" },
            forceNew: {
              type: "boolean",
              description: "Always create a new workspace ID (required for acceptance runs)",
            },
          },
          required: ["projectName"],
        },
        permissionLevel: ToolPermissionLevel.WRITE,
      },
      async execute(args) {
        const userId = deps.getUserId?.();
        if (!userId) {
          return {
            success: false,
            output: null,
            error: "create_workspace requires authenticated user context",
          };
        }
        const projectName = String(args.projectName ?? "project").trim() || "project";
        const forceNew = args.forceNew === true;
        try {
          if (!forceNew) {
            // Reuse existing active workspace with same project name when possible.
            // Skip legacy UUID folder ids so new runs get human-readable project folders.
            const existing = deps.workspaces.list?.(userId)?.find(
              (w) =>
                w.status === "active" &&
                w.projectName.toLowerCase() === projectName.toLowerCase() &&
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(w.id),
            );
            if (existing) {
              deps.onWorkspaceCreated?.(existing.id, existing.projectName);
              return {
                success: true,
                output: {
                  workspaceId: existing.id,
                  projectName: existing.projectName,
                  reused: true,
                  isolation: "path-boundary-only",
                },
              };
            }
          }
          const ws = await deps.workspaces.create(userId, projectName);
          deps.onWorkspaceCreated?.(ws.id, ws.projectName);
          return {
            success: true,
            output: {
              workspaceId: ws.id,
              projectName: ws.projectName,
              reused: false,
              isolation: "path-boundary-only",
              note: "LOCAL WORKSPACE ≠ CLOUD SANDBOX",
            },
          };
        } catch (err) {
          return {
            success: false,
            output: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    },
    {
      definition: {
        name: "create_directory",
        description: "Create a directory in the coding workspace",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            workspaceId: { type: "string" },
          },
          required: ["path"],
        },
        permissionLevel: ToolPermissionLevel.WRITE,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("create_directory");
        try {
          await deps.workspaces.createDirectory(id, String(args.path));
          return { success: true, output: { path: args.path } };
        } catch (err) {
          return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    {
      definition: {
        name: "read_file",
        description: "Read a file from the coding workspace",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            workspaceId: { type: "string" },
          },
          required: ["path"],
        },
        permissionLevel: ToolPermissionLevel.READ,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("read_file");
        try {
          const content = await deps.workspaces.readFile(id, String(args.path));
          return { success: true, output: { path: args.path, content } };
        } catch (err) {
          return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    {
      definition: {
        name: "create_file",
        description: "Create a new file in the coding workspace",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            workspaceId: { type: "string" },
          },
          required: ["path", "content"],
        },
        permissionLevel: ToolPermissionLevel.WRITE,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("create_file");
        try {
          await deps.workspaces.writeFile(id, String(args.path), String(args.content ?? ""));
          return { success: true, output: { path: args.path, bytes: String(args.content ?? "").length } };
        } catch (err) {
          return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    {
      definition: {
        name: "edit_file",
        description: "Edit an existing file in the coding workspace",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            workspaceId: { type: "string" },
          },
          required: ["path", "content"],
        },
        permissionLevel: ToolPermissionLevel.WRITE,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("edit_file");
        try {
          if (deps.workspaces.editFile) {
            await deps.workspaces.editFile(id, String(args.path), String(args.content ?? ""), {
              createIfMissing: true,
            });
          } else {
            await deps.workspaces.writeFile(id, String(args.path), String(args.content ?? ""));
          }
          return { success: true, output: { path: args.path, updated: true } };
        } catch (err) {
          return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    {
      definition: {
        name: "list_files",
        description: "List files in a workspace directory",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            workspaceId: { type: "string" },
          },
        },
        permissionLevel: ToolPermissionLevel.READ,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("list_files");
        try {
          const files = await deps.workspaces.listFiles(id, String(args.path ?? "."));
          return { success: true, output: { path: args.path ?? ".", files } };
        } catch (err) {
          return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    {
      definition: {
        name: "run_command",
        description: "Run a shell command inside the workspace (timeout-limited)",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
            workspaceId: { type: "string" },
          },
          required: ["command"],
        },
        permissionLevel: ToolPermissionLevel.EXECUTE,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("run_command");
        try {
          const result = await deps.workspaces.exec(id, String(args.command));
          return {
            success: result.exitCode === 0 && !result.timedOut,
            output: result,
            error: result.timedOut
              ? "Command timed out"
              : result.exitCode !== 0
                ? `Exit code ${result.exitCode}`
                : undefined,
          };
        } catch (err) {
          return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    {
      definition: {
        name: "install_dependency",
        description:
          "Install dependencies in the workspace (npm packages or pip packages via python -m pip)",
        parameters: {
          type: "object",
          properties: {
            manager: { type: "string", description: "npm | pip" },
            packages: { type: "array", items: { type: "string" } },
            workspaceId: { type: "string" },
          },
          required: ["manager"],
        },
        permissionLevel: ToolPermissionLevel.EXECUTE,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("install_dependency");
        const manager = String(args.manager ?? "npm").toLowerCase();
        const packages = Array.isArray(args.packages) ? args.packages.map(String) : [];
        const command =
          manager === "pip"
            ? packages.length
              ? `python3 -m pip install ${packages.join(" ")}`
              : "python3 -m pip install -r requirements.txt"
            : packages.length
              ? `npm install ${packages.join(" ")}`
              : "npm install";
        try {
          const result = await deps.workspaces.exec(id, command, { timeoutMs: 180_000 });
          return {
            success: result.exitCode === 0 && !result.timedOut,
            output: result,
            error: result.exitCode !== 0 ? (result.stderr || result.stdout).slice(0, 500) : undefined,
          };
        } catch (err) {
          return {
            success: false,
            output: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    },
    {
      definition: {
        name: "install_dependency",
        description:
          "Install dependencies in the workspace (npm packages or pip packages via python -m pip)",
        parameters: {
          type: "object",
          properties: {
            manager: { type: "string", description: "npm | pip" },
            packages: { type: "array", items: { type: "string" } },
            workspaceId: { type: "string" },
          },
          required: ["manager"],
        },
        permissionLevel: ToolPermissionLevel.EXECUTE,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("install_dependency");
        const manager = String(args.manager ?? "npm").toLowerCase();
        const packages = Array.isArray(args.packages) ? args.packages.map(String) : [];
        const command =
          manager === "pip"
            ? packages.length
              ? `python3 -m pip install ${packages.join(" ")}`
              : "python3 -m pip install -r requirements.txt"
            : packages.length
              ? `npm install ${packages.join(" ")}`
              : "npm install";
        try {
          const result = await deps.workspaces.exec(id, command, { timeoutMs: 180_000 });
          return {
            success: result.exitCode === 0 && !result.timedOut,
            output: result,
            error: result.exitCode !== 0 ? (result.stderr || result.stdout).slice(0, 500) : undefined,
          };
        } catch (err) {
          return {
            success: false,
            output: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    },
    {
      definition: {
        name: "npm_install",
        description: "Install npm dependencies in the coding workspace",
        parameters: {
          type: "object",
          properties: {
            packages: { type: "array", items: { type: "string" } },
            workspaceId: { type: "string" },
          },
        },
        permissionLevel: ToolPermissionLevel.EXECUTE,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("npm_install");
        const packages = Array.isArray(args.packages) ? args.packages.map(String) : [];
        const command = packages.length > 0 ? `npm install ${packages.join(" ")}` : "npm install";
        try {
          const result = await deps.workspaces.exec(id, command, { timeoutMs: 180_000 });
          return {
            success: result.exitCode === 0 && !result.timedOut,
            output: result,
            error: result.exitCode !== 0 ? result.stderr.slice(0, 500) : undefined,
          };
        } catch (err) {
          return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    {
      definition: {
        name: "run_tests",
        description: "Run project tests in the coding workspace",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
            workspaceId: { type: "string" },
          },
        },
        permissionLevel: ToolPermissionLevel.EXECUTE,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("run_tests");
        let command = typeof args.command === "string" && args.command.trim() ? String(args.command) : "";
        if (!command) {
          try {
            const pkg = await deps.workspaces.readFile(id, "package.json");
            const parsed = JSON.parse(pkg) as { scripts?: Record<string, string> };
            if (parsed.scripts?.test) command = "npm test";
          } catch {
            /* no package.json */
          }
        }
        if (!command) {
          const files = await deps.workspaces.listFiles(id);
          const hasPyTests =
            files.some((f) => f.startsWith("test_") || f.includes("/test_")) ||
            files.includes("tests/") ||
            (await deps.workspaces.fileExists?.(id, "pytest.ini"));
          if (hasPyTests) command = "python3 -m pytest -q";
        }
        if (!command) {
          return {
            success: true,
            output: {
              outcome: "NO_TESTS",
              note: "NO_TESTS — no test script configured (not TESTS_PASSED)",
            },
          };
        }
        try {
          const result = await deps.workspaces.exec(id, command, { timeoutMs: 120_000 });
          const outcome = result.timedOut
            ? "TEST_ERROR"
            : result.exitCode === 0
              ? "TESTS_PASSED"
              : "TESTS_FAILED";
          return {
            success: result.exitCode === 0 && !result.timedOut,
            output: { ...result, outcome },
            error:
              result.exitCode !== 0
                ? (result.stderr || result.stdout).slice(0, 500)
                : undefined,
          };
        } catch (err) {
          return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    {
      definition: {
        name: "run_build",
        description: "Build the project in the coding workspace",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
            workspaceId: { type: "string" },
          },
        },
        permissionLevel: ToolPermissionLevel.EXECUTE,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("run_build");
        let command = typeof args.command === "string" && args.command.trim() ? String(args.command) : "";
        if (!command) {
          try {
            const pkg = await deps.workspaces.readFile(id, "package.json");
            const parsed = JSON.parse(pkg) as { scripts?: Record<string, string> };
            if (parsed.scripts?.build) command = "npm run build";
            else {
              return {
                success: true,
                output: { outcome: "SKIPPED", note: "No build script configured" },
              };
            }
          } catch {
            return {
              success: true,
              output: { outcome: "SKIPPED", note: "No package.json build" },
            };
          }
        }
        try {
          const result = await deps.workspaces.exec(id, command, { timeoutMs: 180_000 });
          return {
            success: result.exitCode === 0 && !result.timedOut,
            output: {
              ...result,
              outcome:
                result.exitCode === 0 && !result.timedOut ? "BUILD_PASSED" : "BUILD_FAILED",
            },
            error: result.exitCode !== 0 ? (result.stderr || result.stdout).slice(0, 500) : undefined,
          };
        } catch (err) {
          return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    {
      definition: {
        name: "delete_file",
        description: "Delete a file in the coding workspace",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            workspaceId: { type: "string" },
          },
          required: ["path"],
        },
        permissionLevel: ToolPermissionLevel.HIGH_RISK,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("delete_file");
        try {
          await deps.workspaces.deleteFile(id, String(args.path));
          return { success: true, output: { path: args.path, deleted: true } };
        } catch (err) {
          return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    {
      definition: {
        name: "push_git",
        description: "Push git commits to remote — requires explicit user approval",
        parameters: {
          type: "object",
          properties: {
            remote: { type: "string" },
            branch: { type: "string" },
            workspaceId: { type: "string" },
          },
        },
        permissionLevel: ToolPermissionLevel.HIGH_RISK,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("push_git");
        const remote = String(args.remote ?? "origin");
        const branch = String(args.branch ?? "main");
        try {
          const result = await deps.workspaces.exec(id, `git push ${remote} ${branch}`);
          return {
            success: result.exitCode === 0,
            output: result,
            error: result.exitCode !== 0 ? result.stderr.slice(0, 500) : undefined,
          };
        } catch (err) {
          return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    {
      definition: {
        name: "git_diff",
        description: "Show git diff in the workspace (staged and unstaged)",
        parameters: {
          type: "object",
          properties: {
            staged: { type: "boolean", description: "Show staged changes only" },
            workspaceId: { type: "string" },
          },
        },
        permissionLevel: ToolPermissionLevel.READ,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("git_diff");
        const cmd = args.staged ? "git diff --cached" : "git diff";
        try {
          const result = await deps.workspaces.exec(id, cmd);
          return {
            success: result.exitCode === 0 || result.stdout.length > 0,
            output: { ...result, diff: result.stdout || result.stderr },
          };
        } catch (err) {
          return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    {
      definition: {
        name: "git_status",
        description: "Show git status in the workspace",
        parameters: {
          type: "object",
          properties: { workspaceId: { type: "string" } },
        },
        permissionLevel: ToolPermissionLevel.READ,
      },
      async execute(args) {
        const id = resolveWorkspaceId(deps, args);
        if (!id) return needWs("git_status");
        try {
          const result = await deps.workspaces.exec(id, "git status --short");
          return { success: result.exitCode === 0, output: result };
        } catch (err) {
          return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
  ];
}
