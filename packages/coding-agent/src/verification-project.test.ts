import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectProjectType,
  isNodeTestFile,
  isVacuousTestSource,
  hasBehavioralTestSignal,
  isPlaceholderTestCommand,
  goalRequiresRealTests,
} from "./verification-project.js";

describe("verification-project", () => {
  it("detects node projects with package.json", () => {
    const d = detectProjectType(["package.json", "server.js"]);
    assert.equal(d.type, "node");
  });

  it("recognizes root test.js as a node test file", () => {
    assert.equal(isNodeTestFile("test.js"), true);
    assert.equal(isNodeTestFile("src/app.test.js"), true);
    assert.equal(isNodeTestFile("server.js"), false);
  });

  it("rejects vacuous tests", () => {
    assert.equal(isVacuousTestSource("expect(true).toBe(true);"), true);
    assert.equal(isVacuousTestSource("assert True"), true);
    assert.equal(
      isVacuousTestSource('test("health", () => expect(res.statusCode).toBe(200));'),
      false,
    );
  });

  it("accepts behavioral HTTP test signals", () => {
    const body = `
      const res = await request(app).get("/api/health");
      expect(res.statusCode).toBe(200);
    `;
    assert.equal(hasBehavioralTestSignal(body), true);
  });

  it("rejects placeholder npm test scripts", () => {
    assert.equal(isPlaceholderTestCommand('echo "No tests specified" && exit 0'), true);
    assert.equal(isPlaceholderTestCommand("node --test test.js"), false);
  });

  it("goalRequiresRealTests matches REST acceptance goals", () => {
    assert.equal(
      goalRequiresRealTests("Create a small REST API with one endpoint and a real automated test."),
      true,
    );
    assert.equal(goalRequiresRealTests("Create a hello world page"), false);
  });
});
