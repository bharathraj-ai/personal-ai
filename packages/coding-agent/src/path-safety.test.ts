import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalWorkspaceManager, PathEscapeError } from "./local-workspace.js";
import { assertLogicalPathInside, resolveSafePath } from "./path-safety.js";

describe("path safety — logical", () => {
  const root = "/tmp/workspace-root-fake";

  it("allows nested valid path", () => {
    const full = assertLogicalPathInside(root, "src/components/app.ts");
    assert.ok(full.includes("src/components/app.ts"));
  });

  it("allows normal file path", () => {
    const full = assertLogicalPathInside(root, "src/app.js");
    assert.ok(full.endsWith("src/app.js") || full.includes(`${join("src", "app.js")}`));
  });

  it("rejects ../../etc/passwd", () => {
    assert.throws(() => assertLogicalPathInside(root, "../../etc/passwd"), PathEscapeError);
  });

  it("rejects ../../../home/user", () => {
    assert.throws(() => assertLogicalPathInside(root, "../../../home/user"), PathEscapeError);
  });

  it("rejects absolute host paths", () => {
    assert.throws(() => assertLogicalPathInside(root, "/etc/passwd"), PathEscapeError);
    assert.throws(() => assertLogicalPathInside(root, "/home/user/.ssh/id_rsa"), PathEscapeError);
  });

  it("rejects absolute path", () => {
    assert.throws(() => assertLogicalPathInside(root, "/home/user/secret.txt"), PathEscapeError);
  });

  it("rejects encoded parent traversal", () => {
    assert.throws(() => assertLogicalPathInside(root, "..%2F..%2Fsecret.txt"), PathEscapeError);
  });
});

describe("path safety — symlink + realpath", () => {
  let dir: string;
  let wsRoot: string;
  let outside: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "pai-ws-"));
    wsRoot = join(dir, "workspace");
    outside = join(dir, "outside");
    await mkdir(wsRoot, { recursive: true });
    await mkdir(join(wsRoot, "src"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    await writeFile(join(wsRoot, "src", "app.js"), "ok", "utf8");
    // Symlink inside workspace pointing outside
    await symlink(outside, join(wsRoot, "leak"));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("allows nested valid path via resolveSafePath", async () => {
    const full = await resolveSafePath(wsRoot, "src/app.js");
    assert.ok(full.includes("app.js"));
  });

  it("rejects symlink escape", async () => {
    await assert.rejects(
      () => resolveSafePath(wsRoot, "leak/secret.txt"),
      (err: unknown) => err instanceof PathEscapeError || (err instanceof Error && /symlink|escape/i.test(err.message)),
    );
  });

  it("LocalWorkspaceManager rejects traversal on write", async () => {
    const mgr = new LocalWorkspaceManager({ rootDir: join(dir, "mgr-root") });
    const ws = await mgr.create("user-a", "proj");
    await assert.rejects(
      () => mgr.writeFile(ws.id, "../../secret.txt", "x"),
      PathEscapeError,
    );
  });

  it("LocalWorkspaceManager allows valid nested write", async () => {
    const mgr = new LocalWorkspaceManager({ rootDir: join(dir, "mgr-root2") });
    const ws = await mgr.create("user-a", "proj");
    await mgr.writeFile(ws.id, "src/components/app.ts", "export {}");
    const content = await mgr.readFile(ws.id, "src/components/app.ts");
    assert.equal(content, "export {}");
  });

  it("rejects host escape attempts via write/read", async () => {
    const { LocalCodingWorkspace } = await import("./local-workspace.js");
    const mgr = new LocalCodingWorkspace({ rootDir: join(dir, "mgr-escape") });
    const ws = await mgr.create("user-a", "proj");
    await assert.rejects(() => mgr.writeFile(ws.id, "../../etc/passwd", "x"), PathEscapeError);
    await assert.rejects(() => mgr.readFile(ws.id, "../../../home/user"), PathEscapeError);
    await assert.rejects(() => mgr.writeFile(ws.id, "/etc/passwd", "x"), PathEscapeError);
  });

  it("does not pass provider/S3/Neon secrets into exec env", async () => {
    const prev = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "gsk_should_never_leak";
    try {
      const mgr = new LocalWorkspaceManager({ rootDir: join(dir, "mgr-env") });
      const ws = await mgr.create("user-a", "proj");
      const result = await mgr.exec(ws.id, "printenv GROQ_API_KEY || true");
      assert.equal(result.stdout.includes("gsk_should_never_leak"), false);
      assert.ok(mgr.commandAudit.length >= 1);
    } finally {
      if (prev === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = prev;
    }
  });

  it("refuses Desktop/Downloads/Documents as workspace roots", () => {
    assert.throws(
      () => new LocalWorkspaceManager({ rootDir: "/home/user/Desktop/ws" }),
      /Desktop|Downloads|Documents|home directory/i,
    );
  });
});
