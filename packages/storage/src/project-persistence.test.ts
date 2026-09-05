import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalWorkspaceManager } from "@personal-ai/coding-agent";
import { LocalFileStorageService } from "./local-file-storage.js";
import { ProjectPersistenceService } from "./project-persistence.js";

describe("ProjectPersistenceService", () => {
  it("restores artifacts into the same workspaceId after gateway restart", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "p15-storage-"));
    const wsRootA = await mkdtemp(join(tmpdir(), "p15-ws-a-"));
    const wsRootB = await mkdtemp(join(tmpdir(), "p15-ws-b-"));

    const gatewayA = new LocalWorkspaceManager({ rootDir: wsRootA });
    const storage = new LocalFileStorageService(storageRoot);
    const persistenceA = new ProjectPersistenceService(storage, gatewayA);

    const created = await gatewayA.create("user-1", "rest-demo");
    const workspaceId = created.id;
    await gatewayA.writeFile(workspaceId, "package.json", '{"name":"demo","version":"1.0.0"}\n');
    await gatewayA.writeFile(workspaceId, "src/index.js", 'module.exports = { ok: true };\n');

    const sync = await persistenceA.syncWorkspaceToS3("user-1", "project-1", workspaceId);
    assert.ok(sync.uploaded >= 2, `expected uploads, got ${sync.uploaded}`);

    const gatewayB = new LocalWorkspaceManager({ rootDir: wsRootB });
    const persistenceB = new ProjectPersistenceService(storage, gatewayB);

    const restored = await persistenceB.restoreProjectFromS3(
      "user-1",
      "project-1",
      "rest-demo",
      workspaceId,
    );

    assert.equal(restored.workspaceId, workspaceId);
    assert.equal(restored.status, "RESTORED");
    assert.ok(restored.restore.restored >= 2);

    const pkg = await gatewayB.readFile(workspaceId, "package.json");
    assert.match(pkg, /"name":"demo"/);
    const src = await gatewayB.readFile(workspaceId, "src/index.js");
    assert.match(src, /ok: true/);

    await rm(storageRoot, { recursive: true, force: true });
    await rm(wsRootA, { recursive: true, force: true });
    await rm(wsRootB, { recursive: true, force: true });
  });

  it("returns RESTORE_FAILED instead of creating a new empty workspace", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "p15-storage-empty-"));
    const wsRoot = await mkdtemp(join(tmpdir(), "p15-ws-empty-"));
    const storage = new LocalFileStorageService(storageRoot);
    const workspaces = new LocalWorkspaceManager({ rootDir: wsRoot });
    const persistence = new ProjectPersistenceService(storage, workspaces);

    const missingId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const restored = await persistence.restoreProjectFromS3(
      "user-1",
      "project-1",
      "missing",
      missingId,
    );

    assert.equal(restored.workspaceId, missingId);
    assert.equal(restored.status, "RESTORE_FAILED");
    assert.equal(workspaces.get(missingId), undefined);

    await rm(storageRoot, { recursive: true, force: true });
    await rm(wsRoot, { recursive: true, force: true });
  });
});
