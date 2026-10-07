import { ExternalConnector, ConnectorCapability, ExternalActionRequest, ExternalActionResponse } from "./types.js";

export class EmailConnector implements ExternalConnector {
  readonly provider = "email";
  readonly capabilities: ConnectorCapability[] = [
    { name: "READ_EMAIL", risk: "low", requiresApproval: false },
    { name: "SEARCH_EMAIL", risk: "low", requiresApproval: false },
    { name: "SUMMARIZE_EMAIL", risk: "low", requiresApproval: false },
    { name: "CLASSIFY_EMAIL", risk: "low", requiresApproval: false },
    { name: "DRAFT_EMAIL", risk: "low", requiresApproval: false },
    { name: "SEND_EMAIL", risk: "high", requiresApproval: true },
    { name: "DELETE_EMAIL", risk: "critical", requiresApproval: true },
  ];

  async healthCheck(_userId: string): Promise<boolean> {
    return true;
  }

  async revoke(_userId: string): Promise<void> {}

  async execute<T = any, R = any>(
    _userId: string,
    request: ExternalActionRequest<T>
  ): Promise<ExternalActionResponse<R>> {
    switch (request.action) {
      case "READ_EMAIL":
        return { success: true, result: { subject: "Interview Scheduled", body: "Tomorrow at 10 AM", id: "1" } as any };
      case "SEARCH_EMAIL":
        return { success: true, result: [{ subject: "Action required", id: "2" }] as any };
      case "CLASSIFY_EMAIL":
        return { success: true, result: { category: "INTERVIEW" } as any };
      case "DRAFT_EMAIL":
        return { success: true, result: { draftId: "d1", status: "drafted" } as any };
      case "SEND_EMAIL":
        return { success: true, result: { messageId: "m1", status: "sent" } as any };
      default:
        return { success: false, error: "Action not supported" };
    }
  }
}
