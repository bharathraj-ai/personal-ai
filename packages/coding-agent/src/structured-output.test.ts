import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject, parseStructuredCodingOutput, stripJsonFence } from "./structured-output.js";

describe("stripJsonFence", () => {
  it("strips ```json fences", () => {
    const { text, stripped } = stripJsonFence('```json\n{"a":1}\n```');
    assert.equal(stripped, true);
    assert.equal(text, '{"a":1}');
  });
});

describe("extractJsonObject", () => {
  it("extracts JSON from Groq-style fenced output", () => {
    const raw = '```json\n{"path":"src/auth.js","purpose":"auth"}\n```';
    const { text, extracted } = extractJsonObject(raw);
    assert.equal(extracted, true);
    assert.equal(JSON.parse(text).path, "src/auth.js");
  });

  it("extracts JSON with surrounding prose", () => {
    const raw =
      'Here is the file spec:\n```json\n{"path":"src/auth.js","purpose":"auth","exports":[],"dependencies":[]}\n```\nHope that helps.';
    const { text, extracted } = extractJsonObject(raw);
    assert.equal(extracted, true);
    assert.equal(JSON.parse(text).path, "src/auth.js");
  });

  it("does not accept ambiguous prose with broken JSON", () => {
    const raw = "Sure, here is code { not json } and more { \"files\": [] }";
    const parsed = parseStructuredCodingOutput(raw);
    assert.equal(parsed.ok, false);
  });

  it("rejects truncated JSON", () => {
    const raw = '{"summary":"x","files":[{"path":"a.js","operation":"create","content":"';
    const parsed = parseStructuredCodingOutput(raw);
    assert.equal(parsed.ok, false);
  });
});

describe("parseStructuredCodingOutput", () => {
  it("accepts schema-valid JSON", () => {
    const raw = JSON.stringify({
      summary: "hello",
      files: [{ path: "hello.py", operation: "create", content: 'print("Hello World")\n' }],
      commands: [],
      tests: [],
      notes: [],
    });
    const parsed = parseStructuredCodingOutput(raw);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.files[0]?.path, "hello.py");
    }
  });

  it("normalizes a json fence without treating prose JSON-extraction as success", () => {
    const raw =
      '```json\n{"summary":"x","files":[{"path":"a.py","operation":"create","content":"print(1)"}]}\n```';
    const parsed = parseStructuredCodingOutput(raw);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.normalizedFence, true);
  });

  it("rejects invalid JSON instead of greedy-matching braces", () => {
    const raw = 'Sure, here is code { not json } and more { "files": [] }';
    const parsed = parseStructuredCodingOutput(raw);
    assert.equal(parsed.ok, false);
  });

  it("rejects path traversal", () => {
    const raw = JSON.stringify({
      summary: "bad",
      files: [{ path: "../etc/passwd", operation: "create", content: "x" }],
    });
    const parsed = parseStructuredCodingOutput(raw);
    assert.equal(parsed.ok, false);
  });

  it("rejects empty files", () => {
    const parsed = parseStructuredCodingOutput(JSON.stringify({ summary: "x", files: [] }));
    assert.equal(parsed.ok, false);
  });

  it("rejects vacuous tests and unexpected paths", () => {
    const vacuous = parseStructuredCodingOutput(
      JSON.stringify({
        summary: "t",
        files: [
          {
            path: "src/__tests__/sample.test.js",
            operation: "create",
            content: "test('sample test', () => { expect(true).toBe(true); });",
          },
        ],
      }),
    );
    assert.equal(vacuous.ok, false);
    const unexpected = parseStructuredCodingOutput(
      JSON.stringify({
        summary: "t",
        files: [{ path: "src/other.js", operation: "create", content: "module.exports = 1;\n" }],
      }),
      { allowedPaths: ["src/student.js"] },
    );
    assert.equal(unexpected.ok, false);
  });
});
