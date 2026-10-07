import { DatabaseClient } from "@personal-ai/db";
import crypto from "node:crypto";
import { ExternalActionRequest, ExternalActionResponse } from "./types.js";

export class ExternalActionAudit {
  constructor(private db: DatabaseClient) {}

  async logAction(
    userId: string,
    provider: string,
    action: string,
    status: string,
    request: ExternalActionRequest,
    result?: ExternalActionResponse,
    approvedBy?: string,
    errorDetails?: string
  ): Promise<string> {
    const id = crypto.randomUUID();
    
    // Check idempotency first if completing
    if (status === "completed" && request.idempotencyKey) {
      const existing = await this.db.query(
        `SELECT id FROM personal_ai.external_actions WHERE provider = $1 AND idempotency_key = $2 AND status = 'completed'`,
        [provider, request.idempotencyKey]
      );
      if (existing.rows.length > 0) {
        throw new Error(`Idempotency conflict: action already completed for key ${request.idempotencyKey}`);
      }
    }

    await this.db.query(
      `INSERT INTO personal_ai.external_actions 
       (id, user_id, provider, action, status, idempotency_key, resource, request_payload, result_payload, error_details, approved_by, approval_timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        userId,
        provider,
        action,
        status,
        request.idempotencyKey || null,
        request.resource || null,
        request.payload ? JSON.stringify(request.payload) : null,
        result ? JSON.stringify(result) : null,
        errorDetails || null,
        approvedBy || null,
        approvedBy ? new Date() : null
      ]
    );

    return id;
  }
}
