import type { PlanItem } from "@personal-ai/shared";

export type RequirementEvidenceStatus = "VERIFIED" | "PARTIAL" | "FAILED" | "NOT_TESTED";

export interface RequirementEvidence {
  requirement: string;
  requirementId: string;
  implementationEvidence: string;
  testEvidence: string;
  status: RequirementEvidenceStatus;
}

function hasPersistence(files: string[], contents?: Record<string, string>): boolean {
  const names = files.join(" ").toLowerCase();
  if (/\b(prisma|schema\.sql|db\.json|store\.js|store\.ts|database)\b/.test(names)) return true;
  if (!contents) return false;
  return Object.values(contents).some((c) =>
    /\b(INSERT|createStudent|writeFile\(|prisma\.|db\.json|persist)\b/i.test(c),
  );
}

function hasAuth(files: string[]): boolean {
  return files.some((f) => /auth|login|rbac|session/i.test(f.replace(/\\/g, "/")));
}

function hasHardcodedProductionArrays(contents?: Record<string, string>): boolean {
  if (!contents) return false;
  for (const [path, body] of Object.entries(contents)) {
    if (/readme|test/i.test(path)) continue;
    if (/\bconst\s+(students|teachers|users|fees)\s*=\s*\[/.test(body) && !/SEED_DATA|MOCK_DATA/.test(body)) {
      return true;
    }
  }
  return false;
}

function isTestArtifactPath(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(p) ||
    /(^|\/)test\.[cm]?[jt]s$/i.test(p) ||
    /(^|\/)tests?\/.+\.(js|mjs|cjs|ts|tsx)$/i.test(p) ||
    /(^|\/)test_.+\.py$/i.test(p) ||
    /(^|\/)tests\/.+\.py$/i.test(p)
  );
}

/**
 * Per-requirement evidence. Never VERIFIED without matching tests + implementation.
 */
export function evaluateRequirementEvidence(input: {
  requirements: PlanItem[];
  files: string[];
  contents?: Record<string, string>;
  testsPassed: boolean;
  buildPassed: boolean;
}): RequirementEvidence[] {
  const persistence = hasPersistence(input.files, input.contents);
  const auth = hasAuth(input.files);
  const hardcoded = hasHardcodedProductionArrays(input.contents);
  const testFiles = input.files.filter(isTestArtifactPath);

  return input.requirements
    .filter((r) => r.status !== "deferred")
    .map((r) => {
      const tokens = r.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4);
      const implFiles = input.files.filter((f) => {
        const n = f.toLowerCase().replace(/\\/g, "/");
        return tokens.some((t) => n.includes(t));
      });
      const testHit = testFiles.some((f) => {
        const n = f.toLowerCase().replace(/\\/g, "/");
        return tokens.some((t) => n.includes(t));
      });
      const implemented = implFiles.length > 0;
      const needsAuth = /auth|login|rbac|authorization|role-based/i.test(r.name);
      const needsPersist =
        /\b(save|mark|payment|persist|crud|attendance|fee|database|postgresql|neon)\b/i.test(r.name) &&
        !/\bREST API\b/i.test(r.name);

      let status: RequirementEvidenceStatus = "NOT_TESTED";
      if (!implemented) status = "FAILED";
      else if (!input.buildPassed) status = "FAILED";
      else if (needsPersist && hardcoded) status = "PARTIAL";
      else if (needsPersist && !persistence) status = "PARTIAL";
      else if (needsAuth && !auth) status = "PARTIAL";
      else if (!testHit || !input.testsPassed) status = "NOT_TESTED";
      else status = "VERIFIED";

      return {
        requirement: r.name,
        requirementId: r.id,
        implementationEvidence: implemented ? implFiles.slice(0, 6).join(", ") : "no matching files",
        testEvidence: testHit
          ? input.testsPassed
            ? "matching tests executed and passed"
            : "matching tests present but did not pass"
          : "no matching tests",
        status,
      };
    });
}
