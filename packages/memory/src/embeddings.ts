/**
 * Embedding provider abstraction — replaceable (local hash / HTTP OpenAI-compatible).
 * Dimension must match pgvector column usage.
 */

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  healthCheck(): Promise<{ healthy: boolean; message?: string }>;
}

export interface EmbeddingProviderConfig {
  dimensions?: number;
  /** OpenAI-compatible embeddings base URL, e.g. https://api.openai.com/v1 */
  apiUrl?: string;
  apiKey?: string;
  model?: string;
}

/** Deterministic local embedding for offline/dev — no external API required. */
export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local-hash";
  readonly dimensions: number;

  constructor(dimensions = 384) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    return hashEmbed(text, this.dimensions);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  async healthCheck() {
    return { healthy: true, message: `local-hash dim=${this.dimensions}` };
  }
}

/** OpenAI-compatible /embeddings endpoint. */
export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly id = "http-embeddings";
  readonly dimensions: number;

  constructor(
    private readonly config: {
      apiUrl: string;
      apiKey?: string;
      model: string;
      dimensions: number;
    },
  ) {
    this.dimensions = config.dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const base = this.config.apiUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.config.model, input: texts }),
    });

    if (!res.ok) {
      throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => {
        if (d.embedding.length !== this.dimensions) {
          throw new Error(
            `Embedding dim mismatch: got ${d.embedding.length}, expected ${this.dimensions}`,
          );
        }
        return d.embedding;
      });
  }

  async healthCheck() {
    try {
      await this.embed("health");
      return { healthy: true };
    } catch (err) {
      return {
        healthy: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig = {},
): EmbeddingProvider {
  const dimensions = config.dimensions ?? 384;

  if (config.apiUrl) {
    return new HttpEmbeddingProvider({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      model: config.model ?? "text-embedding-3-small",
      dimensions,
    });
  }

  return new LocalHashEmbeddingProvider(dimensions);
}

function hashEmbed(text: string, dimensions: number): number[] {
  const vec = new Float64Array(dimensions);
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dimensions;
    const sign = h & 1 ? 1 : -1;
    vec[idx] += sign;
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(dimensions);
  for (let i = 0; i < dimensions; i++) out[i] = vec[i] / norm;
  return out;
}

export function vectorToSql(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
