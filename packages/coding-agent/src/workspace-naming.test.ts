import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalWorkspaceManager, slugifyWorkspaceName } from "./local-workspace.js";

describe("workspace folder naming", () => {
  let root: string;
  let mgr: LocalWorkspaceManager;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "ws-name-"));
    mgr = new LocalWorkspaceManager({ rootDir: root });
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("slugifies project names for folders", () => {
    assert.equal(slugifyWorkspaceName("Iron Box Company"), "iron-box-company");
    assert.equal(slugifyWorkspaceName("my-website"), "my-website");
  });

  it("creates folders named after the project, not random UUIDs", async () => {
    const ws = await mgr.create("user-1", "Iron Box Company");
    assert.equal(ws.id, "iron-box-company");
    assert.equal(ws.projectName, "Iron Box Company");
    assert.match(ws.rootPath, /iron-box-company$/);
    assert.equal(/^[0-9a-f-]{36}$/i.test(ws.id), false);

    const dirs = await readdir(root);
    assert.ok(dirs.includes("iron-box-company"));
  });

  it("adds a numeric suffix when the project folder already exists", async () => {
    const second = await mgr.create("user-1", "Iron Box Company");
    assert.equal(second.id, "iron-box-company-2");
    const dirs = await readdir(root);
    assert.ok(dirs.includes("iron-box-company-2"));
  });
});
