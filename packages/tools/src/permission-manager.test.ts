import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolPermissionLevel } from "@personal-ai/shared";
import {
  PermissionDeniedError,
  PermissionManager,
  ToolRegistry,
} from "./registry.js";

describe("PermissionManager", () => {
  it("allows READ by default", async () => {
    const pm = new PermissionManager();
    await pm.assertAllowed(
      {
        name: "read_file",
        description: "r",
        parameters: {},
        permissionLevel: ToolPermissionLevel.READ,
      },
      {},
    );
  });

  it("denies HIGH_RISK without approval handler", async () => {
    const pm = new PermissionManager();
    await assert.rejects(
      () =>
        pm.assertAllowed(
          {
            name: "delete_file",
            description: "d",
            parameters: {},
            permissionLevel: ToolPermissionLevel.HIGH_RISK,
          },
          {},
        ),
      PermissionDeniedError,
    );
  });

  it("requires approval for HIGH_RISK", async () => {
    let called = false;
    const pm = new PermissionManager({
      onApprovalRequired: async () => {
        called = true;
        return true;
      },
    });
    await pm.assertAllowed(
      {
        name: "push_git",
        description: "p",
        parameters: {},
        permissionLevel: ToolPermissionLevel.HIGH_RISK,
      },
      {},
    );
    assert.equal(called, true);
  });

  it("denies when approval returns false", async () => {
    const pm = new PermissionManager({
      onApprovalRequired: async () => false,
    });
    await assert.rejects(
      () =>
        pm.assertAllowed(
          {
            name: "delete_file",
            description: "d",
            parameters: {},
            permissionLevel: ToolPermissionLevel.HIGH_RISK,
          },
          {},
        ),
      /denied/i,
    );
  });

  it("respects maxAllowedLevel for WRITE", async () => {
    const pm = new PermissionManager({
      maxAllowedLevel: ToolPermissionLevel.READ,
    });
    await assert.rejects(
      () =>
        pm.assertAllowed(
          {
            name: "create_file",
            description: "w",
            parameters: {},
            permissionLevel: ToolPermissionLevel.WRITE,
          },
          {},
        ),
      PermissionDeniedError,
    );
  });

  it("EXECUTE level is allowed when max is EXECUTE", async () => {
    const pm = new PermissionManager({
      maxAllowedLevel: ToolPermissionLevel.EXECUTE,
    });
    await pm.assertAllowed(
      {
        name: "run_command",
        description: "e",
        parameters: {},
        permissionLevel: ToolPermissionLevel.EXECUTE,
      },
      {},
    );
  });
});

describe("ToolRegistry permission enforcement", () => {
  it("blocks HIGH_RISK without approval", async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "delete_file",
        description: "d",
        parameters: {},
        permissionLevel: ToolPermissionLevel.HIGH_RISK,
      },
      async execute() {
        return { success: true, output: { deleted: true } };
      },
    });
    const result = await registry.execute("delete_file", { path: "x" });
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /approval|HIGH_RISK|denied/i);
  });

  it("allows READ tools", async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "read_file",
        description: "r",
        parameters: {},
        permissionLevel: ToolPermissionLevel.READ,
      },
      async execute() {
        return { success: true, output: { content: "ok" } };
      },
    });
    const result = await registry.execute("read_file", { path: "a" });
    assert.equal(result.success, true);
  });
});
