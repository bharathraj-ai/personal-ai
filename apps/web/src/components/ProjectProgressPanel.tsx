"use client";

export interface ProjectProgressData {
  projectName: string;
  status: string;
  phase?: string;
  workspaceId?: string;
  providerRouting?: string;
  counts?: {
    requirements?: {
      requested: number;
      implemented: number;
      tested: number;
      verified: number;
      failed?: number;
      blocked?: number;
    };
    modules?: { completed: number; total: number };
    tests?: { passed: number; total: number };
    verification?: { verified: number; total: number };
  };
  modules?: Array<{ id: string; name: string; status?: string }>;
  buildStatus?: string;
  testStatus?: string;
  storage?: string;
}

function statusIcon(done: boolean, partial?: boolean): string {
  if (done) return "✓";
  if (partial) return "⟳";
  return "○";
}

export function ProjectProgressPanel({ data }: { data: ProjectProgressData }) {
  const req = data.counts?.requirements;
  const modules = data.modules ?? [];
  const showModules = modules.length > 0;

  return (
    <div
      style={{
        marginTop: "0.75rem",
        padding: "0.75rem 1rem",
        borderRadius: "8px",
        border: "1px solid rgba(125, 211, 252, 0.25)",
        background: "rgba(15, 23, 42, 0.6)",
        fontSize: "0.8125rem",
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>{data.projectName}</div>
      <div style={{ color: "#94a3b8", marginBottom: "0.5rem" }}>
        Status: <span style={{ color: "#e2e8f0" }}>{data.status}</span>
        {data.phase ? ` · Phase: ${data.phase}` : ""}
      </div>
      {data.providerRouting && (
        <div style={{ color: "#94a3b8", marginBottom: "0.5rem" }}>{data.providerRouting}</div>
      )}

      {req && (
        <div style={{ marginBottom: "0.5rem" }}>
          <div>
            Requirements: {req.implemented}/{req.requested} implemented · {req.tested} tested ·{" "}
            {req.verified} verified
          </div>
          {(req.failed ?? 0) > 0 && <div>Failed: {req.failed}</div>}
          {(req.blocked ?? 0) > 0 && <div>Deferred/blocked: {req.blocked}</div>}
        </div>
      )}

      {(data.buildStatus || data.testStatus) && (
        <div style={{ marginBottom: "0.5rem" }}>
          {data.buildStatus && <div>Build: {data.buildStatus}</div>}
          {data.testStatus && <div>Tests: {data.testStatus}</div>}
        </div>
      )}

      {showModules && (
        <div>
          <div style={{ fontWeight: 500, marginBottom: "0.25rem" }}>Modules</div>
          {modules.slice(0, 14).map((m) => {
            const done =
              m.status === "completed" ||
              m.status === "implemented" ||
              m.status === "verified" ||
              m.status === "tested";
            const partial =
              m.status === "in_progress" || m.status === "partial" || m.status === "failed";
            const label =
              m.status === "verified" || m.status === "tested" || m.status === "implemented"
                ? "✓"
                : m.status === "in_progress"
                  ? "working"
                  : m.status === "waiting" || m.status === "WAITING_PROVIDER"
                    ? "waiting"
                    : m.status === "blocked" || m.status === "BLOCKED"
                      ? "blocked"
                    : m.status === "partial"
                      ? "partial"
                      : m.status === "failed"
                        ? "failed"
                        : m.status === "deferred"
                          ? "deferred"
                          : "pending";
            return (
              <div key={m.id} style={{ color: done ? "#86efac" : partial ? "#fde047" : "#64748b" }}>
                {statusIcon(done, partial)} {m.name} [{label}]
              </div>
            );
          })}
        </div>
      )}

      {data.storage && (
        <div style={{ marginTop: "0.5rem", color: "#64748b" }}>Storage: {data.storage}</div>
      )}
      {data.phase && (
        <div style={{ marginTop: "0.5rem", color: "#94a3b8", fontSize: "0.75rem" }}>
          {[
            "Analyzing",
            "Questions",
            "Plan",
            "Waiting for approval",
            "Waiting for provider",
            "Implementing",
            "Building",
            "Testing",
            "Fixing",
            "Verifying",
            "Saving",
            "Complete",
          ].map((label) => {
            const map: Record<string, string> = {
              ANALYZE: "Analyzing",
              CLARIFY: "Questions",
              PLAN: "Plan",
              AWAIT_APPROVAL: "Waiting for approval",
              WAITING_PROVIDER: "Waiting for provider",
              EXECUTE: "Implementing",
              OBSERVE: "Building",
              RETRY: "Fixing",
              VERIFY: "Verifying",
              COMPLETE: "Complete",
              FAILED: "Complete",
            };
            const current = map[data.phase ?? ""] ?? data.phase;
            const active = current === label;
            return (
              <span key={label} style={{ color: active ? "#e2e8f0" : "#475569", marginRight: "0.35rem" }}>
                {active ? "→ " : ""}
                {label}
              </span>
            );
          })}
        </div>
      )}
      {data.workspaceId && (
        <div style={{ color: "#64748b" }}>Workspace: {data.workspaceId.slice(0, 8)}…</div>
      )}
    </div>
  );
}
