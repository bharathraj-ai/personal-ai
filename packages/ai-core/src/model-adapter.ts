import type {
  GenerateOptions,
  GenerateResult,
  HealthStatus,
  StreamChunk,
  TokenUsage,
} from "@personal-ai/shared";

/**
 * Model-agnostic adapter interface.
 * All model access — own model or external — goes through this contract.
 * The orchestrator must never hard-code assumptions about a specific model family.
 */
export interface ModelAdapter {
  readonly id: string;
  readonly name: string;

  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
  healthCheck(): Promise<HealthStatus>;
  getUsage(): Promise<TokenUsage>;
  /** Optional — used to replace a model_not_found id without assuming a name. */
  listModels?(): Promise<string[]>;
  getModel?(): string | undefined;
  setModel?(model: string): void;
  setApiKey?(key: string): void;
}

export interface ModelAdapterConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Generation/stream timeout */
  timeoutMs?: number;
  /** Health probe timeout — often higher on slow networks */
  healthTimeoutMs?: number;
}
