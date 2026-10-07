import { ExternalConnector, ConnectorCapability, ExternalActionRequest, ExternalActionResponse } from "./types.js";

export class GitHubConnector implements ExternalConnector {
  readonly provider = "github";
  readonly capabilities: ConnectorCapability[] = [
    { name: "READ_REPOSITORY", risk: "low", requiresApproval: false },
    { name: "READ_ISSUES", risk: "low", requiresApproval: false },
    { name: "CREATE_BRANCH", risk: "medium", requiresApproval: true },
    { name: "COMMIT", risk: "high", requiresApproval: true },
    { name: "PUSH", risk: "high", requiresApproval: true },
    { name: "CREATE_PR", risk: "high", requiresApproval: true },
    { name: "MERGE_PR", risk: "critical", requiresApproval: true },
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
      case "READ_REPOSITORY":
      case "READ_ISSUES":
        return { success: true, result: [] as any };
      case "CREATE_BRANCH":
        return { success: true, result: { branch: "feature/test" } as any };
      case "COMMIT":
      case "PUSH":
      case "CREATE_PR":
      case "MERGE_PR":
        return { success: true, result: { status: "success" } as any };
      default:
        return { success: false, error: "Action not supported" };
    }
  }
}

export class OpportunityConnector implements ExternalConnector {
  readonly provider = "opportunity";
  readonly capabilities: ConnectorCapability[] = [
    { name: "DISCOVER", risk: "low", requiresApproval: false },
    { name: "ANALYZE", risk: "low", requiresApproval: false },
    { name: "PREPARE", risk: "low", requiresApproval: false },
    { name: "SUBMIT", risk: "high", requiresApproval: true },
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
      case "DISCOVER":
        return { success: true, result: [{ name: "Hackathon", eligibility: "Any" }] as any };
      case "ANALYZE":
      case "PREPARE":
        return { success: true, result: { status: "prepared", matchScore: 87 } as any };
      case "SUBMIT":
        return { success: true, result: { status: "submitted" } as any };
      default:
        return { success: false, error: "Action not supported" };
    }
  }
}
