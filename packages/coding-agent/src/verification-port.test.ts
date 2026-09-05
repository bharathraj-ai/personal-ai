import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { pickVerificationPort, verificationPortEnv } from "./verification-port.js";

async function holdPort(port: number): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve(async () => {
        await new Promise<void>((r) => server.close(() => r()));
      });
    });
  });
}

describe("verification port management", () => {
  it("selects fallback when default port is occupied", async () => {
    const release = await holdPort(9100);
    try {
      const port = await pickVerificationPort([9100]);
      assert.notEqual(port, 9100);
      const available = await new Promise<boolean>((resolve) => {
        const server = createServer();
        server.once("error", () => resolve(false));
        server.listen(port, "127.0.0.1", () => {
          server.close(() => resolve(true));
        });
      });
      assert.equal(available, true);
    } finally {
      await release();
    }
  });

  it("verificationPortEnv passes PORT to child processes", () => {
    const env = verificationPortEnv(9123);
    assert.equal(env.PORT, "9123");
    assert.equal(env.VERIFICATION_PORT, "9123");
  });

  it("pickVerificationPort returns an available port", async () => {
    const port = await pickVerificationPort([]);
    assert.ok(port > 0);
    const available = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    assert.equal(available, true);
  });
});
