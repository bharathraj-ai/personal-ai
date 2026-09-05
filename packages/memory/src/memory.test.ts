import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectSecrets } from "./secret-filter.js";
import { InMemoryMemoryService } from "./memory-service.js";
import { extractMemoryCandidates } from "./extract.js";
import { LocalHashEmbeddingProvider } from "./embeddings.js";

describe("secret detection", () => {
  it("rejects API keys", () => {
    const r = detectSecrets("My key is sk-abcdefghijklmnopqrstuvwxyz012345");
    assert.equal(r.safe, false);
  });

  it("rejects connection strings", () => {
    const r = detectSecrets("db=postgres://user:pass@host/db");
    assert.equal(r.safe, false);
  });

  it("allows normal preferences", () => {
    const r = detectSecrets("I prefer TypeScript for projects.");
    assert.equal(r.safe, true);
  });
});

describe("InMemoryMemoryService", () => {
  it("creates and searches memory", async () => {
    const svc = new InMemoryMemoryService();
    const created = await svc.createMemory({
      userId: "u1",
      content: "User prefers TypeScript for projects.",
      memoryType: "preference",
      userApproved: true,
    });
    assert.ok(!("rejected" in created));

    const results = await svc.searchMemory({
      userId: "u1",
      query: "TypeScript backend",
    });
    assert.ok(results.length >= 1);
    assert.match(results[0].content, /TypeScript/);
  });

  it("rejects secrets on create", async () => {
    const svc = new InMemoryMemoryService();
    const result = await svc.createMemory({
      userId: "u1",
      content: "password: hunter2secret",
      userApproved: true,
    });
    assert.ok("rejected" in result && result.rejected);
  });

  it("isolates users", async () => {
    const svc = new InMemoryMemoryService();
    await svc.createMemory({
      userId: "alice",
      content: "Alice prefers Go.",
      userApproved: true,
    });
    const bob = await svc.searchMemory({ userId: "bob", query: "Go" });
    assert.equal(bob.length, 0);
  });

  it("isolates projects", async () => {
    const svc = new InMemoryMemoryService();
    await svc.createMemory({
      userId: "u1",
      projectId: "proj-a",
      content: "Project A uses PostgreSQL.",
      userApproved: true,
    });
    const inB = await svc.searchMemory({
      userId: "u1",
      query: "PostgreSQL",
      projectId: "proj-b",
      projectOnly: true,
    });
    assert.equal(inB.length, 0);
  });

  it("deletes memory and clear all", async () => {
    const svc = new InMemoryMemoryService();
    const m = await svc.createMemory({
      userId: "u1",
      content: "Remember my dark theme preference.",
      userApproved: true,
    });
    assert.ok(!("rejected" in m));
    await svc.deleteMemory("u1", m.id);
    assert.equal((await svc.listMemories("u1")).length, 0);

    await svc.createMemory({
      userId: "u1",
      content: "Another preference about linting.",
      userApproved: true,
    });
    const n = await svc.deleteAllMemories("u1");
    assert.equal(n, 1);
  });

  it("rejects duplicate content", async () => {
    const svc = new InMemoryMemoryService();
    const a = await svc.createMemory({
      userId: "u1",
      content: "User prefers dark mode always.",
      userApproved: true,
    });
    assert.ok(!("rejected" in a));
    const b = await svc.createMemory({
      userId: "u1",
      content: "User prefers dark mode always.",
      userApproved: true,
    });
    assert.ok("rejected" in b && b.rejected);
  });
});

describe("extractMemoryCandidates", () => {
  it("extracts preference", () => {
    const c = extractMemoryCandidates("I prefer TypeScript for my projects.", "u1");
    assert.ok(c.length >= 1);
    assert.equal(c[0].memoryType, "preference");
  });
});

describe("LocalHashEmbeddingProvider", () => {
  it("produces fixed dimensions", async () => {
    const emb = new LocalHashEmbeddingProvider(384);
    const v = await emb.embed("hello");
    assert.equal(v.length, 384);
    const batch = await emb.embedBatch(["a", "b"]);
    assert.equal(batch.length, 2);
  });
});
