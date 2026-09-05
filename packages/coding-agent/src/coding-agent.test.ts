import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodingAgent, chunkGenerationTargets } from "./coding-agent.js";
import { LocalCodingWorkspace } from "./local-workspace.js";

describe("CodingAgent.implement", () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "pai-agent-"));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes proposed files then reports honestly when tests are missing", async () => {
    const ws = new LocalCodingWorkspace({ rootDir: join(dir, "root") });
    const created = await ws.create("u1", "app");
    const agent = new CodingAgent(ws, undefined, {
      proposeFiles: async () => [
        {
          path: "package.json",
          content: JSON.stringify({ name: "demo", private: true, scripts: {} }),
          purpose: "manifest",
        },
        {
          path: "README.md",
          content: "# Demo\nImplemented via CodingAgent.\n",
          purpose: "docs",
        },
      ],
    });

    const result = await agent.implement({ workspaceId: created.id, goal: "tiny app" });
    assert.ok(result.filesCreated?.some((f) => f.includes("package.json") || f === "package.json"));
    assert.ok(result.inspection?.summary);
    assert.notEqual(result.verification?.report?.status, "VERIFIED");
  });

  it("refuses to pretend a template when proposeFiles is missing", async () => {
    const ws = new LocalCodingWorkspace({ rootDir: join(dir, "root2") });
    const created = await ws.create("u1", "app");
    const agent = new CodingAgent(ws);
    const result = await agent.implement({ workspaceId: created.id, goal: "full app" });
    assert.equal(result.success, false);
    assert.match(result.summary, /no file proposer/i);
  });

  it("implements FULL_APPLICATION in module chunks instead of one dump", async () => {
    const ws = new LocalCodingWorkspace({ rootDir: join(dir, "root3") });
    const created = await ws.create("u1", "app");
    const calls: string[] = [];
    const agent = new CodingAgent(ws, undefined, {
      proposeFiles: async ({ moduleName, targetFiles }) => {
        calls.push(moduleName ?? "none");
        const path = targetFiles?.[0]?.path ?? "src/a.js";
        return [
          {
            path,
            operation: "create",
            content: "module.exports = {};\n",
            purpose: moduleName,
          },
        ];
      },
    });
    const result = await agent.implement({
      workspaceId: created.id,
      goal: "full app",
      requestScale: "FULL_APPLICATION",
      schedule: [
        {
          id: "M1",
          name: "Auth",
          dependsOn: [],
          requirements: ["login"],
          fileHints: ["auth.js"],
          acceptance: ["api: login"],
        },
        {
          id: "M2",
          name: "Users",
          dependsOn: ["M1"],
          requirements: ["users"],
          fileHints: ["users.js"],
          acceptance: ["api: users"],
        },
      ],
      fileManifest: {
        project: "app",
        files: [
          { path: "auth.js", purpose: "auth", module: "M1" },
          { path: "users.js", purpose: "users", module: "M2" },
        ],
      },
    });
    assert.ok(calls.includes("Auth"));
    assert.ok(calls.includes("Users"));
    assert.equal(calls.length, 2);
    assert.ok(result.moduleProgress?.length === 2);
    assert.ok(result.filesCreated?.some((f) => f.includes("auth.js")));
  });

  it("skips generate for files that already exist (idempotent resume)", async () => {
    const ws = new LocalCodingWorkspace({ rootDir: join(dir, "root-idem") });
    const created = await ws.create("u1", "app");
    await ws.writeFile(created.id, "auth.js", "module.exports = { login: true };\n");
    const calls: string[] = [];
    const agent = new CodingAgent(ws, undefined, {
      proposeFiles: async ({ moduleName, targetFiles }) => {
        calls.push(moduleName ?? "none");
        return [
          {
            path: targetFiles?.[0]?.path ?? "x.js",
            operation: "create",
            content: "SHOULD_NOT_OVERWRITE",
            purpose: moduleName,
          },
        ];
      },
    });
    await agent.implement({
      workspaceId: created.id,
      goal: "full app",
      requestScale: "FULL_APPLICATION",
      completedModuleIds: ["M1"],
      schedule: [
        {
          id: "M1",
          name: "Auth",
          dependsOn: [],
          requirements: ["login"],
          fileHints: ["auth.js"],
          acceptance: ["api: login"],
        },
        {
          id: "M2",
          name: "Users",
          dependsOn: ["M1"],
          requirements: ["users"],
          fileHints: ["users.js"],
          acceptance: ["api: users"],
        },
      ],
      fileManifest: {
        project: "app",
        files: [
          { path: "auth.js", purpose: "auth", module: "M1" },
          { path: "users.js", purpose: "users", module: "M2" },
        ],
      },
    });
    assert.equal(calls.includes("Auth"), false);
    assert.ok(calls.includes("Users"));
    const auth = await ws.readFile(created.id, "auth.js");
    assert.match(auth, /login: true/);
    assert.equal(auth.includes("SHOULD_NOT_OVERWRITE"), false);
  });

  it("WAITING_FOR_PROVIDER sentinel does not write implementation files", async () => {
    const ws = new LocalCodingWorkspace({ rootDir: join(dir, "root-wait") });
    const created = await ws.create("u1", "app");
    const agent = new CodingAgent(ws, undefined, {
      proposeFiles: async () => [
        {
          path: ".__wait",
          content: JSON.stringify({ reason: "groq rate limited", retryAt: "2099-01-01T00:00:00.000Z" }),
          purpose: "WAITING_FOR_PROVIDER",
        },
      ],
    });
    const result = await agent.implement({
      workspaceId: created.id,
      goal: "full app",
      requestScale: "FULL_APPLICATION",
      schedule: [
        {
          id: "M1",
          name: "Dash",
          dependsOn: [],
          requirements: ["dash"],
          fileHints: ["dash.js"],
          acceptance: ["page: dash"],
        },
      ],
      fileManifest: {
        project: "app",
        files: [{ path: "dash.js", purpose: "dash", module: "M1" }],
      },
    });
    assert.ok(result.waitingForProvider);
    assert.equal(result.moduleProgress?.[0]?.status, "waiting");
    assert.equal(result.success, false);
  });

  it("marks dependent modules blocked when a dependency failed", async () => {
    const ws = new LocalCodingWorkspace({ rootDir: join(dir, "root-block") });
    const created = await ws.create("u1", "app");
    const agent = new CodingAgent(ws, undefined, {
      proposeFiles: async ({ targetFiles }) => [
        {
          path: targetFiles?.[0]?.path ?? "x.js",
          content: "module.exports = {};\n",
          purpose: "gen",
        },
      ],
    });
    const result = await agent.implement({
      workspaceId: created.id,
      goal: "full app",
      requestScale: "FULL_APPLICATION",
      schedule: [
        {
          id: "M1",
          name: "Auth",
          dependsOn: [],
          requirements: ["login"],
          fileHints: [],
          acceptance: ["api: login"],
        },
        {
          id: "M2",
          name: "Users",
          dependsOn: ["M1"],
          requirements: ["users"],
          fileHints: ["users.js"],
          acceptance: ["api: users"],
        },
      ],
      fileManifest: {
        project: "app",
        files: [{ path: "users.js", purpose: "users", module: "M2" }],
      },
    });
    assert.equal(result.moduleProgress?.[0]?.status, "failed");
    assert.equal(result.moduleProgress?.[1]?.status, "blocked");
  });

  it("chunks JS files one-at-a-time", () => {
    const chunks = chunkGenerationTargets([
      { path: "src/a.js" },
      { path: "src/b.js" },
      { path: "public/x.html" },
      { path: "public/y.html" },
    ]);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0]?.length, 1);
    assert.equal(chunks[2]?.length, 2);
  });
});
