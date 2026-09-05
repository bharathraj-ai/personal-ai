import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPoolConfig, parseDatabaseTarget } from "./client.js";

describe("parseDatabaseTarget", () => {
  it("detects Neon pooler over the internet", () => {
    const t = parseDatabaseTarget(
      "postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
    );
    assert.equal(t.hostKind, "neon");
    assert.equal(t.usesInternet, true);
    assert.equal(t.pooler, true);
    assert.equal(t.isNeon, true);
  });

  it("detects local Postgres as offline", () => {
    const t = parseDatabaseTarget("postgresql://postgres:postgres@localhost:5432/personal_ai");
    assert.equal(t.hostKind, "local");
    assert.equal(t.usesInternet, false);
  });
});

describe("createPoolConfig", () => {
  it("uses smaller pool for Neon", () => {
    const cfg = createPoolConfig(
      "postgresql://u:p@ep-abc-pooler.us-east-2.aws.neon.tech/db?sslmode=require",
    );
    assert.ok((cfg.max ?? 0) <= 5);
    assert.ok(cfg.ssl);
  });
});
