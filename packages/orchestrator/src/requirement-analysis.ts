import type {
  ArchitectureDecisions,
  ClarificationQuestion,
  ImplementationPlan,
  Message,
} from "@personal-ai/shared";
import type { ModelAdapter } from "@personal-ai/ai-core";
import { isProjectOGoal, isSchoolManagementGoal, isWebsiteGoal } from "./coding-bootstrap.js";
import {
  classifyRequest,
  requiresImplementationGate,
} from "./request-classification.js";
import {
  buildProjectPlan,
  formatPhasesForApproval,
  schoolManagementProjectPlan,
} from "./project-plan.js";
import { deriveArchitectureConstraints } from "./architecture-constraints.js";
import { filterClarificationQuestions, formatFrameworkNotice } from "./framework-decision.js";

/** Detect large implementation requests that need clarify → plan → approval. */
export function isLargeImplementationRequest(goal: string): boolean {
  return requiresImplementationGate(classifyRequest(goal), goal);
}

/** Default clarification questions when model is unavailable. */
export function defaultClarificationQuestions(goal: string): ClarificationQuestion[] {
  if (isSchoolManagementGoal(goal)) {
    return [
      {
        id: "scope",
        question:
          "This is a large application. I can build it in phases. Phase 1: Authentication, Dashboards, Student management, Teacher management, Attendance, Classes. Phase 2: Exams, Fees, Timetable, Assignments. Phase 3: Reports, Notifications, Settings, Hardening. Proceed with this architecture?",
        category: "scope",
        defaultDecision: "Phase 1 now; Phases 2–3 planned (honest PARTIAL until later phases exist)",
      },
      {
        id: "roles",
        question:
          "Should the system include Admin, Teacher, Student, and Parent roles?",
        category: "roles",
        defaultDecision: "Admin, Teacher, Student, Parent",
      },
      {
        id: "auth",
        question: "Do you need email/password authentication, or SSO (Google/Microsoft)?",
        category: "security",
        defaultDecision: "Email/password with signed sessions",
      },
      {
        id: "deployment",
        question: "Where should this be deployed — local demo, VPS, or cloud (e.g. Vercel + Neon)?",
        category: "deployment",
        defaultDecision: "Local demo with PostgreSQL via DATABASE_URL; Docker-ready later",
      },
    ];
  }
  if (isProjectOGoal(goal)) {
    return [
      {
        id: "data_source",
        question:
          "Should the model use bundled synthetic ocean data, or download from a public dataset (e.g. NOAA)?",
        category: "integrations",
        defaultDecision: "Start with bundled synthetic data; optional NOAA download if configured",
      },
      {
        id: "model_type",
        question: "Preferred approach: simple linear/regression baseline or scikit-learn pipeline?",
        category: "architecture",
        defaultDecision: "Python scikit-learn baseline with evaluation metrics",
      },
    ];
  }
  if (isWebsiteGoal(goal) && !isSchoolManagementGoal(goal)) {
    return [
      {
        id: "scope",
        question:
          "What should the first version include — a marketing brochure site (Home, About, Products/Services, Contact), or a full web app with accounts?",
        category: "scope",
        defaultDecision: "Marketing brochure site: Home, About, Products/Services, Contact",
      },
      {
        id: "deployment",
        question: "Where should this be deployed — local demo, static hosting, or cloud?",
        category: "deployment",
        defaultDecision: "Local demo first; static hosting ready",
      },
    ];
  }
  return [
    {
      id: "scope",
      question: "What is the minimum viable scope for the first version?",
      category: "scope",
      defaultDecision: "Core CRUD + authentication + one primary workflow",
    },
  ];
}

export function defaultImplementationPlan(
  goal: string,
  answers: Record<string, string>,
): ImplementationPlan {
  if (isSchoolManagementGoal(goal)) {
    const constraints = deriveArchitectureConstraints(goal, answers);
    const roles = (answers.roles ?? "Admin, Teacher, Student").split(/,\s*/);
    const projectPlan = schoolManagementProjectPlan(1);
    const dbLabel =
      constraints.database === "postgresql"
        ? `PostgreSQL${constraints.databaseProvider === "neon" ? " (Neon via DATABASE_URL env)" : ""}`
        : "SQLite/file store (only if explicitly approved)";
    return {
      objective: "School management system with role-based access and core academic workflows",
      architecture:
        "Multi-page web app: REST API + real database persistence + role-aware frontend. Not a single-page demo.",
      components: [
        "Auth module (login, logout, signed sessions)",
        `User/role management (${roles.join(", ")}) — API-enforced`,
        "Role dashboards with live API data",
        "Student CRUD",
        "Teacher CRUD",
        "Attendance with duplicate prevention",
        "Classes (assign teacher, enroll students)",
      ],
      database: `${dbLabel} — users, students, teachers, classes, enrollments, attendance`,
      apis: [
        "POST /api/auth/login",
        "POST /api/auth/logout",
        "GET /api/auth/me",
        "GET /api/dashboard/stats",
        "CRUD /api/students",
        "CRUD /api/teachers",
        "POST/GET /api/attendance",
        "CRUD /api/classes",
      ],
      frontend:
        "HTML pages: login, dashboard, students, teachers, attendance, classes — fetch real backend APIs",
      backend: "Node HTTP API with validation, RBAC middleware, PostgreSQL persistence, error handling",
      authentication: answers.auth ?? "Email/password with signed HTTP sessions",
      roles,
      integrations: [],
      dependencies: ["Node.js", constraints.database === "postgresql" ? "pg" : "database driver"],
      testingStrategy:
        "Behavior tests: auth sessions, RBAC denial, student/teacher CRUD, attendance duplicates, dashboard live counts",
      security: ["RBAC on API", "Password hashing", "Signed sessions", "Input validation"],
      deployment:
        answers.deployment ??
        (constraints.database === "postgresql"
          ? "Local process; DATABASE_URL from environment (never hardcoded)"
          : "Local demo"),
      risks: [
        "Full application requested — Phases 2–3 are deferred unless scope expands",
        constraints.database === "postgresql"
          ? "Requires DATABASE_URL configured at runtime"
          : "Non-PostgreSQL persistence requires explicit approval",
      ],
      commands: ["node --test", "node src/index.js"],
      externalServices: [],
      scope: "FULL_APPLICATION",
      projectPlan,
      phases: projectPlan.phases,
    };
  }
  if (isProjectOGoal(goal)) {
    return {
      objective: "Project O — ocean temperature prediction with evaluation metrics",
      architecture: "Python ML pipeline: data → preprocess → train → evaluate → predict",
      components: [
        "Data loader (CSV / optional download)",
        "Feature preprocessing",
        "Model training (scikit-learn)",
        "Evaluation (RMSE, MAE on holdout)",
        "Prediction CLI/API",
      ],
      database: "CSV/Parquet artifacts in workspace; metadata in Neon if configured",
      apis: ["CLI: python model.py", "Optional: FastAPI /predict endpoint"],
      frontend: "Optional minimal results dashboard (Phase 2)",
      backend: "Python scripts + optional FastAPI",
      authentication: "N/A for local ML pipeline",
      roles: [],
      integrations: answers.data_source?.includes("NOAA") ? ["NOAA public data (if reachable)"] : [],
      dependencies: ["pandas", "scikit-learn", "numpy"],
      files: ["data/sample.csv", "preprocess.py", "model.py", "train.py", "evaluate.py", "predict.py", "test_model.py"],
      testingStrategy: "pytest unit tests; training smoke test; RMSE reported explicitly",
      security: ["No secrets in generated code", "Validate downloaded data paths"],
      deployment: "Local execution in CodingWorkspace; artifacts synced to S3",
      risks: [
        "MODEL_QUALITY_NOT_VERIFIED without real ocean validation data",
        "Synthetic data may not reflect production accuracy",
      ],
      commands: ["pip install -r requirements.txt", "python train.py", "python -m pytest"],
      externalServices: ["S3 for artifact persistence (optional)"],
    };
  }
  const scale = classifyRequest(goal);
  const projectPlan = buildProjectPlan(goal, scale, 1);
  const stack = answers.stack?.trim();
  return {
    objective: goal,
    architecture: stack || "Next.js + TypeScript (default web application framework)",
    components: ["Core API", "Frontend UI", "Database schema", "Auth"],
    database: "Neon PostgreSQL when configured",
    dependencies: ["next", "typescript"],
    testingStrategy: "Build + unit tests where configured",
    security: ["Authentication", "Input validation"],
    deployment: "Local workspace first; persistent files on S3",
    risks: ["Scope not fully specified"],
    commands: ["pnpm install", "pnpm build"],
    scope: scale,
    projectPlan,
    phases: projectPlan.phases,
  };
}

const ANALYSIS_PROMPT = `You analyze user implementation requests for Bharath AI.
Return ONLY JSON with keys:
- needsClarification: boolean
- questions: array of { id, question, category, defaultDecision? }
- analysisSummary: string

Ask ONLY NECESSARY product questions (roles, accounts, integrations, security, product scope).
Do NOT ask optional technical choices. The Orchestrator already decided the stack.
NEVER ask: Next.js vs React, Vite vs Next, TypeScript vs JavaScript, folder structure, lint, testing framework, file names, or "preferred stack".
NEVER ask "Should I use Next.js or React.js?"
Default new web applications: Next.js + TypeScript. Preserve an existing project stack.
Categories: roles, architecture, integrations, security, deployment, scope.
If the only remaining uncertainty is a technical default, set needsClarification to false and return an empty questions array.`;

const PLAN_PROMPT = `You are the primary planning brain of a Personal AI software engineering system.

Your job is to convert the user's natural-language application request into a COMPLETE, production-oriented implementation plan.

The user may describe:
- an application
- website
- mobile application
- dashboard
- SaaS
- e-commerce system
- company website
- internal tool
- admin panel
- multiple user roles
- permissions
- CRUD operations
- workflows
- business rules
- UI requirements
- theme/design requirements

You must understand the intent behind the request and convert it into concrete software requirements.

Return ONLY valid JSON matching these fields:

{
  "objective": "",
  "architecture": "",
  "components": [],
  "database": [],
  "apis": [],
  "frontend": [],
  "backend": [],
  "authentication": [],
  "roles": [],
  "permissions": [],
  "businessRules": [],
  "workflows": [],
  "integrations": [],
  "dependencies": [],
  "files": [],
  "testingStrategy": [],
  "security": [],
  "deployment": [],
  "risks": [],
  "commands": [],
  "externalServices": [],
  "scope": ""
}

scope MUST be one of:
SMALL_TASK
FEATURE
MVP
FULL_APPLICATION
LARGE_SYSTEM


CORE RULES

1. UNDERSTAND THE USER'S ACTUAL REQUIREMENT

Do not merely repeat the user's words.

Convert natural language into implementable requirements.

Example:

User:
"Create a laptop company website with admin role. Admin should add laptops, specify price, modify laptops, remove laptops, block laptops and change the website theme."

Interpret this as:

Application:
Laptop company/e-commerce website.

Admin capabilities:
- Create laptop
- Edit laptop
- Delete/remove laptop
- Set price
- Update price
- Manage laptop specifications
- Upload laptop images
- Manage stock
- Block/unblock laptop
- Publish/unpublish laptop
- Change website theme
- Manage product visibility
- View admin dashboard

Customer capabilities:
- View laptops
- Search laptops
- Filter laptops
- View laptop details
- View price
- Browse available products

Do NOT add unrelated features such as payments, delivery, reviews, wishlist, coupons, etc. unless the user requests them or they are explicitly required by the stated application objective.


2. ROLE-AWARE PLANNING

If the user specifies a role, treat it as a real authorization role.

For every role determine:

- what the role can view
- what the role can create
- what the role can modify
- what the role can delete
- what the role can block/unblock
- what administrative actions the role can perform

Store these requirements in:

"roles"

and

"permissions"


Example:

"roles": [
  {
    "name": "ADMIN",
    "description": "Full management access",
    "permissions": [
      "laptop:create",
      "laptop:read",
      "laptop:update",
      "laptop:delete",
      "laptop:block",
      "laptop:unblock",
      "laptop:price:update",
      "theme:update"
    ]
  },
  {
    "name": "CUSTOMER",
    "description": "Public laptop browsing access",
    "permissions": [
      "laptop:read"
    ]
  }
]


3. CRUD REQUIREMENTS

Whenever the user asks to add, modify, remove, manage, block, unblock, activate, deactivate, publish, unpublish, etc., convert those statements into explicit software operations.

For example:

"Admin can add laptops"

must become:

CREATE laptop API
CREATE laptop database operation
CREATE laptop form
CREATE laptop validation
CREATE laptop admin UI
CREATE authorization permission
CREATE tests


"Admin can modify laptop"

must become:

UPDATE laptop API
UPDATE database operation
EDIT laptop UI
validation
authorization
tests


"Admin can remove laptop"

must become:

DELETE or soft-delete operation
admin confirmation UI
authorization
audit logging
tests


"Admin can block laptop"

must become:

block/unblock state
database status field
block API
unblock API
admin UI
customer visibility rules
authorization
tests


4. BUSINESS RULES

Convert user requirements into explicit business rules.

Example:

- Only authenticated admins can create laptops.
- Only admins can modify laptop prices.
- Blocked laptops cannot be shown as available products.
- Customers cannot modify laptop information.
- Deleted/removed laptops must not appear in the public product listing.
- Theme changes are restricted to administrators.

Place these in:

"businessRules"


5. WORKFLOWS

Identify important workflows.

Example:

Admin login
→ Admin dashboard
→ Add laptop
→ Enter specifications
→ Set price
→ Upload images
→ Validate
→ Save laptop
→ Publish laptop

Another workflow:

Admin
→ Select laptop
→ Block laptop
→ Confirm
→ Laptop becomes unavailable
→ Customer cannot purchase/view it as available


6. DATABASE DESIGN

Infer the database entities required by the requested functionality.

For the laptop example, possible entities include:

users
roles
permissions
laptops
laptop_images
categories
audit_logs
site_settings
themes

Do not create unnecessary tables.

For each entity describe important fields, relationships, indexes, and status fields.

Example laptop fields may include:

id
name
brand
model
description
price
stock
specifications
images
status
created_at
updated_at


7. API DESIGN

Every meaningful backend operation must have an API or equivalent server action.

For example:

POST   /api/admin/laptops
GET    /api/admin/laptops
GET    /api/laptops/:id
PUT    /api/admin/laptops/:id
DELETE /api/admin/laptops/:id
PATCH  /api/admin/laptops/:id/block
PATCH  /api/admin/laptops/:id/unblock
PATCH  /api/admin/laptops/:id/price
PATCH  /api/admin/theme


8. FRONTEND DESIGN

Do not create only a homepage.

For FULL_APPLICATION or LARGE_SYSTEM, plan all required pages.

Example:

Public:
- Home
- Laptop listing
- Laptop details
- Search/filter

Authentication:
- Login
- Register if required
- Unauthorized/access-denied

Admin:
- Admin dashboard
- Laptop management
- Add laptop
- Edit laptop
- Laptop details
- Blocked laptops
- Categories
- Theme/settings
- Users/roles if required
- Audit logs if required

Each page must correspond to an actual requirement.


9. ADMIN UI

When an admin role exists, create a proper admin experience.

The admin dashboard should expose the requested management operations.

For the laptop example:

Dashboard
├── Products
│   ├── Add Laptop
│   ├── Edit Laptop
│   ├── Delete Laptop
│   ├── Block/Unblock
│   ├── Price Management
│   └── Stock Management
│
├── Categories
│
├── Theme
│   ├── Select Theme
│   └── Customize Theme
│
├── Users
│
└── Audit Logs


10. THEME / DESIGN REQUIREMENTS

If the user asks for theme, dark mode, colors, branding, layout, etc., treat it as a real feature.

Do not hardcode one design and ignore the requirement.

Create a theme/settings system where appropriate.

Example:

site_settings
theme configuration
admin theme controls
light/dark mode
brand colors
font settings
UI preview

Only implement the level of customization requested by the user.


11. AUTHENTICATION AND AUTHORIZATION

If roles are specified:

Implement authentication.

Implement authorization.

Do not rely only on hiding buttons in the frontend.

Permissions must also be enforced on backend/API operations.

Example:

ADMIN:
laptop:create = allowed

CUSTOMER:
laptop:create = denied


12. SECURITY

Include:

- authentication
- authorization
- input validation
- API protection
- role/permission enforcement
- secure password handling
- CSRF protection where applicable
- rate limiting where appropriate
- file upload validation
- XSS protection
- SQL injection protection
- audit logging for sensitive admin operations
- secret management

Never expose API keys or secrets to the model, browser, generated source code, or logs.


13. TESTING

Every major requirement must have tests.

For the laptop example:

- Admin can create laptop
- Admin can update laptop
- Admin can update price
- Admin can delete laptop
- Admin can block laptop
- Admin can unblock laptop
- Customer cannot modify laptop
- Blocked laptop visibility behaves correctly
- Theme update works
- Unauthorized users cannot access admin APIs
- Invalid laptop data is rejected


14. FILE PLANNING

For FULL_APPLICATION or LARGE_SYSTEM:

files MUST contain a real multi-file application.

Include:

- multiple frontend pages
- reusable components
- backend/API routes
- database/schema/migrations
- authentication
- authorization
- business logic
- tests
- configuration
- documentation where appropriate

NEVER reduce a full application to:

app/page.tsx

or:

index.html

or a single demo page.


15. ARCHITECTURE

Honor architectureDecision exactly.

Do not replace the selected architecture.

New web applications use:

Next.js + TypeScript

unless architectureDecision explicitly specifies another framework.


16. REQUIREMENT TRACEABILITY

Every important user requirement must map to implementation.

Use this mental mapping:

USER REQUIREMENT
→ FEATURE
→ ROLE/PERMISSION
→ DATABASE
→ API
→ FRONTEND
→ BUSINESS RULE
→ TEST


Example:

"Admin can change laptop price"

must map to:

Feature:
Price management

Permission:
laptop:price:update

Database:
laptops.price

API:
PATCH /api/admin/laptops/:id/price

Frontend:
Admin price editor

Business rule:
Only ADMIN can update price

Test:
Customer cannot update price
Admin can update price


17. DO NOT INVENT REQUIREMENTS

Do not silently add major functionality that the user did not request.

You may infer technical requirements necessary to implement requested functionality.

Example:

If user says "Admin can add laptops", validation, database storage, API, authentication and UI are technically necessary.

But do NOT automatically add:

payment gateway
delivery system
reviews
wishlist
coupons
subscriptions

unless requested or clearly required.


18. PHASED IMPLEMENTATION

For FULL_APPLICATION and LARGE_SYSTEM, divide the project into implementation phases.

Example:

Phase 1:
Foundation
Authentication
Database
Roles

Phase 2:
Laptop management
CRUD
Price
Stock
Block/unblock

Phase 3:
Customer website
Search
Filtering
Product details

Phase 4:
Admin theme management

Phase 5:
Testing
Security
Verification


19. COMPLETENESS

Before returning the plan, internally verify:

- Does every user requirement have a feature?
- Does every role have permissions?
- Does every CRUD operation have backend support?
- Does every admin operation have UI support?
- Does the database support the requested functionality?
- Do APIs support the requested functionality?
- Are authorization rules enforced?
- Are business rules defined?
- Are tests included?
- Are multiple pages included for full applications?
- Is the application actually complete rather than a demo?


20. OUTPUT

Return ONLY valid JSON.

No markdown.

No explanations outside JSON.

The JSON must contain:

objective
architecture
components
database
apis
frontend
backend
authentication
roles
permissions
businessRules
workflows
integrations
dependencies
files
testingStrategy
security
deployment
risks
commands
externalServices
scope`;

export async function analyzeRequirements(
  model: ModelAdapter,
  goal: string,
  history: Message[],
  architecture?: ArchitectureDecisions,
): Promise<{
  needsClarification: boolean;
  questions: ClarificationQuestion[];
  analysisSummary: string;
}> {
  const decided =
    architecture &&
    `Stack already decided: ${architecture.framework} + ${architecture.language}. Do not ask about framework, language, or folder structure.`;

  let result;
  try {
    result = await model.generate({
      messages: [
        { role: "system", content: ANALYSIS_PROMPT },
        ...history,
        { role: "user", content: decided ? `Goal: ${goal}\n${decided}` : `Goal: ${goal}` },
      ],
      temperature: 0.2,
    });
  } catch {
    const questions = applyArchitectureFilter(defaultClarificationQuestions(goal), architecture);
    return {
      needsClarification: questions.length > 0,
      questions,
      analysisSummary: `Large implementation detected. ${questions.length} clarification question(s) prepared (planning model unavailable — using defaults).`,
    };
  }

  if (/\[Model not loaded\]/i.test(result.content)) {
    const questions = applyArchitectureFilter(defaultClarificationQuestions(goal), architecture);
    return {
      needsClarification: questions.length > 0,
      questions,
      analysisSummary: `Large implementation detected. ${questions.length} clarification question(s) prepared (model weights NOT_LOADED — using defaults).`,
    };
  }

  try {
    const parsed = JSON.parse(extractJson(result.content)) as {
      needsClarification?: boolean;
      questions?: ClarificationQuestion[];
      analysisSummary?: string;
    };
    const raw =
      parsed.questions?.length ? parsed.questions : defaultClarificationQuestions(goal);
    const questions = applyArchitectureFilter(raw, architecture);
    return {
      needsClarification: questions.length > 0,
      questions,
      analysisSummary: parsed.analysisSummary ?? "Requirements analyzed.",
    };
  } catch {
    const questions = applyArchitectureFilter(defaultClarificationQuestions(goal), architecture);
    return {
      needsClarification: questions.length > 0,
      questions,
      analysisSummary: "Requirements analyzed with default clarification questions.",
    };
  }
}

function applyArchitectureFilter(
  questions: ClarificationQuestion[],
  architecture?: ArchitectureDecisions,
): ClarificationQuestion[] {
  if (!architecture) return questions.filter((q) => q.id !== "stack");
  return filterClarificationQuestions(questions, architecture);
}

export async function buildImplementationPlan(
  model: ModelAdapter,
  goal: string,
  answers: Record<string, string>,
  history: Message[],
  architecture?: ArchitectureDecisions,
): Promise<ImplementationPlan> {
  if (isSchoolManagementGoal(goal)) {
    return attachArchitecture(defaultImplementationPlan(goal, answers), architecture);
  }

  let result;
  try {
    result = await model.generate({
      messages: [
        { role: "system", content: PLAN_PROMPT },
        ...history,
        {
          role: "user",
          content: JSON.stringify({
            goal,
            clarificationAnswers: answers,
            architectureDecision: architecture?.decision,
            architecture,
          }),
        },
      ],
      temperature: 0.2,
    });
  } catch {
    return attachArchitecture(defaultImplementationPlan(goal, answers), architecture);
  }

  if (/\[Model not loaded\]/i.test(result.content)) {
    return attachArchitecture(defaultImplementationPlan(goal, answers), architecture);
  }

  try {
    const parsed = JSON.parse(extractJson(result.content)) as ImplementationPlan;
    const scale = parsed.scope ?? classifyRequest(goal);
    if (!parsed.projectPlan) {
      parsed.projectPlan = buildProjectPlan(goal, scale, 1);
      parsed.phases = parsed.projectPlan.phases;
      parsed.scope = scale;
    }
    return attachArchitecture(normalizeImplementationPlan(parsed, goal), architecture);
  } catch {
    return attachArchitecture(defaultImplementationPlan(goal, answers), architecture);
  }
}

/** Fill missing fields so plan formatting never crashes on partial LLM JSON. */
export function normalizeImplementationPlan(
  plan: ImplementationPlan,
  goal = "",
): ImplementationPlan {
  const fallback = defaultImplementationPlan(goal || plan.objective || "project", {});
  return {
    ...fallback,
    ...plan,
    objective: plan.objective?.trim() || fallback.objective,
    architecture: plan.architecture?.trim() || fallback.architecture,
    components: Array.isArray(plan.components) && plan.components.length
      ? plan.components
      : fallback.components,
    dependencies: Array.isArray(plan.dependencies) ? plan.dependencies : fallback.dependencies ?? [],
    testingStrategy: plan.testingStrategy?.trim() || fallback.testingStrategy,
    security: Array.isArray(plan.security) ? plan.security : fallback.security ?? [],
    deployment: plan.deployment?.trim() || fallback.deployment,
    risks: Array.isArray(plan.risks) ? plan.risks : fallback.risks ?? [],
    commands: Array.isArray(plan.commands) ? plan.commands : fallback.commands ?? [],
    apis: Array.isArray(plan.apis) ? plan.apis : plan.apis,
    roles: Array.isArray(plan.roles) ? plan.roles : plan.roles,
    projectPlan: plan.projectPlan ?? fallback.projectPlan,
    phases: plan.phases ?? plan.projectPlan?.phases ?? fallback.phases,
    scope: plan.scope ?? fallback.scope,
  };
}

export function attachArchitecture(
  plan: ImplementationPlan,
  architecture?: ArchitectureDecisions,
): ImplementationPlan {
  if (!architecture) return plan;
  plan.architectureDecisions = architecture;
  if (plan.projectPlan) {
    plan.projectPlan.architecture = architecture;
  }
  return plan;
}

export function formatImplementationPlanForUser(plan: ImplementationPlan): string {
  const normalized = normalizeImplementationPlan(plan, plan.objective);
  const scale = normalized.scope ?? "MVP";
  const notice = normalized.architectureDecisions
    ? `${formatFrameworkNotice(normalized.architectureDecisions)}\n`
    : "";
  const sections: string[] = [
    notice,
    `# Implementation Plan\n`,
    `**Objective:** ${normalized.objective}`,
    `**Scope:** ${scale}`,
    `**Architecture:** ${normalized.architecture}`,
  ];
  if (normalized.architectureDecisions) {
    const a = normalized.architectureDecisions;
    sections.push(
      `**Framework:** ${a.framework} + ${a.language} (${a.source}; confirmation not required)`,
    );
  }
  sections.push(
    `\n## Components\n${(normalized.components ?? []).map((c) => `- ${c}`).join("\n")}`,
  );
  if (normalized.projectPlan) {
    sections.push(`\n## Phased delivery\n${formatPhasesForApproval(normalized.projectPlan)}`);
    const mods = (normalized.projectPlan.modules ?? []).filter((m) => m.status !== "deferred");
    if (mods.length) {
      sections.push(
        `\n## Modules (from requirements)\n${mods.map((m) => `- ${m.name} (${m.id})`).join("\n")}`,
      );
    }
    const estimated = [
      ...(normalized.projectPlan.pages ?? []),
      ...(normalized.projectPlan.backend ?? []),
      ...(normalized.projectPlan.tests ?? []),
    ].flatMap((i) => i.files ?? []);
    if (estimated.length) {
      sections.push(`\n## Estimated files (manifest before contents)\n${estimated.length} paths from the approved plan`);
    }
  }
  if (normalized.database) sections.push(`\n## Database\n${normalized.database}`);
  if (normalized.apis?.length) {
    sections.push(`\n## APIs\n${normalized.apis.map((a) => `- ${a}`).join("\n")}`);
  }
  if (normalized.frontend) sections.push(`\n## Frontend\n${normalized.frontend}`);
  if (normalized.backend) sections.push(`\n## Backend\n${normalized.backend}`);
  if (normalized.authentication) {
    sections.push(`\n## Authentication\n${normalized.authentication}`);
  }
  if (normalized.roles?.length) {
    sections.push(`\n## Roles\n${normalized.roles.map((r) => `- ${r}`).join("\n")}`);
  }
  if (normalized.testingStrategy) sections.push(`\n## Testing\n${normalized.testingStrategy}`);
  if (normalized.security?.length) {
    sections.push(`\n## Security\n${normalized.security.map((s) => `- ${s}`).join("\n")}`);
  }
  if (normalized.deployment) sections.push(`\n## Deployment\n${normalized.deployment}`);
  if (normalized.risks?.length) {
    sections.push(`\n## Risks\n${normalized.risks.map((r) => `- ${r}`).join("\n")}`);
  }
  if (normalized.commands?.length) {
    sections.push(`\n## Commands\n${normalized.commands.map((c) => `- \`${c}\``).join("\n")}`);
  }
  sections.push(
    "\n---\n**Status: AWAITING_IMPLEMENTATION_APPROVAL**\nReply with **approve** to begin, or describe changes (e.g. add RBAC) to update the plan.",
  );
  return sections.join("\n");
}

export function formatClarificationAnswersForPlan(answers: Record<string, string>): string {
  const lines = Object.entries(answers)
    .filter(([k, v]) => !k.startsWith("__") && v.trim())
    .map(([k, v]) => `- **${k}:** ${v}`);
  if (answers.__user_clarification?.trim()) {
    lines.push(`- **Your notes:** ${answers.__user_clarification.trim()}`);
  }
  if (answers.__plan_amendment?.trim()) {
    lines.push(`- **Requested changes:** ${answers.__plan_amendment.trim()}`);
  }
  return lines.length ? `\n## Your requirements\n${lines.join("\n")}\n` : "";
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] ?? trimmed;
}

/** True when the user supplied clarification (not only empty defaults). */
export function hasClarificationAnswers(answers: Record<string, string> | undefined): boolean {
  if (!answers) return false;
  if (answers.__use_defaults === "true") return true;
  return Object.entries(answers).some(
    ([k, v]) => k !== "__use_defaults" && typeof v === "string" && v.trim().length > 0,
  );
}

/** Merge parsed + heuristic answers; fill gaps from defaults or freeform blob. */
export function mergeClarificationAnswers(
  questions: ClarificationQuestion[],
  answers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const q of questions) {
    if (answers[q.id]?.trim()) {
      out[q.id] = answers[q.id]!.trim();
      continue;
    }
    const extra = [answers.__user_clarification, answers.__plan_amendment].filter(Boolean).join(" ");
    if (extra.trim()) {
      out[q.id] = extra.trim();
      continue;
    }
    out[q.id] = q.defaultDecision ?? "Use reasonable default";
  }

  return out;
}
