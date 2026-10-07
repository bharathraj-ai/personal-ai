export interface ExternalConnectorConfig {
  userId: string;
  provider: string;
}

export interface ConnectorCapability {
  name: string; // e.g., 'READ_EMAIL', 'SEND_EMAIL'
  risk: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
}

export interface ExternalActionRequest<T = any> {
  action: string;
  resource?: string;
  payload?: T;
  idempotencyKey?: string;
}

export interface ExternalActionResponse<T = any> {
  success: boolean;
  actionId?: string;
  result?: T;
  error?: string;
  isRateLimited?: boolean;
  retryAfterSeconds?: number;
}

export interface ExternalConnector {
  readonly provider: string;
  readonly capabilities: ConnectorCapability[];

  /** Test if the connector is authenticated and healthy */
  healthCheck(userId: string): Promise<boolean>;

  /** Revoke tokens/access */
  revoke(userId: string): Promise<void>;

  /** Execute an action */
  execute<T = any, R = any>(
    userId: string,
    request: ExternalActionRequest<T>
  ): Promise<ExternalActionResponse<R>>;
}
