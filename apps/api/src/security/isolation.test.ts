import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryMemoryService,
  InMemoryProjectService,
} from "@personal-ai/memory";
import { InMemoryRagService } from "@personal-ai/rag";
import { LocalWorkspaceManager } from "@personal-ai/coding-agent";

/**
 * User isolation unit tests — AUTHENTICATED USER ID ≠ CLIENT-SUPPLIED userId.
 */

describe("memory isolation", () => {
  it("user B cannot search user A memory", async () => {
    const memory = new InMemoryMemoryService();
    await memory.createMemory({
      userId: "user-a",
      content: "User A secret preference about TypeScript",
      memoryType: "preference",
      userApproved: true,
    });
    const results = await memory.searchMemory({
      userId: "user-b",
      query: "TypeScript",
    });
    assert.equal(results.length, 0);
  });
});

describe("document isolation", () => {
  it("user B cannot list user A documents", async () => {
    const rag = new InMemoryRagService({
      topK: 5,
      similarityThreshold: 0.1,
      chunkSize: 800,
      chunkOverlap: 100,
      maxContextChars: 6000,
    });
    await rag.ingestDocument({
      userId: "user-a",
      filename: "secret.md",
      content: "confidential project notes for ocean temperature",
    });
    const docs = await rag.listDocuments("user-b");
    assert.equal(docs.length, 0);
  });
});

describe("project isolation", () => {
  it("user B cannot get user A project", async () => {
    const projects = new InMemoryProjectService();
    const created = await projects.create({
      userId: "user-a",
      name: "Project O",
    });
    const got = await projects.get("user-b", created.id);
    assert.equal(got, null);
  });
});

describe("workspace ownership", () => {
  let dir: string;
  let mgr: LocalWorkspaceManager;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "pai-own-"));
    mgr = new LocalWorkspaceManager({ rootDir: dir });
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("user B cannot getOwned user A workspace", async () => {
    const ws = await mgr.create("user-a", "ocean");
    assert.equal(mgr.getOwned(ws.id, "user-b"), undefined);
    assert.ok(mgr.getOwned(ws.id, "user-a"));
  });

  it("reports self-hosted provider (not cloud)", async () => {
    const ws = await mgr.create("user-a", "x");
    assert.equal(ws.sandboxProvider, "self-hosted");
    assert.equal(mgr.providerKind, "self-hosted");
  });
});
