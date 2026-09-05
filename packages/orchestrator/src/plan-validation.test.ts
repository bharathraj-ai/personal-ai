import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveArchitectureConstraints,
  planTextViolatesConstraints,
} from "./architecture-constraints.js";
import {
  validateProjectPlan,
  freezeApprovedPlan,
  canResumeStoredProject,
  resolveApprovedPlanForRun,
} from "./plan-validation.js";
import { schoolManagementProjectPlan } from "./project-plan.js";
import { defaultImplementationPlan } from "./requirement-analysis.js";

describe("architecture constraints", () => {
  it("A: Neon/PostgreSQL approval prevents file-json plan text", () => {
    const constraints = deriveArchitectureConstraints(
      "school with PostgreSQL persistence and Neon",
      { deployment: "PostgreSQL/Neon via DATABASE_URL" },
    );
    assert.equal(constraints.database, "postgresql");
    const violations = planTextViolatesConstraints(
      "File-backed JSON store (data/db.json)",
      constraints,
    );
    assert.ok(violations.length > 0);
  });

  it("B: localStorage plan rejected when PostgreSQL approved", () => {
    const constraints = deriveArchitectureConstraints("app with PostgreSQL", {
      deployment: "Neon PostgreSQL",
    });
    const result = validateProjectPlan(
      schoolManagementProjectPlan(1),
      constraints,
      {
        ...defaultImplementationPlan("school management", {}),
        database: "Redux persist with localStorage",
        architecture: "SPA with localStorage",
      },
    );
    assert.equal(result.status, "PLAN_INVALID");
    assert.ok(result.violations.some((v: string) => /localStorage|forbidden/i.test(v)));
  });
});

describe("approval freeze", () => {
  it("canResumeStoredProject accepts architectureConstraints without approvedPlan snapshot", () => {
    assert.equal(
      canResumeStoredProject({
        completedModuleIds: [],
        failedModuleIds: [],
        partialModuleIds: [],
        providersUsed: [],
        attemptCount: 0,
        lifecycleState: "IMPLEMENTING",
        architectureConstraints: {
          database: "postgresql",
          authentication: "session",
          roles: ["ADMIN"],
          storage: "storage-service",
        },
      }),
      true,
    );
  });

  it("C: approved architecture cannot silently change on resolve", () => {
    const constraints = deriveArchitectureConstraints("school PostgreSQL", {
      deployment: "Neon",
    });
    const plan = schoolManagementProjectPlan(1);
    const frozen = freezeApprovedPlan({
      plan,
      constraints,
      clarificationAnswers: { deployment: "Neon PostgreSQL" },
    });
    const resolved = resolveApprovedPlanForRun(frozen);
    assert.equal(resolved.frozen, true);
    assert.equal(resolved.constraints?.database, "postgresql");
    assert.equal(
      resolved.plan.implementationProgress?.completedModuleIds?.length ?? 0,
      0,
    );
  });
});

describe("requirement-driven school plan", () => {
  it("modules have no hardcoded implementation file paths", () => {
    const plan = schoolManagementProjectPlan(1);
    for (const mod of plan.modules) {
      assert.equal(mod.files, undefined, `${mod.id} must not inject files`);
    }
  });

  it("default school implementation plan passes PostgreSQL validation", () => {
    const goal =
      "Build a complete Phase-1 School Management System with ADMIN, TEACHER and STUDENT roles, email/password session authentication, PostgreSQL/Neon persistence";
    const constraints = deriveArchitectureConstraints(goal, {
      deployment: "Neon PostgreSQL DATABASE_URL",
    });
    const impl = defaultImplementationPlan(goal, { deployment: "Neon PostgreSQL DATABASE_URL" });
    const result = validateProjectPlan(impl.projectPlan!, constraints, impl);
    assert.equal(result.status, "VALID_PLAN");
  });
});

describe("simple company website plan", () => {
  it("does not freeze ADMIN roles when auth is none", () => {
    const goal = "create web site for iron box company";
    const constraints = deriveArchitectureConstraints(goal, {
      scope: "Marketing brochure site: Home, About, Products/Services, Contact",
      // Stale LLM default that previously polluted role inference:
      __user_clarification: "Admin dashboard optional later",
    });
    assert.equal(constraints.authentication, "none");
    assert.deepEqual(constraints.roles, []);
    assert.equal(constraints.database, "none");
  });

  it("website plan is VALID even if stale constraints still list ADMIN", () => {
    const goal = "create web site for iron box company";
    const impl = defaultImplementationPlan(goal, {
      scope: "Marketing brochure site: Home, About, Products/Services, Contact",
    });
    const staleConstraints = {
      database: "none" as const,
      authentication: "none" as const,
      roles: ["ADMIN"],
      storage: "storage-service" as const,
      storageFallback: "local-file" as const,
    };
    const result = validateProjectPlan(impl.projectPlan!, staleConstraints, impl);
    assert.equal(result.status, "VALID_PLAN", result.violations?.join("; "));
  });

  it("school goals still require ADMIN in the plan when roles are frozen", () => {
    const constraints = deriveArchitectureConstraints(
      "school management system with Admin Teacher Student",
      { roles: "Admin, Teacher, Student", auth: "Email/password with signed sessions" },
    );
    assert.ok(constraints.roles.includes("ADMIN"));
    assert.equal(constraints.authentication, "session");
    const badPlan = {
      goal: "school management system",
      modules: [{ id: "MODULE-CORE", name: "Core", description: "brochure pages only" }],
    };
    const result = validateProjectPlan(badPlan as any, constraints);
    assert.equal(result.status, "PLAN_INVALID");
    assert.ok(result.violations.some((v: string) => /approved roles missing/i.test(v)));
  });
});
