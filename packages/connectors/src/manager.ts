import { PermissionEngine } from "./permission-engine.js";
import { ExternalActionAudit } from "./audit.js";
import { ExternalConnector, ExternalActionRequest, ExternalActionResponse } from "./types.js";

export class ConnectorManager {
  private connectors = new Map<string, ExternalConnector>();

  constructor(
    private permissions: PermissionEngine,
    private audit: ExternalActionAudit
  ) {}

  register(connector: ExternalConnector) {
    this.connectors.set(connector.provider, connector);
  }

  getConnector(provider: string): ExternalConnector {
    const conn = this.connectors.get(provider);
    if (!conn) throw new Error(`Connector not found for provider: ${provider}`);
    return conn;
  }

  async execute<T = any, R = any>(
    userId: string,
    provider: string,
    request: ExternalActionRequest<T>
  ): Promise<ExternalActionResponse<R>> {
    const connector = this.getConnector(provider);
    const capability = connector.capabilities.find(c => c.name === request.action);
    if (!capability) {
      throw new Error(`Action ${request.action} is not supported by provider ${provider}`);
    }

    // 1. Check Permissions
    const perm = await this.permissions.checkPermission(userId, provider, request.action, request.resource);
    
    // If explicitly denied, fail fast
    if (!perm.allowed) {
      const resp = { success: false, error: perm.reason };
      await this.audit.logAction(userId, provider, request.action, "rejected", request, resp, undefined, perm.reason);
      return resp;
    }

    // 2. If approval is required, but we are executing directly, it means it wasn't approved.
    // In our architecture, the agent should first PREPARE the action and ask for approval.
    // `execute` assumes it's either safe, or it was approved.
    // For now, if approval is required and we are here, we must fail unless we have an approval token.
    // To support the async approval flow, let's allow bypassing if we pass `approvedBy`.
    // We'll update the signature to accept an `approvedBy` token/user string if it came through the approval gate.
    
    // For this simple version, let's assume `execute` is called AFTER approval for high risk actions.
    if (perm.approvalRequired && !(request.payload as any)?._approved) {
      const resp = { success: false, error: "Approval required" };
      await this.audit.logAction(userId, provider, request.action, "waiting_for_approval", request);
      return resp;
    }

    // 3. Execute
    await this.audit.logAction(userId, provider, request.action, "executing", request);
    try {
      const result = await connector.execute(userId, request);
      await this.audit.logAction(userId, provider, request.action, result.success ? "completed" : "failed", request, result, (request.payload as any)?._approved ? userId : undefined, result.error);
      return result;
    } catch (err: any) {
      const resp = { success: false, error: err.message };
      await this.audit.logAction(userId, provider, request.action, "failed", request, resp, undefined, err.message);
      return resp;
    }
  }
}
