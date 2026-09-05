import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFileManifest } from "./file-manifest.js";

describe("parseFileManifest", () => {
  it("accepts paths without contents", () => {
    const parsed = parseFileManifest(
      JSON.stringify({
        project: "app",
        modules: [{ id: "M1", name: "Auth" }],
        files: [{ path: "src/auth.ts", purpose: "login", module: "M1" }],
      }),
    );
    assert.equal(parsed.ok, true);
  });

  it("rejects file contents masquerading as a full dump via empty files", () => {
    const parsed = parseFileManifest(JSON.stringify({ project: "x", files: [] }));
    assert.equal(parsed.ok, false);
  });

  it("rejects path traversal", () => {
    const parsed = parseFileManifest(
      JSON.stringify({
        project: "x",
        files: [{ path: "../secret", purpose: "x", module: "m" }],
      }),
    );
    assert.equal(parsed.ok, false);
  });
});
