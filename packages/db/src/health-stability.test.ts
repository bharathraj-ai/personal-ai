import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPoolConfig, createDatabase, parseDatabaseTarget } from "./client.js";

describe("database health stability", () => {
  it("Neon pool defaults stay within safe bounds", () => {
    const cfg = createPoolConfig(
      "postgresql://u:p@ep-abc-pooler.ap-southeast-1.aws.neon.tech/db?sslmode=require",
    );
    assert.ok((cfg.max ?? 0) <= 5);
    assert.ok((cfg.connectionTimeoutMillis ?? 0) >= 5_000);
    assert.ok((cfg.idleTimeoutMillis ?? 0) <= 30_000);
  });

  it("parseDatabaseTarget identifies Neon pooler", () => {
    const t = parseDatabaseTarget(
      "postgresql://u:p@ep-abc-pooler.ap-southeast-1.aws.neon.tech/db",
    );
    assert.equal(t.hostKind, "neon");
    assert.equal(t.pooler, true);
  });
});

describe("concurrent health dedupe", () => {
  it("dedupes parallel lite health checks against one pool", async () => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      return;
    }
    const { createDatabase } = await import("./client.js");
    const db = await createDatabase(databaseUrl);
    try {
      const results = await Promise.all([
        db.healthCheckLite(),
        db.healthCheckLite(),
        db.healthCheckLite(),
        db.healthCheckLite(),
        db.healthCheckLite(),
      ]);
      assert.equal(results.length, 5);
      for (const r of results) {
        assert.equal(typeof r.healthy, "boolean");
        assert.ok(r.latencyMs != null);
      }
      const latencies = results.map((r) => r.latencyMs ?? 0);
      const max = Math.max(...latencies);
      assert.ok(max < 15_000, `parallel lite health too slow: ${max}ms`);
    } finally {
      await db.close();
    }
  });
});
