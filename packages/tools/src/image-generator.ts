/**
 * Image generation abstraction layer.
 * Supports: OpenAI DALL-E, Fal.ai, Stability AI, and placeholder (offline).
 * Never fabricates results — if a provider is unavailable, returns a clear error.
 */

export interface ImageGenerationRequest {
  prompt: string;
  /** negative prompt to suppress unwanted elements */
  negativePrompt?: string;
  /** w × h pixels. Common: 1024x1024 (DALL-E 3 default) */
  size?: "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792";
  /** number of images */
  n?: number;
  /** quality for DALL-E 3 */
  quality?: "standard" | "hd";
  /** style for DALL-E 3 */
  style?: "vivid" | "natural";
}

export interface GeneratedImage {
  /** URL or base64 data URI */
  url?: string;
  b64Json?: string;
  revisedPrompt?: string;
  provider: string;
  model: string;
}

export interface ImageGenerationResult {
  images: GeneratedImage[];
  error?: string;
  provider: string;
  model: string;
  /** How many seconds it took */
  latencyMs: number;
}

export interface ImageProviderConfig {
  /** Provider: openai | fal | stability | local */
  provider: "openai" | "fal" | "stability" | "placeholder";
  apiKey?: string;
  baseUrl?: string;
  /** Model override */
  model?: string;
  timeoutMs?: number;
}

/** DALL-E 3 via OpenAI API */
async function generateOpenAI(
  request: ImageGenerationRequest,
  config: ImageProviderConfig,
): Promise<ImageGenerationResult> {
  const start = Date.now();
  const baseUrl = config.baseUrl ?? "https://api.openai.com";
  const model = config.model ?? "dall-e-3";

  const body = {
    model,
    prompt: request.prompt,
    n: Math.min(request.n ?? 1, model === "dall-e-3" ? 1 : 4),
    size: request.size ?? "1024x1024",
    quality: request.quality ?? "standard",
    style: request.style ?? "vivid",
    response_format: "url",
  };

  const res = await fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      images: [],
      error: `OpenAI image API error ${res.status}: ${text.slice(0, 300)}`,
      provider: "openai",
      model,
      latencyMs: Date.now() - start,
    };
  }

  const data = (await res.json()) as {
    data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
  };

  return {
    images: (data.data ?? []).map((img) => ({
      url: img.url,
      b64Json: img.b64_json,
      revisedPrompt: img.revised_prompt,
      provider: "openai",
      model,
    })),
    provider: "openai",
    model,
    latencyMs: Date.now() - start,
  };
}

/** Fal.ai — supports FLUX and other models */
async function generateFal(
  request: ImageGenerationRequest,
  config: ImageProviderConfig,
): Promise<ImageGenerationResult> {
  const start = Date.now();
  const model = config.model ?? "fal-ai/flux/schnell";
  const baseUrl = config.baseUrl ?? "https://fal.run";

  const res = await fetch(`${baseUrl}/${model}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${config.apiKey}`,
    },
    body: JSON.stringify({
      prompt: request.prompt,
      negative_prompt: request.negativePrompt,
      image_size: request.size?.replace("x", "×") ?? "square_hd",
      num_images: request.n ?? 1,
    }),
    signal: AbortSignal.timeout(config.timeoutMs ?? 90_000),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      images: [],
      error: `Fal.ai error ${res.status}: ${text.slice(0, 300)}`,
      provider: "fal",
      model,
      latencyMs: Date.now() - start,
    };
  }

  const data = (await res.json()) as { images?: Array<{ url?: string }> };
  return {
    images: (data.images ?? []).map((img) => ({
      url: img.url,
      provider: "fal",
      model,
    })),
    provider: "fal",
    model,
    latencyMs: Date.now() - start,
  };
}

/** Offline placeholder — returns a descriptive error without faking success */
function generatePlaceholder(request: ImageGenerationRequest): ImageGenerationResult {
  return {
    images: [],
    error: `Image generation is offline. Configure OPENAI_API_KEY, FAL_API_KEY, or STABILITY_API_KEY to enable image generation. Requested prompt: "${request.prompt.slice(0, 100)}"`,
    provider: "placeholder",
    model: "none",
    latencyMs: 0,
  };
}

/** Main entry point — auto-selects provider from config */
export async function generateImage(
  request: ImageGenerationRequest,
  config: ImageProviderConfig,
): Promise<ImageGenerationResult> {
  switch (config.provider) {
    case "openai":
      if (!config.apiKey) {
        return { images: [], error: "OPENAI_API_KEY is required for image generation", provider: "openai", model: config.model ?? "dall-e-3", latencyMs: 0 };
      }
      return generateOpenAI(request, config);

    case "fal":
      if (!config.apiKey) {
        return { images: [], error: "FAL_API_KEY is required for Fal.ai image generation", provider: "fal", model: config.model ?? "fal-ai/flux/schnell", latencyMs: 0 };
      }
      return generateFal(request, config);

    case "placeholder":
    default:
      return generatePlaceholder(request);
  }
}

/** Build config from environment variables */
export function imageProviderFromEnv(): ImageProviderConfig {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.IMAGE_MODEL ?? "dall-e-3",
      timeoutMs: Number(process.env.IMAGE_TIMEOUT_MS ?? 60_000),
    };
  }
  if (process.env.FAL_API_KEY?.trim()) {
    return {
      provider: "fal",
      apiKey: process.env.FAL_API_KEY,
      model: process.env.IMAGE_MODEL ?? "fal-ai/flux/schnell",
      timeoutMs: Number(process.env.IMAGE_TIMEOUT_MS ?? 90_000),
    };
  }
  return { provider: "placeholder" };
}
