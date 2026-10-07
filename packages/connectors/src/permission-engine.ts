import { DatabaseClient } from "@personal-ai/db";
import crypto from "node:crypto";

export interface PermissionPolicy {
  userId: string;
  provider: string;
  action: string;
  resource?: string;
  risk: "low" | "medium" | "high" | "critical";
  permission: "allow" | "deny" | "ask";
  approvalRequired: boolean;
}

export class PermissionEngine {
  constructor(private db: DatabaseClient) {}

  async checkPermission(
    userId: string,
    provider: string,
    action: string,
    resource?: string
  ): Promise<{ allowed: boolean; approvalRequired: boolean; reason: string }> {
    // 1. Check exact resource match if provided
    if (resource) {
      const resPerm = await this.db.query(
        `SELECT permission, approval_required FROM personal_ai.external_action_permissions
         WHERE user_id = $1 AND provider = $2 AND action = $3 AND resource = $4`,
        [userId, provider, action, resource]
      );
      if (resPerm.rows.length > 0) {
        const row = resPerm.rows[0];
        if (row.permission === "deny") {
          return { allowed: false, approvalRequired: false, reason: "Explicitly denied for this resource" };
        }
        return {
          allowed: true,
          approvalRequired: row.permission === "ask" || row.approval_required,
          reason: "Explicit resource permission matched"
        };
      }
    }

    // 2. Check general action permission
    const actPerm = await this.db.query(
      `SELECT permission, approval_required FROM personal_ai.external_action_permissions
       WHERE user_id = $1 AND provider = $2 AND action = $3 AND resource IS NULL`,
      [userId, provider, action]
    );

    if (actPerm.rows.length > 0) {
      const row = actPerm.rows[0];
      if (row.permission === "deny") {
        return { allowed: false, approvalRequired: false, reason: "Action is denied" };
      }
      return {
        allowed: true,
        approvalRequired: row.permission === "ask" || row.approval_required,
        reason: "General action permission matched"
      };
    }

    // 3. Default safe by design
    // Unrecognized actions are denied unless explicitly configured.
    return {
      allowed: false,
      approvalRequired: true,
      reason: "No permission policy configured for this action"
    };
  }

  async setPermission(policy: PermissionPolicy): Promise<void> {
    const id = crypto.randomUUID();
    await this.db.query(
      `INSERT INTO personal_ai.external_action_permissions
       (id, user_id, provider, action, resource, risk, permission, approval_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, provider, action, resource)
       DO UPDATE SET
         risk = EXCLUDED.risk,
         permission = EXCLUDED.permission,
         approval_required = EXCLUDED.approval_required,
         updated_at = NOW()`,
      [
        id,
        policy.userId,
        policy.provider,
        policy.action,
        policy.resource || null,
        policy.risk,
        policy.permission,
        policy.approvalRequired
      ]
    );
  }
}
