import type { ModelAdapter, ModelAdapterConfig } from "./model-adapter.js";
import { BharathModelAdapter, type BharathModelAdapterConfig } from "./bharath-model-adapter.js";
import { OpenAICompatibleAdapter } from "./openai-compatible-adapter.js";

export type OwnModelAdapterType = "bharath" | "openai-compatible";

export interface CreateOwnModelAdapterOptions {
  type: OwnModelAdapterType;
  bharath?: BharathModelAdapterConfig;
  openaiCompatible?: ModelAdapterConfig & { id?: string; name?: string };
}

/**
 * Factory for the own-model adapter.
 * Pass config explicitly — env vars are read by the caller (apps/api).
 */
export function createOwnModelAdapter(options: CreateOwnModelAdapterOptions): ModelAdapter {
  if (options.type === "openai-compatible") {
    const config = options.openaiCompatible;
    if (!config?.baseUrl || !config.model) {
      throw new Error("openaiCompatible.baseUrl and openaiCompatible.model are required");
    }
    return new OpenAICompatibleAdapter(
      config.id ?? "own-model",
      config.name ?? "Own Model",
      config,
    );
  }

  const bharath = options.bharath;
  if (!bharath?.baseUrl) {
    throw new Error("bharath.baseUrl is required");
  }

  return new BharathModelAdapter({
    baseUrl: bharath.baseUrl,
    timeoutMs: bharath.timeoutMs,
    defaultMode: bharath.defaultMode,
    useRag: bharath.useRag,
    useMemory: bharath.useMemory,
  });
}
