import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyRequest, requiresMandatoryDecomposition } from "./request-classification.js";

describe("request classification", () => {
  it("classifies a login form as SMALL_TASK", () => {
    assert.equal(classifyRequest("Create a login form"), "SMALL_TASK");
  });

  it("classifies adding attendance as FEATURE", () => {
    assert.equal(classifyRequest("Add attendance to my school app"), "FEATURE");
  });

  it("classifies a basic dashboard as MVP", () => {
    assert.equal(classifyRequest("Create a basic school dashboard"), "MVP");
  });

  it("classifies a complete school system as FULL_APPLICATION", () => {
    assert.equal(classifyRequest("Create a complete school management system."), "FULL_APPLICATION");
    assert.equal(classifyRequest("Create a school management system."), "FULL_APPLICATION");
  });

  it("requires decomposition for full applications", () => {
    assert.equal(requiresMandatoryDecomposition("FULL_APPLICATION"), true);
    assert.equal(requiresMandatoryDecomposition("SMALL_TASK"), false);
  });
});
