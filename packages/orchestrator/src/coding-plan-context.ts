import type { ImplementationPlan, ProjectPlan } from "@personal-ai/shared";

/** Compact approved plan for CodingAgent / specialist prompts — no secrets. */
export function formatPlanSummaryForCoding(
  projectPlan?: ProjectPlan,
  implementationPlan?: ImplementationPlan,
): string {
  const lines: string[] = [];
  if (implementationPlan?.objective) {
    lines.push(`Objective: ${implementationPlan.objective}`);
  }
  if (implementationPlan?.architecture) {
    lines.push(`Stack notes: ${implementationPlan.architecture}`);
  }
  if (projectPlan?.architecture) {
    lines.push(
      `Framework: ${projectPlan.architecture.framework} (${projectPlan.architecture.language})`,
    );
    if (projectPlan.architecture.backend === "express") {
      lines.push(
        "REST contract: GET /hello returns {\"message\":\"Hello, world!\"}. Use Express + supertest or import the app in Jest tests. Do NOT generate pages/_document, _app, or Next.js layout files.",
      );
    }
  }
  if (projectPlan?.requirements?.length) {
    lines.push("", "Requirements (implement in scope):");
    for (const r of projectPlan.requirements.slice(0, 50)) {
      lines.push(`- [${r.id}] ${r.name}${r.status ? ` (${r.status})` : ""}`);
    }
  }
  if (projectPlan?.modules?.length) {
    lines.push("", "Modules:", projectPlan.modules.map((m) => `- ${m.name}`).join("\n"));
  }
  if (projectPlan?.milestones?.length) {
    lines.push(
      "",
      "Milestones:",
      projectPlan.milestones.map((m) => `- ${m.name}`).join("\n"),
    );
  }
  if (implementationPlan?.components?.length) {
    lines.push("", "Components:", implementationPlan.components.map((c) => `- ${c}`).join("\n"));
  }
  if (implementationPlan?.testingStrategy) {
    lines.push("", `Testing: ${implementationPlan.testingStrategy}`);
  }
  return lines.join("\n").trim();
}
