import test, { describe, it } from "node:test";
import assert from "node:assert";
import { ProjectScanner } from "./project-scanner.js";
import { ProjectAnalyzer } from "./project-analyzer.js";
import { join } from "node:path";

describe("ProjectScanner", () => {
  it("scans a valid directory and ignores secrets", async () => {
    const scanner = new ProjectScanner();
    const result = await scanner.scan({
      rootDir: process.cwd(), // Let's scan our own repo for test
      ignoredPatterns: ["node_modules", ".git", "dist", "build", "coverage", ".next"]
    });

    assert.ok(result.files.length > 0);
    
    // Check classification
    const sourceFiles = result.files.filter(f => f.category === "SOURCE");
    assert.ok(sourceFiles.length > 0);
    
    const secretFiles = result.files.filter(f => f.category === "SECRET");
    for (const secret of secretFiles) {
      assert.strictEqual(secret.hash, "REDACTED");
    }

    const packageJson = result.files.find(f => f.name === "package.json");
    if (packageJson) {
      assert.strictEqual(packageJson.category, "DEPENDENCY");
    }
  });
});

describe("ProjectAnalyzer", () => {
  it("analyzes structure correctly", async () => {
    const scanner = new ProjectScanner();
    const analyzer = new ProjectAnalyzer();
    const result = await scanner.scan({
      rootDir: process.cwd(),
      ignoredPatterns: ["node_modules", ".git", "dist", "build"]
    });

    const knowledge = await analyzer.analyze(result);
    assert.ok(knowledge.structure);
    assert.ok(["monorepo", "single"].includes(knowledge.structure.type));
    assert.ok(knowledge.technologies.length > 0);
  });
});
