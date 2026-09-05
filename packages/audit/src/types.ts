/** Audit events — never log secrets or raw API keys. */
export type AuditEventName =
  | "PLAN_CREATED"
  | "CLARIFICATION_REQUESTED"
  | "APPROVAL_REQUESTED"
  | "APPROVAL_GRANTED"
  | "APPROVAL_DENIED"
  | "TOOL_SELECTED"
  | "TOOL_EXECUTED"
  | "PROVIDER_SELECTED"
  | "PROVIDER_FAILED"
  | "SEARCH_EXECUTED"
  | "EVIDENCE_COLLECTED"
  | "VERIFICATION_STARTED"
  | "VERIFICATION_PASSED"
  | "VERIFICATION_FAILED"
  | "FIX_ATTEMPTED"
  | "PROJECT_SAVED"
  | "TASK_COMPLETED"
  | "TASK_FAILED";

export interface AuditEntry {
  id: string;
  userId: string;
  projectId?: string;
  taskId?: string;
  event: AuditEventName;
  detail: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditLogService {
  record(entry: Omit<AuditEntry, "id" | "createdAt">): Promise<AuditEntry>;
  list(opts: {
    userId: string;
    projectId?: string;
    taskId?: string;
    limit?: number;
  }): Promise<AuditEntry[]>;
}

/** Strip likely secrets from audit detail payloads. */
export function sanitizeAuditDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    const key = k.toLowerCase();
    if (
      key.includes("secret") ||
      key.includes("password") ||
      key.includes("api_key") ||
      key.includes("apikey") ||
      key.includes("token") ||
      key.includes("credential")
    ) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (typeof v === "string" && /sk-[a-zA-Z0-9]{10,}/.test(v)) {
      out[k] = "[REDACTED]";
      continue;
    }
    out[k] = v;
  }
  return out;
}
