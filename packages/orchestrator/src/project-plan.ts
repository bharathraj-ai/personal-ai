import type {
  PlanItem,
  PlanItemStatus,
  ProjectPhase,
  ProjectPlan,
  RequestScale,
} from "@personal-ai/shared";
import { isSchoolManagementGoal } from "./coding-bootstrap.js";

function item(
  id: string,
  kind: PlanItem["kind"],
  name: string,
  opts: {
    moduleId?: string;
    requirementId?: string;
    status?: PlanItemStatus;
    phase?: number;
    files?: string[];
    description?: string;
  } = {},
): PlanItem {
  return {
    id,
    kind,
    name,
    description: opts.description,
    moduleId: opts.moduleId,
    requirementId: opts.requirementId,
    status: opts.status ?? "planned",
    phase: opts.phase,
    files: opts.files,
  };
}

function inScope(phase: number, approvedPhase: number): PlanItemStatus {
  return phase <= approvedPhase ? "in_scope" : "deferred";
}

const SCHOOL_PHASES: ProjectPhase[] = [
  {
    id: "PHASE-1",
    number: 1,
    name: "Foundation + core operations",
    moduleIds: [
      "MODULE-AUTH",
      "MODULE-ROLES",
      "MODULE-DATABASE",
      "MODULE-DASHBOARD",
      "MODULE-STUDENT",
      "MODULE-TEACHER",
      "MODULE-ATTENDANCE",
      "MODULE-CLASS",
    ],
    summary: "Authentication, database, dashboards, student/teacher management, attendance, classes",
  },
  {
    id: "PHASE-2",
    number: 2,
    name: "Academic operations",
    moduleIds: ["MODULE-EXAM", "MODULE-FEE", "MODULE-TIMETABLE", "MODULE-ASSIGNMENT"],
    summary: "Exams, fees, timetable, assignments",
  },
  {
    id: "PHASE-3",
    number: 3,
    name: "Reporting and hardening",
    moduleIds: ["MODULE-REPORT", "MODULE-NOTIFY", "MODULE-SETTINGS", "MODULE-HARDENING"],
    summary: "Reports, notifications, settings, security hardening",
  },
];

function stripImplementationFiles(plan: ProjectPlan): ProjectPlan {
  const noFiles = (items: PlanItem[]) => items.map(({ files: _f, ...rest }) => rest);
  return {
    ...plan,
    modules: noFiles(plan.modules),
    pages: noFiles(plan.pages),
    components: noFiles(plan.components),
    backend: noFiles(plan.backend),
    database: noFiles(plan.database),
    authentication: noFiles(plan.authentication),
    integrations: noFiles(plan.integrations),
    dependencies: noFiles(plan.dependencies),
    tests: noFiles(plan.tests),
    security: noFiles(plan.security),
    milestones: noFiles(plan.milestones),
    requirements: noFiles(plan.requirements),
  };
}

/**
 * Mandatory decomposition for a school management FULL_APPLICATION.
 * Phase 1 is the default approved scope unless the user asked for a smaller slice.
 * File paths are NOT injected — CodingAgent derives implementation from module contracts.
 */
export function schoolManagementProjectPlan(approvedPhase = 1): ProjectPlan {
  const st = (phase: number) => inScope(phase, approvedPhase);

  const modules: PlanItem[] = [
    item("MODULE-AUTH", "module", "Authentication", {
      phase: 1,
      status: st(1),
      description: "Email/password login, logout, signed HTTP sessions, protected routes",
    }),
    item("MODULE-ROLES", "module", "Roles and authorization", {
      phase: 1,
      status: st(1),
      description: "ADMIN, TEACHER, STUDENT role enforcement on API routes",
    }),
    item("MODULE-DATABASE", "module", "Database persistence", {
      phase: 1,
      status: st(1),
      description: "PostgreSQL schema, connection via env, migrations, durable CRUD only",
    }),
    item("MODULE-DASHBOARD", "module", "Role dashboards", {
      phase: 1,
      status: st(1),
      description: "Live API-backed counts for students, teachers, classes, attendance",
    }),
    item("MODULE-STUDENT", "module", "Student management", {
      phase: 1,
      status: st(1),
      description: "Persistent student CRUD with validation",
    }),
    item("MODULE-TEACHER", "module", "Teacher management", {
      phase: 1,
      status: st(1),
      description: "Persistent teacher CRUD with validation",
    }),
    item("MODULE-ATTENDANCE", "module", "Attendance", {
      phase: 1,
      status: st(1),
      description: "Mark/update/retrieve attendance; prevent duplicate records",
    }),
    item("MODULE-CLASS", "module", "Classes", {
      phase: 1,
      status: st(1),
      description: "Create classes, assign teachers, enroll students",
    }),
    item("MODULE-EXAM", "module", "Examinations", { phase: 2, status: st(2) }),
    item("MODULE-FEE", "module", "Fees", { phase: 2, status: st(2) }),
    item("MODULE-TIMETABLE", "module", "Timetable", { phase: 2, status: st(2) }),
    item("MODULE-ASSIGNMENT", "module", "Assignments", { phase: 2, status: st(2) }),
    item("MODULE-NOTIFY", "module", "Notifications", { phase: 3, status: st(3) }),
    item("MODULE-SETTINGS", "module", "Settings", { phase: 3, status: st(3) }),
    item("MODULE-REPORT", "module", "Reports", { phase: 3, status: st(3) }),
    item("MODULE-HARDENING", "module", "Security hardening", { phase: 3, status: st(3) }),
  ];

  const pages: PlanItem[] = [
    item("PAGE-LOGIN", "page", "Login", {
      moduleId: "MODULE-AUTH",
      phase: 1,
      status: st(1),
      files: ["public/login.html"],
    }),
    item("PAGE-DASHBOARD-ADMIN", "page", "Admin dashboard", {
      moduleId: "MODULE-DASHBOARD",
      phase: 1,
      status: st(1),
      files: ["public/dashboard.html"],
    }),
    item("PAGE-DASHBOARD-TEACHER", "page", "Teacher dashboard", {
      moduleId: "MODULE-DASHBOARD",
      phase: 1,
      status: st(1),
      files: ["public/dashboard.html"],
    }),
    item("PAGE-DASHBOARD-STUDENT", "page", "Student dashboard", {
      moduleId: "MODULE-DASHBOARD",
      phase: 1,
      status: st(1),
      files: ["public/dashboard.html"],
    }),
    item("PAGE-DASHBOARD-PARENT", "page", "Parent dashboard", {
      moduleId: "MODULE-DASHBOARD",
      phase: 1,
      status: st(1),
      files: ["public/dashboard.html"],
    }),
    item("PAGE-STUDENT-LIST", "page", "Student list", {
      moduleId: "MODULE-STUDENT",
      phase: 1,
      status: st(1),
      files: ["public/students.html"],
    }),
    item("PAGE-STUDENT-PROFILE", "page", "Student profile", {
      moduleId: "MODULE-STUDENT",
      phase: 1,
      status: st(1),
      files: ["public/student-profile.html"],
    }),
    item("PAGE-STUDENT-CREATE", "page", "Add student", {
      moduleId: "MODULE-STUDENT",
      phase: 1,
      status: st(1),
      files: ["public/student-form.html"],
    }),
    item("PAGE-STUDENT-EDIT", "page", "Edit student", {
      moduleId: "MODULE-STUDENT",
      phase: 1,
      status: st(1),
      files: ["public/student-form.html"],
    }),
    item("PAGE-TEACHER-LIST", "page", "Teacher list", {
      moduleId: "MODULE-TEACHER",
      phase: 1,
      status: st(1),
      files: ["public/teachers.html"],
    }),
    item("PAGE-TEACHER-PROFILE", "page", "Teacher profile", {
      moduleId: "MODULE-TEACHER",
      phase: 1,
      status: st(1),
      files: ["public/teacher-profile.html"],
    }),
    item("PAGE-TEACHER-CREATE", "page", "Add teacher", {
      moduleId: "MODULE-TEACHER",
      phase: 1,
      status: st(1),
      files: ["public/teacher-form.html"],
    }),
    item("PAGE-ATTENDANCE", "page", "Attendance dashboard", {
      moduleId: "MODULE-ATTENDANCE",
      phase: 1,
      status: st(1),
      files: ["public/attendance.html"],
    }),
    item("PAGE-ATTENDANCE-MARK", "page", "Mark attendance", {
      moduleId: "MODULE-ATTENDANCE",
      phase: 1,
      status: st(1),
      files: ["public/attendance-mark.html"],
    }),
    item("PAGE-CLASS-LIST", "page", "Class list", {
      moduleId: "MODULE-CLASS",
      phase: 1,
      status: st(1),
      files: ["public/classes.html"],
    }),
  ];

  const components: PlanItem[] = [
    item("COMP-NAV", "component", "Role-aware navigation", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-DASHBOARD",
      files: ["public/js/nav.js"],
    }),
    item("COMP-API", "component", "API client (loading/error)", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-DASHBOARD",
      files: ["public/js/api.js"],
    }),
    item("COMP-AUTH-UI", "component", "Auth session helper", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-AUTH",
      files: ["public/js/auth.js"],
    }),
  ];

  const backend: PlanItem[] = [
    item("API-AUTH-LOGIN", "api", "POST /api/auth/login", {
      moduleId: "MODULE-AUTH",
      phase: 1,
      status: st(1),
      files: ["src/auth.js", "src/routes.js"],
    }),
    item("API-AUTH-LOGOUT", "api", "POST /api/auth/logout", {
      moduleId: "MODULE-AUTH",
      phase: 1,
      status: st(1),
    }),
    item("API-AUTH-ME", "api", "GET /api/auth/me", { moduleId: "MODULE-AUTH", phase: 1, status: st(1) }),
    item("API-STUDENT-LIST", "api", "GET /api/students", {
      moduleId: "MODULE-STUDENT",
      phase: 1,
      status: st(1),
    }),
    item("API-STUDENT-CREATE", "api", "POST /api/students", {
      moduleId: "MODULE-STUDENT",
      phase: 1,
      status: st(1),
    }),
    item("API-STUDENT-GET", "api", "GET /api/students/:id", {
      moduleId: "MODULE-STUDENT",
      phase: 1,
      status: st(1),
    }),
    item("API-STUDENT-UPDATE", "api", "PUT /api/students/:id", {
      moduleId: "MODULE-STUDENT",
      phase: 1,
      status: st(1),
    }),
    item("API-TEACHER-LIST", "api", "GET /api/teachers", {
      moduleId: "MODULE-TEACHER",
      phase: 1,
      status: st(1),
    }),
    item("API-TEACHER-CREATE", "api", "POST /api/teachers", {
      moduleId: "MODULE-TEACHER",
      phase: 1,
      status: st(1),
    }),
    item("API-ATTENDANCE-LIST", "api", "GET /api/attendance", {
      moduleId: "MODULE-ATTENDANCE",
      phase: 1,
      status: st(1),
    }),
    item("API-ATTENDANCE-MARK", "api", "POST /api/attendance", {
      moduleId: "MODULE-ATTENDANCE",
      phase: 1,
      status: st(1),
    }),
    item("API-CLASS-LIST", "api", "GET /api/classes", {
      moduleId: "MODULE-CLASS",
      phase: 1,
      status: st(1),
    }),
    item("API-DASHBOARD", "api", "GET /api/dashboard", {
      moduleId: "MODULE-DASHBOARD",
      phase: 1,
      status: st(1),
    }),
  ];

  const database: PlanItem[] = [
    item("DB-USERS", "database", "users", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-AUTH",
      files: ["schema/schema.sql"],
    }),
    item("DB-STUDENTS", "database", "students", { phase: 1, status: st(1) }),
    item("DB-TEACHERS", "database", "teachers", { phase: 1, status: st(1) }),
    item("DB-CLASSES", "database", "classes", { phase: 1, status: st(1) }),
    item("DB-ENROLLMENTS", "database", "enrollments", { phase: 1, status: st(1) }),
    item("DB-ATTENDANCE", "database", "attendance", { phase: 1, status: st(1) }),
  ];

  const authentication: PlanItem[] = [
    item("AUTH-LOGIN", "auth", "Email/password login", { moduleId: "MODULE-AUTH", phase: 1, status: st(1) }),
    item("AUTH-LOGOUT", "auth", "Logout / session invalidate", {
      moduleId: "MODULE-AUTH",
      phase: 1,
      status: st(1),
    }),
    item("AUTH-SESSION", "auth", "Signed session tokens", { moduleId: "MODULE-AUTH", phase: 1, status: st(1) }),
    item("AUTH-RBAC", "auth", "Backend RBAC on every mutating route", {
      moduleId: "MODULE-ROLES",
      phase: 1,
      status: st(1),
    }),
  ];

  const tests: PlanItem[] = [
    item("TEST-RBAC", "test", "Role permission matrix", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-ROLES",
      files: ["test/rbac.test.js"],
    }),
    item("TEST-AUTH", "test", "Login / session", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-AUTH",
      files: ["test/auth.test.js"],
    }),
    item("TEST-STUDENT-LIST", "test", "Student list + create", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-STUDENT",
      files: ["test/students.test.js"],
    }),
    item("TEST-STUDENT-CREATE", "test", "Student validation", { phase: 1, status: st(1) }),
    item("TEST-ATTENDANCE-AUTHZ", "test", "Teacher can mark; student cannot", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-ATTENDANCE",
      files: ["test/attendance.test.js"],
    }),
  ];

  const security: PlanItem[] = [
    item("SEC-PASSWORD", "security", "scrypt password hashing", { phase: 1, status: st(1) }),
    item("SEC-RBAC-API", "security", "Authorization on API (not UI-only)", { phase: 1, status: st(1) }),
    item("SEC-VALIDATE", "security", "Input validation", { phase: 1, status: st(1) }),
  ];

  const milestones: PlanItem[] = [
    item("MILESTONE-1", "milestone", "Project foundation", { phase: 1, status: st(1) }),
    item("MILESTONE-2", "milestone", "Authentication", { phase: 1, status: st(1) }),
    item("MILESTONE-3", "milestone", "Database", { phase: 1, status: st(1) }),
    item("MILESTONE-4", "milestone", "Core dashboard", { phase: 1, status: st(1) }),
    item("MILESTONE-5", "milestone", "Student management", { phase: 1, status: st(1) }),
    item("MILESTONE-6", "milestone", "Teacher management", { phase: 1, status: st(1) }),
    item("MILESTONE-7", "milestone", "Attendance", { phase: 1, status: st(1) }),
    item("MILESTONE-8", "milestone", "Examinations", { phase: 2, status: st(2) }),
    item("MILESTONE-9", "milestone", "Fees", { phase: 2, status: st(2) }),
    item("MILESTONE-10", "milestone", "Testing", { phase: 1, status: st(1) }),
    item("MILESTONE-11", "milestone", "Security", { phase: 1, status: st(1) }),
    item("MILESTONE-12", "milestone", "Final verification", { phase: 1, status: st(1) }),
  ];

  const requirements: PlanItem[] = [
    item("REQ-AUTH", "requirement", "Users can log in and log out with a session", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-AUTH",
    }),
    item("REQ-ROLES", "requirement", "Admin, Teacher, Student, Parent roles exist", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-ROLES",
    }),
    item("REQ-STUDENT-CRUD", "requirement", "Admin can list, view, add, and edit students", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-STUDENT",
    }),
    item("REQ-TEACHER-CRUD", "requirement", "Admin can list, view, add, and edit teachers", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-TEACHER",
    }),
    item("REQ-ATTENDANCE", "requirement", "Teachers can mark attendance; students cannot call the same API", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-ATTENDANCE",
    }),
    item("REQ-DASHBOARD", "requirement", "Each role sees a dashboard", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-DASHBOARD",
    }),
    item("REQ-PERSIST", "requirement", "Student/teacher/attendance data persists in PostgreSQL", {
      phase: 1,
      status: st(1),
      moduleId: "MODULE-DATABASE",
    }),
    item("REQ-EXAMS", "requirement", "Exams, marks, and results", { phase: 2, status: st(2), moduleId: "MODULE-EXAM" }),
    item("REQ-FEES", "requirement", "Fee structure and payments", { phase: 2, status: st(2), moduleId: "MODULE-FEE" }),
    item("REQ-TIMETABLE", "requirement", "Class and teacher timetable", {
      phase: 2,
      status: st(2),
      moduleId: "MODULE-TIMETABLE",
    }),
    item("REQ-ASSIGN", "requirement", "Assignments and submissions", {
      phase: 2,
      status: st(2),
      moduleId: "MODULE-ASSIGNMENT",
    }),
    item("REQ-REPORTS", "requirement", "Student, attendance, fee, and exam reports", {
      phase: 3,
      status: st(3),
      moduleId: "MODULE-REPORT",
    }),
  ];

  return stripImplementationFiles({
    project: item("PROJECT-SCHOOL", "module", "School Management System", {
      status: "in_scope",
      description: "Phased full application — Phase 1 implemented first",
    }),
    goal: "Create a complete school management system",
    scope: "FULL_APPLICATION",
    modules,
    pages,
    components,
    backend,
    database,
    authentication,
    integrations: [],
    dependencies: [
      item("DEP-NODE", "dependency", "Node.js stdlib (http, crypto, fs)", { status: "in_scope" }),
    ],
    tests,
    security,
    milestones,
    phases: SCHOOL_PHASES,
    requirements,
  });
}

export function genericProjectPlan(goal: string, scale: RequestScale): ProjectPlan {
  const pages = [
    item("PAGE-HOME", "page", "Home", { status: "in_scope", phase: 1, files: ["index.html"] }),
  ];
  if (scale !== "SMALL_TASK") {
    pages.push(
      item("PAGE-ABOUT", "page", "About", { status: "in_scope", phase: 1, files: ["about.html"] }),
      item("PAGE-CONTACT", "page", "Contact", { status: "in_scope", phase: 1, files: ["contact.html"] }),
    );
  }
  return {
    project: item("PROJECT-GENERIC", "module", goal.slice(0, 80), { status: "in_scope" }),
    goal,
    scope: scale,
    modules: [item("MODULE-CORE", "module", "Core", { status: "in_scope", phase: 1 })],
    pages,
    components: [],
    backend: [],
    database: [],
    authentication: [],
    integrations: [],
    dependencies: [],
    tests: [],
    security: [],
    milestones: [item("MILESTONE-1", "milestone", "Project foundation", { status: "in_scope", phase: 1 })],
    phases: [
      {
        id: "PHASE-1",
        number: 1,
        name: "Initial delivery",
        moduleIds: ["MODULE-CORE"],
        summary: "Core requested scope",
      },
    ],
    requirements: [item("REQ-CORE", "requirement", goal, { status: "in_scope", phase: 1 })],
  };
}

export function buildProjectPlan(goal: string, scale: RequestScale, approvedPhase = 1): ProjectPlan {
  if (isSchoolManagementGoal(goal) || scale === "FULL_APPLICATION" || scale === "LARGE_SYSTEM") {
    if (isSchoolManagementGoal(goal)) return schoolManagementProjectPlan(approvedPhase);
  }
  return genericProjectPlan(goal, scale);
}

export function inScopeItems(plan: ProjectPlan): PlanItem[] {
  const all = [
    ...plan.modules,
    ...plan.pages,
    ...plan.backend,
    ...plan.tests,
    ...plan.requirements,
    ...plan.authentication,
  ];
  return all.filter(
    (i) =>
      i.status === "in_scope" ||
      i.status === "in_progress" ||
      i.status === "implemented" ||
      i.status === "tested" ||
      i.status === "verified" ||
      i.status === "partial",
  );
}

export function formatPhasesForApproval(plan: ProjectPlan): string {
  const lines = [
    `This is a ${plan.scope === "LARGE_SYSTEM" ? "large system" : "large application"}. I can build it in phases.`,
    "",
  ];
  for (const phase of plan.phases) {
    const mods = plan.modules.filter((m) => phase.moduleIds.includes(m.id)).map((m) => m.name);
    lines.push(`**Proposed Phase ${phase.number} — ${phase.name}:**`);
    lines.push(mods.map((n) => `- ${n}`).join("\n"));
    lines.push("");
  }
  lines.push("Should I proceed with this architecture?");
  lines.push("Reply with **approve** to begin Phase 1, or describe changes.");
  return lines.join("\n");
}
