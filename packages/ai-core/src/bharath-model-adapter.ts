import type {
  GenerateOptions,
  GenerateResult,
  HealthStatus,
  Message,
  StreamChunk,
  TokenUsage,
} from "@personal-ai/shared";
import type { ModelAdapter } from "./model-adapter.js";

export interface BharathModelAdapterConfig {
  /** Bharath AI API base URL, e.g. http://localhost:8000 */
  baseUrl: string;
  timeoutMs?: number;
  defaultMode?: "auto" | "chat" | "code" | "document_qa" | "mentor";
  useRag?: boolean;
  useMemory?: boolean;
}

interface BharathChatResponse {
  response: string;
  sources?: string[];
  memories_used?: string[];
  mode?: string;
  confidence?: number;
}

interface BharathHealthResponse {
  status: string;
  model_loaded?: boolean;
}

/**
 * Adapter for Bharath AI — your own PyTorch model served via FastAPI.
 * Connects to POST /api/chat and GET /api/health on the Bharath AI server.
 */
export class BharathModelAdapter implements ModelAdapter {
  readonly id = "bharath-ai";
  readonly name = "Bharath AI";

  constructor(private readonly config: BharathModelAdapterConfig) {}

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const message = formatMessages(options.messages);
    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        mode: this.config.defaultMode ?? "auto",
        use_rag: this.config.useRag ?? true,
        use_memory: this.config.useMemory ?? true,
        max_tokens: options.maxTokens ?? 512,
        temperature: options.temperature ?? 0.7,
        stream: false,
      }),
      signal: options.signal ?? AbortSignal.timeout(this.config.timeoutMs ?? 120_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Bharath AI error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as BharathChatResponse;

    return {
      content: data.response,
      finishReason: "stop",
    };
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const message = formatMessages(options.messages);
    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        mode: this.config.defaultMode ?? "auto",
        use_rag: this.config.useRag ?? true,
        use_memory: this.config.useMemory ?? true,
        max_tokens: options.maxTokens ?? 512,
        temperature: options.temperature ?? 0.7,
        stream: true,
      }),
      signal: options.signal ?? AbortSignal.timeout(this.config.timeoutMs ?? 120_000),
    });

    if (!response.ok) {
      const text = await response.text();
      yield { type: "error", error: `Bharath AI error ${response.status}: ${text}` };
      return;
    }

    if (!response.body) {
      yield { type: "error", error: "No response body" };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") {
            yield { type: "done" };
            return;
          }
          yield { type: "text", content: payload };
        }
      }
      yield { type: "done" };
    } finally {
      reader.releaseLock();
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.config.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 5000),
      });

      if (!response.ok) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          message: `HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as BharathHealthResponse;
      const modelLoaded = data.model_loaded === true;
      const serviceUp = data.status === "healthy" || data.status === "ok";

      return {
        // Fully ready only when weights are loaded
        healthy: serviceUp && modelLoaded,
        latencyMs: Date.now() - start,
        modelLoaded,
        message: !serviceUp
          ? `Bharath AI status: ${data.status}`
          : modelLoaded
            ? undefined
            : "Bharath AI running but model weights not loaded yet (NOT_LOADED)",
      };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  async getUsage(): Promise<TokenUsage> {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
}

/** Bharath API accepts a single message — fold conversation history into one prompt. */
function formatMessages(messages: Message[]): string {
  if (messages.length === 0) return "";
  if (messages.length === 1) return messages[0].content;

  const system = messages.filter((m) => m.role === "system").map((m) => m.content);
  const conversation = messages.filter((m) => m.role !== "system");

  const parts: string[] = [];

  if (system.length > 0) {
    parts.push(system.join("\n\n"));
  }

  if (conversation.length > 1) {
    parts.push("Previous conversation:");
    for (const msg of conversation.slice(0, -1)) {
      const label = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "Tool";
      parts.push(`${label}: ${msg.content}`);
    }
    parts.push("");
  }

  const last = conversation.at(-1);
  if (last) {
    parts.push(last.role === "user" ? last.content : `Assistant: ${last.content}`);
  }

  return parts.join("\n");
}
