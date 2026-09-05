// extractJsonObject is used in structured-output.ts; FileSpecification, parseFileSpecification, FILE_SPEC_SYSTEM are defined there.

export interface ModuleContract {
  moduleId: string;
  goal: string;
  requirements: string[];
  files: string[];
  dependencies: string[];
  inputs: string[];
  outputs: string[];
  acceptanceTests: string[];
  constraints: string[];
}

/** Compact JSON for provider prompts — one module only, not the whole application. */
export function compactModuleContractForPrompt(contract: ModuleContract): string {
  return JSON.stringify({
    id: contract.moduleId,
    goal: contract.goal,
    reqs: contract.requirements.slice(0, 8),
    files: contract.files.slice(0, 8),
    deps: contract.dependencies,
    tests: contract.acceptanceTests.slice(0, 6),
    constraints: contract.constraints.slice(0, 6),
  });
}

export function buildModuleContract(mod: {
  id: string;
  name: string;
  dependsOn: string[];
  requirements: string[];
  fileHints: string[];
  acceptance: string[];
}): ModuleContract {
  const files = [...new Set(mod.fileHints.filter(Boolean))].slice(0, 12);
  const needsDb = /student|teacher|class|attendance|database|persist|crud/i.test(
    `${mod.name} ${mod.requirements.join(" ")}`,
  );
  return {
    moduleId: mod.id,
    goal: mod.name,
    requirements: mod.requirements.slice(0, 12),
    files,
    dependencies: mod.dependsOn,
    inputs: [],
    outputs: files,
    acceptanceTests: mod.acceptance.slice(0, 12),
    constraints: [
      "implement only listed files",
      "do not generate the rest of the application",
      "use node:test for tests not jest or supertest",
      "use node:http stdlib not express unless plan requires express",
      ...(needsDb
        ? ["use project database", "do not use hardcoded arrays", "do not use mock persistence"]
        : []),
    ],
  };
}

export function isVacuousTestContent(content: string): boolean {
  const t = content.replace(/\s+/g, " ");
  if (/expect\(\s*true\s*\)\.toBe\(\s*true\s*\)/.test(t)) return true;
  if (/console\.log\s*\(\s*['"](?:test passed|ok|pass)/i.test(t)) return true;
  if (/No tests specified/i.test(t)) return true;
  if (/test\s*\(\s*['"]sample test['"]/.test(t) && /toBe\(\s*true\s*\)/.test(t)) return true;
  return false;
}

/** Reject express/jest package.json for node-stdlib school apps. */
export function isWrongStackPackageJson(path: string, content: string): boolean {
  if (!/package\.json$/i.test(path)) return false;
  return /"express"|"jest"|"supertest"|"vitest"/i.test(content);
}

/** Reject CommonJS require() in ESM test files — use import instead. */
export function isCommonJsTestContent(path: string, content: string): boolean {
  if (!/\.(test|spec)\./i.test(path)) return false;
  return /\brequire\s*\(\s*['"]node:/.test(content);
}

/** Reject jest/supertest when node-stdlib + node:test is required. */
export function isWrongTestFrameworkContent(content: string): boolean {
  return (
    /\b(require|import)\s*\(?['"]supertest['"]\)?/.test(content) ||
    /\bfrom\s+['"]supertest['"]/.test(content) ||
    /\bjest\b/.test(content) ||
    (/\bdescribe\s*\(\s*['"]/.test(content) && /\bexpect\s*\(/.test(content))
  );
}

export function isPlaceholderImplementation(content: string): boolean {
  const t = content.trim();
  if (t.length < 8) return true;
  if (/^\s*(\/\/|#)\s*(TODO|FIXME|placeholder)/i.test(t) && t.length < 80) return true;
  if (/not implemented|throw new Error\(['"]TODO/i.test(t) && t.length < 120) return true;
  return false;
}

export function isFakeDatabaseContent(path: string, content: string): boolean {
  if (/\.(test|spec)\./i.test(path) || /readme/i.test(path)) return false;
  if (/\bconst\s+(students|teachers|users|attendance|classes)\s*=\s*\[/.test(content)) return true;
  if (/fake repository|mock database|in-memory array as production/i.test(content)) return true;
  return false;
}

export function shouldSkipExistingFile(path: string, content: string): boolean {
  const body = content.trim();
  if (body.length < 8) return false;
  if (isVacuousTestContent(body)) return false;
  if (isPlaceholderImplementation(body)) return false;
  if (isFakeDatabaseContent(path, body)) return false;
  return true;
}

// FileSpecification, parseFileSpecification, and FILE_SPEC_SYSTEM are defined in structured-output.ts
// Re-exported via index.ts — do not duplicate here.
