import type { ApprovalRequest } from "@personal-ai/shared";

/** In-memory store for pending HIGH_RISK approval requests. */
export class ApprovalStore {
  private readonly pending = new Map<string, ApprovalRequest & { resolved: boolean; approved?: boolean }>();

  create(request: ApprovalRequest): void {
    this.pending.set(request.id, { ...request, resolved: false });
  }

  resolve(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry || entry.resolved) return false;
    entry.resolved = true;
    entry.approved = approved;
    return true;
  }

  getPending(): ApprovalRequest[] {
    return [...this.pending.values()]
      .filter((e) => !e.resolved)
      .map(({ id, action, toolName, toolArgs, reason, requestedAt }) => ({
        id,
        action,
        toolName,
        toolArgs,
        reason,
        requestedAt,
      }));
  }

  waitForApproval(id: string, timeoutMs = 300_000): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const entry = this.pending.get(id);
        if (entry?.resolved) {
          resolve(entry.approved ?? false);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(check, 500);
      };
      check();
    });
  }
}
