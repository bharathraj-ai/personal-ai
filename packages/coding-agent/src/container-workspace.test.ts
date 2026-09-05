import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContainerCodingWorkspace, dockerAvailable } from "./container-workspace.js";
import { PathEscapeError } from "./path-safety.js";

describe("ContainerCodingWorkspace", () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "pai-ctr-"));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports provider=container, not cloud", async () => {
    const ws = new ContainerCodingWorkspace({ rootDir: join(dir, "root") });
    const created = await ws.create("u1", "app");
    assert.equal(ws.providerKind, "container");
    assert.equal(created.sandboxProvider, "container");
  });

  it("rejects path escape the same as local", async () => {
    const ws = new ContainerCodingWorkspace({ rootDir: join(dir, "esc") });
    const created = await ws.create("u1", "app");
    await assert.rejects(() => ws.writeFile(created.id, "../../etc/passwd", "x"), PathEscapeError);
  });

  it("runs exec in docker when available, with no host env secrets", async (t) => {
    if (!(await dockerAvailable())) {
      t.skip("Docker not available on this host");
      return;
    }
    const prev = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "gsk_should_never_leak";
    try {
      const ws = new ContainerCodingWorkspace({ rootDir: join(dir, "exec") });
      const created = await ws.create("u1", "app");
      const result = await ws.exec(created.id, "printenv GROQ_API_KEY || true; echo CONTAINER_OK", {
        timeoutMs: 60_000,
      });
      assert.equal(result.stdout.includes("gsk_should_never_leak"), false);
      assert.match(result.stdout, /CONTAINER_OK/);
      assert.equal(result.timedOut, false);
    } finally {
      if (prev === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = prev;
    }
  });
});
