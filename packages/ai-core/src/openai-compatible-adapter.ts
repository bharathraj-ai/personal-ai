import type {
  GenerateOptions,
  GenerateResult,
  HealthStatus,
  StreamChunk,
  TokenUsage,
} from "@personal-ai/shared";
import type { ModelAdapterConfig } from "./model-adapter.js";
import type { ModelAdapter } from "./model-adapter.js";

/**
 * Generic adapter for any OpenAI-compatible API (Ollama, vLLM, LiteLLM, etc.).
 * Keeps the orchestrator decoupled from specific model families.
 */
export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly id: string;
  readonly name: string;

  constructor(
    id: string,
    name: string,
    private readonly config: ModelAdapterConfig,
  ) {
    this.id = id;
    this.name = name;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const response = await this.fetchChatCompletion(options, false);
    const data = (await response.json()) as OpenAIChatResponse;

    const choice = data.choices?.[0];
    if (!choice?.message) {
      throw new Error("Model API returned no chat message");
    }
    const toolCalls = choice.message.tool_calls?.map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: args,
      };
    });

    return {
      content: choice.message.content ?? "",
      toolCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
      finishReason: mapFinishReason(choice.finish_reason),
    };
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const response = await this.fetchChatCompletion(options, true);

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

          try {
            const chunk = JSON.parse(payload) as OpenAIStreamChunk;
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              yield { type: "text", content: delta.content };
            }
          } catch {
            // skip malformed SSE chunks
          }
        }
      }
      yield { type: "done" };
    } finally {
      reader.releaseLock();
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    const healthTimeout =
      this.config.healthTimeoutMs ?? this.config.timeoutMs ?? 20_000;
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(healthTimeout),
      });
      return {
        healthy: response.ok,
        latencyMs: Date.now() - start,
        message: response.ok ? undefined : `HTTP ${response.status}`,
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

  getModel(): string {
    return this.config.model;
  }

  setModel(model: string): void {
    this.config.model = model;
  }

  setApiKey(key: string): void {
    this.config.apiKey = key;
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.config.baseUrl}/models`, {
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 8000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id))
      .map((id) => id.replace(/^models\//, ""));
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  private async fetchChatCompletion(
    options: GenerateOptions,
    stream: boolean,
  ): Promise<Response> {
    const body: Record<string, unknown> = {
      model: this.config.model.replace(/^models\//, ""),
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      stream,
    };

    if (options.tools?.length) {
      body.tools = options.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    if (options.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(body),
      signal: options.signal ?? AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Model API error ${response.status}: ${text}`);
    }

    return response;
  }
}

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  choices: Array<{
    delta: { content?: string };
  }>;
}

function mapFinishReason(
  reason: string,
): GenerateResult["finishReason"] {
  switch (reason) {
    case "stop":
      return "stop";
    case "tool_calls":
      return "tool_calls";
    case "length":
      return "length";
    default:
      return "error";
  }
}
