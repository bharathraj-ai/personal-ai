import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isStrictCodingSuccess } from "./verification-success.js";

describe("isStrictCodingSuccess", () => {
  it("requires PASSED tests for FULL_APPLICATION", () => {
    assert.equal(
      isStrictCodingSuccess(
        {
          status: "UNCERTAIN",
          build: "PASSED",
          tests: "NO_TESTS",
          runtime: "NOT_RUN",
          security: "NOT_IMPLEMENTED",
          attempts: 1,
        },
        "FULL_APPLICATION",
      ),
      false,
    );
    assert.equal(
      isStrictCodingSuccess(
        {
          status: "VERIFIED",
          build: "PASSED",
          tests: "PASSED",
          runtime: "NOT_RUN",
          security: "NOT_IMPLEMENTED",
          attempts: 1,
        },
        "FULL_APPLICATION",
      ),
      true,
    );
  });

  it("does not treat NO_TESTS as success for SMALL_TASK", () => {
    assert.equal(
      isStrictCodingSuccess(
        {
          status: "UNCERTAIN",
          build: "SKIPPED",
          tests: "NO_TESTS",
          runtime: "NOT_RUN",
          security: "NOT_IMPLEMENTED",
          attempts: 1,
        },
        "SMALL_TASK",
      ),
      false,
    );
  });
});
