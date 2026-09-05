import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultClarificationQuestions,
  defaultImplementationPlan,
  formatImplementationPlanForUser,
  hasClarificationAnswers,
  isLargeImplementationRequest,
  mergeClarificationAnswers,
  normalizeImplementationPlan,
} from "./requirement-analysis.js";
import {
  isProjectOGoal,
  isSchoolManagementGoal,
  isWebsiteGoal,
  extractProjectName,
  resolveBootstrapKind,
  isProjectRevisionRequest,
  shouldUseTemplateBootstrap,
  isProjectResumeRequest,
} from "./coding-bootstrap.js";

describe("requirement analysis", () => {
  it("detects large implementation requests", () => {
    assert.equal(isLargeImplementationRequest("Create a school management system."), true);
    assert.equal(isProjectOGoal("Create Project O and build a model that predicts ocean temperature."), true);
    assert.equal(isLargeImplementationRequest("What time is it?"), false);
    assert.equal(isWebsiteGoal("create we site for iron box company"), true);
    assert.equal(isLargeImplementationRequest("create we site for iron box company"), true);
    assert.equal(extractProjectName("create website for iron box company"), "iron box company");
    assert.equal(extractProjectName("create we site for iron box company"), "iron box company");
  });

  it("provides school management clarifications without a Next.js vs React question", () => {
    const qs = defaultClarificationQuestions("Create a school management system.");
    assert.ok(qs.some((q) => /Admin.*Teacher.*Student/i.test(q.question)));
    assert.equal(qs.some((q) => q.id === "stack"), false);
    assert.equal(qs.some((q) => /Next\.js or React/i.test(q.question)), false);
  });

  it("does not ask generic stack choice for a new web app", () => {
    const qs = defaultClarificationQuestions("Build a complete inventory web application");
    assert.equal(qs.some((q) => q.id === "stack"), false);
    assert.equal(qs.some((q) => /Next\.js or React/i.test(q.question)), false);
  });

  it("builds school management plan with defaults and a ProjectPlan", () => {
    const plan = defaultImplementationPlan("Create a school management system.", {
      roles: "Admin, Teacher, Student, Parent",
    });
    assert.ok(plan.components.length >= 3);
    assert.equal(plan.scope, "FULL_APPLICATION");
    assert.ok(plan.projectPlan);
    assert.ok((plan.projectPlan?.pages.length ?? 0) >= 8);
    assert.equal(isSchoolManagementGoal("school management"), true);
  });

  it("formats partial LLM plans without crashing when components is missing", () => {
    const partial = {
      objective: "create website for iron box company",
      architecture: "static HTML",
    } as any;
    const text = formatImplementationPlanForUser(partial);
    assert.match(text, /Implementation Plan/);
    assert.match(text, /Components/);
    assert.equal(text.includes("AWAITING_IMPLEMENTATION_APPROVAL"), true);
    const normalized = normalizeImplementationPlan(partial, "create website for iron box company");
    assert.ok(Array.isArray(normalized.components));
    assert.ok(normalized.components.length > 0);
  });

  it("detects clarification answers including freeform", () => {
    assert.equal(hasClarificationAnswers(undefined), false);
    assert.equal(hasClarificationAnswers({ __use_defaults: "true" }), true);
    assert.equal(hasClarificationAnswers({ auth: "JWT" }), true);
    assert.equal(hasClarificationAnswers({ __user_clarification: "local deploy" }), true);
  });

  it("merges clarification answers with defaults", () => {
    const qs = defaultClarificationQuestions("Create a school management system.");
    const merged = mergeClarificationAnswers(qs, { auth: "JWT sessions" });
    assert.equal(merged.auth, "JWT sessions");
    assert.ok(merged.roles);
  });

  it("uses templates only for website/Project O/demo, not default school FULL_APPLICATION", () => {
    assert.equal(
      shouldUseTemplateBootstrap("school_management", "Create a complete school management system."),
      false,
    );
    assert.equal(
      shouldUseTemplateBootstrap(
        "school_management",
        "Create a school management system (quick-start demo)",
      ),
      true,
    );
    assert.equal(shouldUseTemplateBootstrap("website", "make a website for Acme"), true);
    assert.equal(shouldUseTemplateBootstrap("project_o", "Project O ocean temperature"), true);
    assert.equal(isProjectResumeRequest("continue my school management project"), true);
  });

  it("prefers school_management bootstrap when goal mentions website + school", () => {
    assert.equal(
      resolveBootstrapKind("create website for school management"),
      "school_management",
    );
  });

  it("detects project revision requests", () => {
    assert.equal(isProjectRevisionRequest("it not having role based access in the project"), true);
  });
});
