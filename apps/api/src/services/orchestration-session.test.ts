import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultClarificationQuestions,
} from "@personal-ai/orchestrator";
import {
  parseClarificationReply,
  parseOrchestrationContext,
  resolveOrchestrationGoal,
  resolveOrchestrationIdentity,
  shouldIsolateNewProject,
  shouldPersistOrchestrationSession,
  buildResumeOrchestrationSession,
} from "./orchestration-session.js";
import type { OrchestratorResult } from "@personal-ai/shared";

describe("orchestration session", () => {
  it("resolves goal from session on follow-up", () => {
    const goal = resolveOrchestrationGoal("use defaults", [], {
      session: {
        taskId: "t1",
        userId: "u1",
        goal: "Create a school management system",
        status: "awaiting_clarification",
        createdAt: new Date(),
      },
    });
    assert.equal(goal, "Create a school management system");
  });

  it("parses numbered clarification replies", () => {
    const qs = defaultClarificationQuestions("Create a school management system.");
    const parsed = parseClarificationReply(
      "1. Phase 1 now\n2. Admin, Teacher, Student\n3. JWT email password\n4. Local demo",
      qs,
    );
    assert.equal(parsed.scope, "Phase 1 now");
    assert.equal(parsed.roles, "Admin, Teacher, Student");
    assert.equal(parsed.auth, "JWT email password");
    assert.equal(parsed.deployment, "Local demo");
  });

  it("parses free-text blob into orchestration context when session awaiting clarification", () => {
    const qs = defaultClarificationQuestions("Create a school management system.");
    const ctx = parseOrchestrationContext(
      "Admin teacher student parent, JWT auth, deploy locally",
      {},
      {
        taskId: "t1",
        userId: "u1",
        goal: "Create a school management system",
        status: "awaiting_clarification",
        clarificationQuestions: qs,
        createdAt: new Date(),
      },
    );
    assert.ok(ctx.clarificationAnswers);
    assert.ok(
      ctx.clarificationAnswers!.roles ||
        ctx.clarificationAnswers!.__user_clarification,
    );
    assert.equal(ctx.implementationApproved, undefined);
  });

  it("marks approve on approval message during plan gate", () => {
    const ctx = parseOrchestrationContext("approve", {}, {
      taskId: "t1",
      userId: "u1",
      goal: "Create a school management system",
      status: "awaiting_implementation_approval",
      createdAt: new Date(),
    });
    assert.equal(ctx.implementationApproved, true);
  });

  it("captures plan amendments before approval", () => {
    const ctx = parseOrchestrationContext(
      "add role based access for admin teacher student",
      {},
      {
        taskId: "t1",
        userId: "u1",
        goal: "Create website for school management",
        status: "awaiting_implementation_approval",
        clarificationAnswers: { roles: "Admin, Teacher, Student" },
        createdAt: new Date(),
      },
    );
    assert.match(ctx.clarificationAnswers?.__plan_amendment ?? "", /role based access/i);
    assert.equal(ctx.implementationApproved, undefined);
  });

  it("resume from waiting_provider auto-approves without re-clarification", () => {
    const ctx = parseOrchestrationContext(
      "Continue my school management project.",
      {},
      {
        taskId: "t1",
        userId: "u1",
        goal: "Create a school management system",
        status: "waiting_provider",
        lifecycleState: "WAITING_FOR_PROVIDER",
        clarificationAnswers: { deployment: "Neon PostgreSQL" },
        createdAt: new Date(),
      },
    );
    assert.equal(ctx.implementationApproved, true);
    assert.equal(ctx.clarificationAnswers?.deployment, "Neon PostgreSQL");
  });

  it("E: resume from APPROVED lifecycle does not reset clarification", () => {
    const ctx = parseOrchestrationContext(
      "Continue my school management project.",
      {},
      {
        taskId: "t2",
        userId: "u1",
        goal: "Create a school management system",
        status: "implementing",
        lifecycleState: "APPROVED",
        clarificationAnswers: {
          deployment: "Neon PostgreSQL",
          auth: "email/password sessions",
          roles: "Admin, Teacher, Student",
        },
        createdAt: new Date(),
      },
    );
    assert.equal(ctx.implementationApproved, undefined);
    assert.equal(ctx.clarificationAnswers?.auth, "email/password sessions");
    assert.equal(ctx.clarificationAnswers?.deployment, "Neon PostgreSQL");
  });

  it("Continue my project matches resume and auto-approves from PARTIAL", () => {
    const ctx = parseOrchestrationContext(
      "Continue my project.",
      {},
      {
        taskId: "t3",
        userId: "u1",
        goal: "Create a small REST API",
        status: "implementing",
        lifecycleState: "PARTIAL",
        workspaceId: "ws-1",
        projectId: "p-1",
        createdAt: new Date(),
      },
    );
    assert.equal(ctx.implementationApproved, true);
  });

  it("shouldPersistOrchestrationSession keeps partial projects", () => {
    const partial = {
      taskId: "t1",
      goal: "g",
      status: "partial",
      projectStatus: "PROJECT_INCOMPLETE",
    } as unknown as OrchestratorResult;
    assert.equal(shouldPersistOrchestrationSession(partial), true);
    const complete = {
      taskId: "t2",
      goal: "g",
      status: "completed",
      projectStatus: "COMPLETE",
    } as unknown as OrchestratorResult;
    assert.equal(shouldPersistOrchestrationSession(complete), false);
  });

  it("buildResumeOrchestrationSession preserves workspace and project ids", () => {
    const session = buildResumeOrchestrationSession({
      userId: "u1",
      goal: "Create REST API",
      session: {
        taskId: "old",
        userId: "u1",
        goal: "Create REST API",
        status: "implementing",
        workspaceId: "ws-old",
        projectId: "p-old",
        createdAt: new Date(),
      },
      result: {
        taskId: "t-new",
        goal: "Create REST API",
        status: "partial",
        projectStatus: "PROJECT_INCOMPLETE",
        observations: [],
        plan: { goal: "g", steps: [], reasoning: "" },
        verifications: [],
        events: [],
        finalResponse: "",
        retriesUsed: 0,
        completedAt: new Date(),
        projectPlan: {
          implementationProgress: {
            completedModuleIds: ["AUTH"],
            failedModuleIds: [],
            partialModuleIds: [],
            providersUsed: [],
            attemptCount: 1,
            lifecycleState: "PARTIAL",
          },
        },
      } as unknown as OrchestratorResult,
    });
    assert.equal(session.workspaceId, "ws-old");
    assert.equal(session.projectId, "p-old");
    assert.equal(session.lifecycleState, "PARTIAL");
    assert.equal(session.status, "implementing");
  });

  it("resolveOrchestrationIdentity forces new workspace on fresh implementation approval", () => {
    const identity = resolveOrchestrationIdentity({
      message: "approve",
      activeWorkspaceId: "b0a22cdb-2028-4347-bc7f-0c3d07c34755",
      activeProjectId: "p-old",
      implementationApproved: true,
      persisted: {
        projectId: "p-old",
        workspaceId: "b0a22cdb-2028-4347-bc7f-0c3d07c34755",
      },
    });
    assert.equal(identity.forceNewWorkspace, true);
    assert.equal(identity.workspaceId, undefined);
    assert.equal(identity.projectId, "p-old");
    assert.equal(identity.isResume, false);
  });

  it("resolveOrchestrationIdentity reuses persisted ids on resume", () => {
    const identity = resolveOrchestrationIdentity({
      message: "Continue my project.",
      implementationApproved: true,
      persisted: {
        projectId: "p-rest",
        workspaceId: "ws-rest",
      },
    });
    assert.equal(identity.isResume, true);
    assert.equal(identity.forceNewWorkspace, false);
    assert.equal(identity.projectId, "p-rest");
    assert.equal(identity.workspaceId, "ws-rest");
  });

  it("resolveOrchestrationIdentity does not silently reuse active workspace for acceptance", () => {
    const identity = resolveOrchestrationIdentity({
      message: "approve",
      activeWorkspaceId: "b0a22cdb-2028-4347-bc7f-0c3d07c34755",
      implementationApproved: true,
    });
    assert.notEqual(identity.workspaceId, "b0a22cdb-2028-4347-bc7f-0c3d07c34755");
    assert.equal(identity.workspaceId, undefined);
    assert.equal(identity.forceNewWorkspace, true);
  });

  it("shouldIsolateNewProject when school goal follows active REST project", () => {
    assert.equal(
      shouldIsolateNewProject({
        message:
          "Build a complete Phase-1 School Management System with ADMIN, TEACHER and STUDENT roles.",
        activeProjectId: "rest-project-a",
      }),
      true,
    );
  });

  it("shouldIsolateNewProject is false for resume of existing project", () => {
    assert.equal(
      shouldIsolateNewProject({
        message: "Continue my project.",
        activeProjectId: "rest-project-a",
      }),
      false,
    );
  });

  it("shouldIsolateNewProject is false for gate follow-ups on same session", () => {
    assert.equal(
      shouldIsolateNewProject({
        message: "use defaults",
        session: {
          taskId: "t1",
          userId: "u1",
          goal: "Create a small REST API with one endpoint and a real automated behavioral test.",
          status: "awaiting_clarification",
          createdAt: new Date(),
        },
        activeProjectId: "rest-project-a",
      }),
      false,
    );
  });

  it("resolveOrchestrationIdentity forceNewProject clears project and workspace ids", () => {
    const identity = resolveOrchestrationIdentity({
      message:
        "Build a complete Phase-1 School Management System with ADMIN, TEACHER and STUDENT roles.",
      activeWorkspaceId: "ws-rest",
      activeProjectId: "p-rest",
      forceNewProject: true,
    });
    assert.equal(identity.forceNewProject, true);
    assert.equal(identity.forceNewWorkspace, true);
    assert.equal(identity.projectId, undefined);
    assert.equal(identity.workspaceId, undefined);
  });

  it("resolveOrchestrationIdentity resume keeps persisted ids", () => {
    const identity = resolveOrchestrationIdentity({
      message: "Continue my project.",
      activeProjectId: "p-other",
      activeWorkspaceId: "ws-other",
      persisted: {
        projectId: "p-rest",
        workspaceId: "ws-rest",
      },
    });
    assert.equal(identity.isResume, true);
    assert.equal(identity.projectId, "p-rest");
    assert.equal(identity.workspaceId, "ws-rest");
    assert.equal(identity.forceNewProject, false);
  });
});
