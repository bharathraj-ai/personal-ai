import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { schoolManagementProjectFiles } from "./school-management-project.js";

describe("school management generated project", () => {
  it("is a multi-file project, not a single page", () => {
    const files = schoolManagementProjectFiles();
    const pages = files.filter((f) => f.path.endsWith(".html"));
    assert.ok(pages.length >= 8, `expected many pages, got ${pages.length}`);
    assert.ok(files.some((f) => f.path === "src/routes.js"));
    assert.ok(files.some((f) => f.path === "src/store.js"));
    assert.ok(files.some((f) => f.path === "schema/schema.sql"));
    assert.ok(files.some((f) => f.path.startsWith("test/")));
  });

  it("passes generated unit and API tests", () => {
    const root = mkdtempSync(join(tmpdir(), "sms-proj-"));
    for (const file of schoolManagementProjectFiles()) {
      const abs = join(root, file.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, file.content);
    }
    const result = spawnSync("node", ["--test", "test/"], {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(result.status, 0, result.stderr + "\n" + result.stdout);
  });
});
