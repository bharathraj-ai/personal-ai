import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ClarificationQuestion } from "@personal-ai/shared";
import {
  decideFramework,
  detectExistingStack,
  filterClarificationQuestions,
  formatFrameworkNotice,
  isOptionalTechnicalQuestion,
} from "./framework-decision.js";

describe("framework decision", () => {
  it("selects Express + Node + Jest for P16 REST behavioral test goal", () => {
    const goal =
      "Create a small REST API with one endpoint and a real automated behavioral test.";
    const arch = decideFramework({ goal });
    assert.equal(arch.framework, "node-stdlib");
    assert.equal(arch.backend, "express");
    assert.equal(arch.testing, "jest");
    assert.match(formatFrameworkNotice(arch), /Express \+ Node\.js \+ Jest/);
    const withPrior = decideFramework({
      goal,
      prior: decideFramework({ goal: "Build a complete inventory web application" }),
    });
    assert.equal(withPrior.backend, "express");
    assert.equal(withPrior.framework, "node-stdlib");
  });

  it("selects Express + Node + Jest for a small REST API acceptance goal", () => {
    const arch = decideFramework({
      goal: "Create a small REST API with one endpoint and a real automated test.",
    });
    assert.equal(arch.framework, "node-stdlib");
    assert.equal(arch.language, "javascript");
    assert.equal(arch.backend, "express");
    assert.equal(arch.testing, "jest");
    assert.equal(arch.database, "none");
    assert.equal(arch.source, "constraint");
    assert.match(formatFrameworkNotice(arch), /Express \+ Node\.js \+ Jest/);
  });

  it("defaults a new web application to Next.js + TypeScript without confirmation", () => {
    const arch = decideFramework({ goal: "Build a complete inventory web application" });
    assert.equal(arch.framework, "nextjs");
    assert.equal(arch.language, "typescript");
    assert.equal(arch.decision.user_confirmation_required, false);
    assert.equal(arch.decision.confidence, "high");
    assert.match(formatFrameworkNotice(arch), /Next\.js \+ TypeScript/);
  });

  it("preserves an existing Vite + React + TypeScript stack", () => {
    const arch = decideFramework({
      goal: "Add a settings page",
      inspection: {
        files: ["package.json", "vite.config.ts", "tsconfig.json", "src/", "src/App.tsx"],
        packageJson: JSON.stringify({
          dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" },
          devDependencies: { vite: "^5.0.0", typescript: "^5.0.0" },
        }),
      },
    });
    assert.equal(arch.framework, "react-vite");
    assert.equal(arch.language, "typescript");
    assert.equal(arch.source, "existing_project");
    assert.equal(arch.decision.user_confirmation_required, false);
    assert.match(formatFrameworkNotice(arch), /Vite \+ React/);
  });

  it("follows an explicit React + FastAPI request", () => {
    const arch = decideFramework({ goal: "Build it with React and FastAPI." });
    assert.equal(arch.framework, "react-spa");
    assert.equal(arch.language, "typescript");
    assert.equal(arch.backend, "fastapi");
    assert.equal(arch.source, "user");
    assert.equal(arch.decision.user_confirmation_required, false);
  });

  it("does not treat bare React as a reason to leave Next.js", () => {
    const arch = decideFramework({ goal: "Build a React dashboard for students" });
    assert.equal(arch.framework, "nextjs");
    assert.equal(arch.language, "typescript");
  });

  it("reuses a stored architecture and does not ask again", () => {
    const prior = decideFramework({ goal: "Build a complete inventory web application" });
    const again = decideFramework({
      goal: "Continue the inventory app — add reports",
      prior,
    });
    assert.equal(again.framework, "nextjs");
    assert.equal(again.source, "existing_plan");
    assert.equal(again.decision.user_confirmation_required, false);
  });

  it("detects Next.js from next.config and package.json", () => {
    const found = detectExistingStack({
      files: ["next.config.ts", "package.json", "app/", "tsconfig.json"],
      packageJson: JSON.stringify({ dependencies: { next: "14.0.0", react: "18.0.0" } }),
    });
    assert.equal(found?.framework, "nextjs");
  });

  it("filters Next.js vs React clarification questions", () => {
    const questions: ClarificationQuestion[] = [
      {
        id: "stack",
        question: "Should I use Next.js or React.js?",
        category: "architecture",
      },
      {
        id: "roles",
        question: "Should students and parents have separate accounts?",
        category: "roles",
      },
    ];
    const arch = decideFramework({ goal: "Create a school portal web application" });
    const kept = filterClarificationQuestions(questions, arch);
    assert.equal(kept.some((q) => q.id === "stack"), false);
    assert.equal(kept.some((q) => q.id === "roles"), true);
    assert.equal(isOptionalTechnicalQuestion(questions[0]!), true);
    assert.equal(isOptionalTechnicalQuestion(questions[1]!), false);
  });

  it("does not reuse REST prior architecture for school management goal", () => {
    const restPrior = decideFramework({
      goal: "Create a small REST API with one endpoint and a real automated behavioral test.",
    });
    const school = decideFramework({
      goal: "Build a complete Phase-1 School Management System with PostgreSQL/Neon persistence",
      prior: restPrior,
    });
    assert.equal(school.backend, "node-http");
    assert.notEqual(school.database, "none");
    assert.equal(school.source, "constraint");
  });

  it("asks only when the user rejects Next.js without an alternative", () => {
    const arch = decideFramework({ goal: "Build a web application but don't use Next.js" });
    assert.equal(arch.decision.user_confirmation_required, true);
    const kept = filterClarificationQuestions([], arch);
    assert.equal(kept.some((q) => q.id === "framework"), true);
  });
});
