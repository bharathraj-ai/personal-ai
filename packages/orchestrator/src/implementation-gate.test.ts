import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  requiresFullImplementationPipeline,
  goalRequiresRealTests,
} from "./implementation-gate.js";

describe("implementation gate", () => {
  it("forces full pipeline for REST API with real automated test", () => {
    assert.equal(
      requiresFullImplementationPipeline(
        "Create a small REST API with one endpoint and a real automated test.",
      ),
      true,
    );
  });

  it("forces full pipeline for school management", () => {
    assert.equal(
      requiresFullImplementationPipeline("Create a complete Phase-1 school management system."),
      true,
    );
  });

  it("does not shortcut simple unrelated goals", () => {
    assert.equal(requiresFullImplementationPipeline("What is the weather today?"), false);
  });

  it("forces full pipeline for REST API with real automated behavioral test (P16 goal)", () => {
    assert.equal(
      requiresFullImplementationPipeline(
        "Create a small REST API with one endpoint and a real automated behavioral test.",
      ),
      true,
    );
  });

  it("goalRequiresRealTests detects behavioral test requirement", () => {
    assert.equal(goalRequiresRealTests("real automated behavioral test"), true);
  });
});
