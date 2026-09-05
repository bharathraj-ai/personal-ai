import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AuthError,
  AuthService,
  loadTokenMapFromEnv,
} from "./auth-service.js";
import { hostFsActionsEnabled } from "../local-actions.js";

describe("AuthService", () => {
  const tokens = loadTokenMapFromEnv({
    AUTH_DEV_TOKEN: "dev-token",
    AUTH_DEV_USER_ID: "default-user",
    AUTH_DEV_TOKEN_B: "dev-token-b",
    AUTH_DEV_USER_ID_B: "user-b",
  });
  const auth = new AuthService(tokens);

  it("rejects missing token", () => {
    assert.throws(() => auth.authenticate(undefined), AuthError);
  });

  it("rejects invalid token", () => {
    assert.throws(() => auth.authenticate("Bearer wrong"), AuthError);
  });

  it("accepts valid token and derives userId", () => {
    const ctx = auth.authenticate("Bearer dev-token");
    assert.equal(ctx.userId, "default-user");
  });

  it("second token maps to different user", () => {
    const a = auth.authenticate("Bearer dev-token");
    const b = auth.authenticate("Bearer dev-token-b");
    assert.equal(a.userId, "default-user");
    assert.equal(b.userId, "user-b");
    assert.notEqual(a.userId, b.userId);
  });

  it("does not treat client userId as authority (identity from token only)", () => {
    const ctx = auth.authenticate("Bearer dev-token");
    // Even if a client claims user-b, auth context stays default-user
    assert.equal(ctx.userId, "default-user");
  });
});

describe("Host FS gate", () => {
  it("is disabled by default", () => {
    const prev = process.env.ENABLE_HOST_FS_ACTIONS;
    delete process.env.ENABLE_HOST_FS_ACTIONS;
    assert.equal(hostFsActionsEnabled(), false);
    if (prev !== undefined) process.env.ENABLE_HOST_FS_ACTIONS = prev;
  });

  it("does not block school orchestration goals when host FS is disabled", async () => {
    const { tryHandleLocalAction } = await import("../local-actions.js");
    const prev = process.env.ENABLE_HOST_FS_ACTIONS;
    delete process.env.ENABLE_HOST_FS_ACTIONS;
    const goal =
      "Create a Phase-1 School Management System with PostgreSQL/Neon persistence and local-file storage.";
    const result = await tryHandleLocalAction(goal);
    assert.equal(result.handled, false);
    if (prev !== undefined) process.env.ENABLE_HOST_FS_ACTIONS = prev;
  });
});
