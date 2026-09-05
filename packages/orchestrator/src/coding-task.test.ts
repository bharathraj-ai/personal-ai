import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyCodingTask, codingRequiresReliableSpecialist } from "./coding-task.js";

describe("classifyCodingTask", () => {
  it("classifies hello.py as TRIVIAL", () => {
    assert.equal(
      classifyCodingTask("Create hello.py that prints Hello World."),
      "TRIVIAL",
    );
  });

  it("classifies a small REST API as SMALL_PROJECT", () => {
    assert.equal(
      classifyCodingTask("Create a small REST API with one endpoint and a test."),
      "SMALL_PROJECT",
    );
  });

  it("classifies school management as FULL_APPLICATION", () => {
    assert.equal(
      classifyCodingTask("Create a complete school management system."),
      "FULL_APPLICATION",
    );
    assert.equal(codingRequiresReliableSpecialist("FULL_APPLICATION"), true);
  });
});
