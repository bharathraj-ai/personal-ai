import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalWorkspaceManager } from "./local-workspace.js";
import { parseStructuredCodingOutput } from "./structured-output.js";
import {
  SYSTEM_FILE_WRITE_FORBIDDEN,
  SystemFileWriteForbiddenError,
  assertAgentMayModifyPath,
  filterSystemFilesFromAllowedPaths,
  isSystemFilePath,
} from "./system-files.js";

describe("system file protection", () => {
  it("detects .workspace.json variants", () => {
    assert.equal(isSystemFilePath(".workspace.json"), true);
    assert.equal(isSystemFilePath("./.workspace.json"), true);
    assert.equal(isSystemFilePath("foo/.workspace.json"), true);
    assert.equal(isSystemFilePath("package.json"), false);
  });

  it("filters system files from allowed path lists", () => {
    const filtered = filterSystemFilesFromAllowedPaths([
      "src/index.js",
      ".workspace.json",
      "package.json",
    ]);
    assert.deepEqual(filtered, ["src/index.js", "package.json"]);
  });

  it("throws typed SYSTEM_FILE_WRITE_FORBIDDEN from assertAgentMayModifyPath", () => {
    assert.throws(
      () => assertAgentMayModifyPath(".workspace.json", "create"),
      (err: unknown) => {
        assert.ok(err instanceof SystemFileWriteForbiddenError);
        assert.equal((err as SystemFileWriteForbiddenError).code, SYSTEM_FILE_WRITE_FORBIDDEN);
        return true;
      },
    );
  });

  it("rejects malformed provider output attempting system-file modification", () => {
    const raw = JSON.stringify({
      summary: "bad",
      files: [
        {
          path: ".workspace.json",
          operation: "edit",
          content: '{"id":"hijacked"}',
        },
      ],
    });
    const parsed = parseStructuredCodingOutput(raw);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, new RegExp(SYSTEM_FILE_WRITE_FORBIDDEN));
    }
  });
});

describe("LocalWorkspaceManager system file writes", () => {
  async function withWorkspace(
    fn: (ctx: { ws: LocalWorkspaceManager; id: string; metaPath: string }) => Promise<void>,
  ) {
    const dir = await mkdtemp(join(tmpdir(), "sysfile-ws-"));
    const ws = new LocalWorkspaceManager({ rootDir: dir });
    const created = await ws.create("user-1", "demo");
    const metaPath = join(created.rootPath, ".workspace.json");
    const original = await readFile(metaPath, "utf8");
    try {
      await fn({ ws, id: created.id, metaPath });
      const after = await readFile(metaPath, "utf8");
      assert.equal(after, original, ".workspace.json must remain byte-for-byte unchanged");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("rejects create attempt on .workspace.json", async () => {
    await withWorkspace(async ({ ws, id }) => {
      await assert.rejects(
        () => ws.writeFile(id, ".workspace.json", '{"id":"evil"}'),
        (err: unknown) => {
          assert.ok(err instanceof SystemFileWriteForbiddenError);
          return true;
        },
      );
    });
  });

  it("rejects overwrite attempt on .workspace.json", async () => {
    await withWorkspace(async ({ ws, id }) => {
      await assert.rejects(
        () => ws.editFile(id, ".workspace.json", '{"id":"evil"}'),
        SystemFileWriteForbiddenError,
      );
    });
  });

  it("rejects delete attempt on .workspace.json", async () => {
    await withWorkspace(async ({ ws, id }) => {
      await assert.rejects(() => ws.deleteFile(id, ".workspace.json"), SystemFileWriteForbiddenError);
    });
  });

  it("rejects nested .workspace.json path (rename-style write)", async () => {
    await withWorkspace(async ({ ws, id }) => {
      const root = dirSafe(ws, id);
      await mkdir(join(root, "backup"), { recursive: true });
      await assert.rejects(
        () => ws.writeFile(id, "backup/.workspace.json", "{}"),
        SystemFileWriteForbiddenError,
      );
    });
  });

  it("rejects repair-style overwrite on .workspace.json", async () => {
    await withWorkspace(async ({ ws, id }) => {
      await assert.rejects(
        () => ws.writeFile(id, ".workspace.json", '{"projectName":"nx"}'),
        SystemFileWriteForbiddenError,
      );
    });
  });
});

function dirSafe(ws: LocalWorkspaceManager, id: string): string {
  const record = ws.get(id);
  if (!record) throw new Error("missing workspace");
  return record.rootPath;
}
