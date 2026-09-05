export type DetectedProjectType = "node" | "python" | "unsupported";

export function detectProjectType(files: string[]): {
  type: DetectedProjectType;
  hasPackageJson: boolean;
  hasPythonManifest: boolean;
} {
  const normalized = files.map((f) => f.replace(/\\/g, "/"));
  const hasPackageJson = normalized.some((f) => f === "package.json" || f.endsWith("/package.json"));
  const hasPythonManifest = normalized.some(
    (f) =>
      f === "requirements.txt" ||
      f.endsWith("/requirements.txt") ||
      f === "pyproject.toml" ||
      f.endsWith("/pyproject.toml"),
  );
  const hasPySource = normalized.some((f) => f.endsWith(".py") && !f.includes("node_modules"));
  const hasNodeSource = normalized.some(
    (f) => /\.(js|mjs|cjs|ts|tsx)$/.test(f) && !f.includes("node_modules"),
  );

  if (hasPackageJson || (hasNodeSource && !hasPythonManifest)) {
    return { type: "node", hasPackageJson, hasPythonManifest };
  }
  if (hasPythonManifest || hasPySource) {
    return { type: "python", hasPackageJson, hasPythonManifest };
  }
  return { type: "unsupported", hasPackageJson, hasPythonManifest };
}

export function isNodeTestFile(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(p)) return true;
  if (/(^|\/)test\.[cm]?[jt]s$/i.test(p)) return true;
  if (/(^|\/)tests\/.+\.(js|mjs|cjs|ts|tsx)$/i.test(p)) return true;
  return false;
}

export function isPythonTestFile(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  return (
    /(^|\/)test_.+\.py$/i.test(p) ||
    /(^|\/)tests\/.+\.py$/i.test(p) ||
    /\.test\.py$/i.test(p) ||
    /_test\.py$/i.test(p)
  );
}

export function isPlaceholderTestCommand(script: string): boolean {
  const s = script.trim();
  if (!s) return true;
  if (/^exit\s+0\s*$/i.test(s)) return true;
  if (/echo\s+["'].*no tests/i.test(s) && !/\b(jest|vitest|mocha|node --test|pytest)\b/i.test(s)) {
    return true;
  }
  return false;
}

export function isVacuousTestSource(content: string): boolean {
  const body = content.replace(/\/\/.*$/gm, "").replace(/#.*$/gm, "");
  if (/expect\s*\(\s*true\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)/i.test(body)) return true;
  if (/\bassert\s+True\b/i.test(body)) return true;
  if (/test\s*\(\s*['"]sample test['"]/i.test(body) && /expect\s*\(\s*true\s*\)/i.test(body)) {
    return true;
  }
  return false;
}

export function goalRequiresRealTests(goal: string): boolean {
  return /\b(automated|real)\s+test|\bwith tests?\b|\bbehavioral test/i.test(goal);
}

export function hasBehavioralTestSignal(content: string): boolean {
  return (
    /\b(statusCode|status\s*===|assert\.(strictEqual|equal|deepStrictEqual)|expect\s*\([^)]+\)\.(toBe|toEqual|toStrictEqual|toMatchObject))/i.test(
      content,
    ) ||
    /\b(client\.(get|post|put|delete)|request\s*\(|fetch\s*\(|supertest|pytest|test_client)/i.test(
      content,
    )
  );
}
