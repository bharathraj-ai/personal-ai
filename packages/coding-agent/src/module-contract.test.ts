import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildModuleContract,
  compactModuleContractForPrompt,
  isVacuousTestContent,
  shouldSkipExistingFile,
} from "./module-contract.js";
import { parseFileSpecification } from "./structured-output.js";


describe("ModuleContract", () => {
  it("builds a compact contract without dumping the whole project", () => {
    const c = buildModuleContract({
      id: "STUDENT",
      name: "Student management",
      dependsOn: ["AUTH", "ROLES"],
      requirements: ["create student", "list students"],
      fileHints: ["src/student.js", "src/__tests__/student.test.js"],
      acceptance: ["student can be created"],
    });
    assert.equal(c.moduleId, "STUDENT");
    assert.deepEqual(c.dependencies, ["AUTH", "ROLES"]);
    assert.ok(c.constraints.some((x) => /database/i.test(x)));
  });

  it("does not skip vacuous tests", () => {
    assert.equal(isVacuousTestContent("test('sample test', () => { expect(true).toBe(true); });"), true);
    assert.equal(
      shouldSkipExistingFile("src/__tests__/sample.test.js", "test('sample test', () => { expect(true).toBe(true); });"),
      false,
    );
    assert.equal(shouldSkipExistingFile("src/auth.js", "module.exports = { login() { return true; } };\n"), true);
  });

  it("parses a file specification", () => {
    const p = parseFileSpecification(
      JSON.stringify({ path: "src/student.js", purpose: "CRUD", exports: ["createStudent"] }),
    );
    assert.equal(p.ok, true);
    if (p.ok) assert.equal(p.value.path, "src/student.js");
  });

  it("parses Groq fenced file specification with prose", () => {
    const raw =
      'Sure:\n```json\n{"path":"src/auth.js","purpose":"login","exports":["login"],"dependencies":[]}\n```';
    const p = parseFileSpecification(raw);
    assert.equal(p.ok, true);
    if (p.ok) assert.equal(p.value.path, "src/auth.js");
  });

  it("rejects schema-invalid file specification", () => {
    const p = parseFileSpecification(JSON.stringify({ purpose: "missing path" }));
    assert.equal(p.ok, false);
  });

  it("compact contract stays small for one module", () => {
    const c = buildModuleContract({
      id: "AUTH",
      name: "Authentication",
      dependsOn: [],
      requirements: ["login", "logout", "session"],
      fileHints: ["src/auth.js", "src/session.js", "test/auth.test.js"],
      acceptance: ["valid login succeeds"],
    });
    const compact = compactModuleContractForPrompt(c);
    assert.ok(compact.length < 600, `compact contract too large: ${compact.length}`);
    const parsed = JSON.parse(compact) as { id: string; files: string[] };
    assert.equal(parsed.id, "AUTH");
    assert.equal(parsed.files.length, 3);
  });
});
