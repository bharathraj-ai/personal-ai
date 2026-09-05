import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalWorkspaceManager } from "./local-workspace.js";
import { CodingAgent } from "./coding-agent.js";
import { VerificationPipeline } from "./verification-pipeline.js";
import { PathEscapeError } from "./path-safety.js";

describe("VerificationPipeline", () => {
  it("reports NO_TESTS honestly when package.json has no test script", async () => {
    const root = join(tmpdir(), `pai-vp-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const ws = new LocalWorkspaceManager({ rootDir: root });
    const record = await ws.create("user-1", "demo");
    await ws.writeFile(
      record.id,
      "package.json",
      JSON.stringify({ name: "demo", scripts: { build: "echo ok" } }),
    );
    await ws.writeFile(record.id, "src/index.js", "export const x = 1;\n");

    const pipeline = new VerificationPipeline(3);
    // Skip real npm build if node_modules missing — mock by using SKIPPED path when no node_modules
    // Write a build script that succeeds via node -e
    await ws.writeFile(
      record.id,
      "package.json",
      JSON.stringify({
        name: "demo",
        scripts: {
          build: "node -e \"process.exit(0)\"",
        },
      }),
    );

    const result = await pipeline.verify(record.id, ws, 1);
    assert.equal(result.report.tests, "NO_TESTS");
    assert.notEqual(result.report.tests, "PASSED");
    assert.equal(result.report.security, "NOT_IMPLEMENTED");
    assert.ok(result.report.status === "UNCERTAIN" || result.report.status === "VERIFIED");
    if (result.report.build === "PASSED") {
      assert.equal(result.report.status, "UNCERTAIN");
    }

    await rm(root, { recursive: true, force: true });
  });

  it("reports FAILED when build fails", async () => {
    const root = join(tmpdir(), `pai-vp-fail-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const ws = new LocalWorkspaceManager({ rootDir: root });
    const record = await ws.create("user-1", "demo");
    await ws.writeFile(
      record.id,
      "package.json",
      JSON.stringify({
        name: "demo",
        scripts: {
          build: "node -e \"process.exit(1)\"",
          test: "node -e \"process.exit(0)\"",
        },
      }),
    );

    const result = await new VerificationPipeline().verify(record.id, ws, 1);
    assert.equal(result.report.build, "FAILED");
    assert.equal(result.report.status, "FAILED");
    await rm(root, { recursive: true, force: true });
  });

  it("does not treat placeholder npm test as PASSED", async () => {
    const root = join(tmpdir(), `pai-vp-echo-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const ws = new LocalWorkspaceManager({ rootDir: root });
    const record = await ws.create("user-1", "demo");
    await ws.writeFile(
      record.id,
      "package.json",
      JSON.stringify({
        name: "demo",
        scripts: {
          build: "node -e \"process.exit(0)\"",
          test: 'echo "No tests specified" && exit 0',
        },
      }),
    );
    const result = await new VerificationPipeline().verify(record.id, ws, 1);
    assert.equal(result.report.tests, "NO_TESTS");
    assert.notEqual(result.report.tests, "PASSED");
    await rm(root, { recursive: true, force: true });
  });

  it("detects root test.js and rejects vacuous behavioral tests", async () => {
    const root = join(tmpdir(), `pai-vp-testjs-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const ws = new LocalWorkspaceManager({ rootDir: root });
    const record = await ws.create("user-1", "demo");
    await ws.writeFile(
      record.id,
      "package.json",
      JSON.stringify({
        name: "demo",
        scripts: {
          build: "node -e \"process.exit(0)\"",
          test: "node --test test.js",
        },
      }),
    );
    await ws.writeFile(record.id, "test.js", 'test("vacuous", () => { expect(true).toBe(true); });\n');
    const result = await new VerificationPipeline().verify(record.id, ws, 1);
    assert.equal(result.report.tests, "NO_TESTS");
    assert.equal(result.passed, false);
    await rm(root, { recursive: true, force: true });
  });

  it("passes node project with behavioral test.js when tests succeed", async () => {
    const root = join(tmpdir(), `pai-vp-pass-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const ws = new LocalWorkspaceManager({ rootDir: root });
    const record = await ws.create("user-1", "demo");
    await ws.writeFile(
      record.id,
      "package.json",
      JSON.stringify({
        name: "demo",
        scripts: {
          build: "node -e \"process.exit(0)\"",
          test: "node --test test.js",
        },
      }),
    );
    await ws.writeFile(
      record.id,
      "test.js",
      `import test from "node:test";
import assert from "node:assert/strict";
test("addition", () => {
  assert.strictEqual(1 + 1, 2);
});\n`,
    );
    const result = await new VerificationPipeline().verify(record.id, ws, 1);
    assert.equal(result.report.build, "PASSED");
    assert.equal(result.report.tests, "PASSED");
    assert.equal(result.passed, true);
    await rm(root, { recursive: true, force: true });
  });
});

describe("CodingAgent auto-fix", () => {
  it("applies a bounded patch and re-verifies (max attempts)", async () => {
    const root = join(tmpdir(), `pai-fix-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const ws = new LocalWorkspaceManager({ rootDir: root });
    const record = await ws.create("user-1", "demo");

    // Start with failing build; first patch makes build pass (still no tests)
    await ws.writeFile(
      record.id,
      "package.json",
      JSON.stringify({
        name: "demo",
        scripts: { build: "node -e \"process.exit(1)\"" },
      }),
    );

    let proposals = 0;
    const agent = new CodingAgent(ws, new VerificationPipeline(3), {
      maxFixAttempts: 3,
      proposePatch: async () => {
        proposals++;
        return {
          path: "package.json",
          content: JSON.stringify({
            name: "demo",
            scripts: { build: "node -e \"process.exit(0)\"" },
          }),
          reason: "Fix build exit code",
        };
      },
    });

    const result = await agent.execute({
      workspaceId: record.id,
      description: "fix build",
    });

    assert.ok(proposals >= 1 && proposals <= 3);
    assert.ok(result.patchesApplied?.includes("package.json"));
    assert.equal(result.verification?.report?.build, "PASSED");
    assert.equal(result.verification?.report?.tests, "NO_TESTS");
    assert.equal(result.verification?.report?.status, "UNCERTAIN");

    await rm(root, { recursive: true, force: true });
  });

  it("rejects path-escaping patches", async () => {
    const root = join(tmpdir(), `pai-escape-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const ws = new LocalWorkspaceManager({ rootDir: root });
    const record = await ws.create("user-1", "demo");
    await writeFile(join(record.rootPath, "ok.txt"), "hi");

    const agent = new CodingAgent(ws);
    await assert.rejects(
      () =>
        agent.applyPatch(record.id, {
          path: "../outside.txt",
          content: "nope",
        }),
      (err: unknown) => err instanceof PathEscapeError || (err instanceof Error && /escape|Absolute/i.test(err.message)),
    );

    await rm(root, { recursive: true, force: true });
  });
});
