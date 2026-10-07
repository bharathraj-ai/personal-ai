import { ExternalConnector, ConnectorCapability, ExternalActionRequest, ExternalActionResponse } from "./types.js";

export class CalendarConnector implements ExternalConnector {
  readonly provider = "calendar";
  readonly capabilities: ConnectorCapability[] = [
    { name: "READ_CALENDAR", risk: "low", requiresApproval: false },
    { name: "SEARCH_EVENTS", risk: "low", requiresApproval: false },
    { name: "FIND_FREE_TIME", risk: "low", requiresApproval: false },
    { name: "CREATE_EVENT", risk: "high", requiresApproval: true },
    { name: "MODIFY_EVENT", risk: "high", requiresApproval: true },
    { name: "DELETE_EVENT", risk: "high", requiresApproval: true },
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
      case "READ_CALENDAR":
      case "SEARCH_EVENTS":
        return { success: true, result: [{ title: "Interview", start: new Date().toISOString() }] as any };
      case "FIND_FREE_TIME":
        return { success: true, result: [{ start: new Date().toISOString(), end: new Date().toISOString() }] as any };
      case "CREATE_EVENT":
        return { success: true, result: { eventId: "e1", status: "created" } as any };
      case "MODIFY_EVENT":
        return { success: true, result: { eventId: request.resource, status: "modified" } as any };
      default:
        return { success: false, error: "Action not supported" };
    }
  }
}
