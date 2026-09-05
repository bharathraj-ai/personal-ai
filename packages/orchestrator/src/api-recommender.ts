/**
 * API Recommendation System — §12
 * Analyzes project requirements vs connected providers; never invents credentials.
 */

export interface ApiCapability {
  id: string;
  name: string;
  category: "ai" | "database" | "search" | "weather" | "auth" | "storage" | "payment" | "other";
  required: boolean;
}

export interface ConnectedProvider {
  id: string;
  name: string;
  category: ApiCapability["category"];
  connected: boolean;
}

export interface ApiRecommendation {
  goal: string;
  required: ApiCapability[];
  connected: ConnectedProvider[];
  missing: ApiCapability[];
  recommendations: Array<{
    capability: ApiCapability;
    suggestion: string;
    connectAction: string;
  }>;
}

const CAPABILITY_PATTERNS: Array<{ pattern: RegExp; capability: Omit<ApiCapability, "id"> }> = [
  { pattern: /chatbot|ai|llm|assistant|gpt/i, capability: { name: "AI Provider", category: "ai", required: true } },
  { pattern: /weather|forecast|temperature/i, capability: { name: "Weather API", category: "weather", required: true } },
  { pattern: /database|postgres|mysql|mongodb|sqlite|neon/i, capability: { name: "Database", category: "database", required: false } },
  { pattern: /search|google|brave|tavily|serp/i, capability: { name: "Search Provider", category: "search", required: false } },
  { pattern: /oauth|login|auth|sign.?in/i, capability: { name: "Authentication", category: "auth", required: false } },
  { pattern: /stripe|payment|checkout/i, capability: { name: "Payment API", category: "payment", required: true } },
  { pattern: /s3|storage|upload|bucket/i, capability: { name: "Object Storage", category: "storage", required: false } },
];

const DEFAULT_CONNECTED: ConnectedProvider[] = [
  { id: "own-model", name: "Own Model (Bharath AI)", category: "ai", connected: true },
  { id: "postgres", name: "PostgreSQL", category: "database", connected: false },
  { id: "search", name: "Search Provider", category: "search", connected: false },
];

export class ApiRecommender {
  constructor(
    private readonly connectedProviders: ConnectedProvider[] = DEFAULT_CONNECTED,
    private readonly options: { searchConnected?: boolean } = {},
  ) {}

  analyze(goal: string, extraConnected: ConnectedProvider[] = []): ApiRecommendation {
    const connected = this.mergeConnected(extraConnected);
    const required = this.detectRequiredCapabilities(goal);
    const missing = required.filter(
      (cap) => !connected.some((p) => p.category === cap.category && p.connected),
    );

    return {
      goal,
      required,
      connected,
      missing,
      recommendations: missing.map((cap) => ({
        capability: cap,
        suggestion: this.suggestProvider(cap),
        connectAction: `Connect ${cap.name}`,
      })),
    };
  }

  private detectRequiredCapabilities(goal: string): ApiCapability[] {
    const found: ApiCapability[] = [];
    const seen = new Set<string>();

    for (const { pattern, capability } of CAPABILITY_PATTERNS) {
      if (pattern.test(goal) && !seen.has(capability.category)) {
        seen.add(capability.category);
        found.push({ id: capability.category, ...capability });
      }
    }

    if (found.length === 0) {
      found.push({ id: "ai", name: "AI Provider", category: "ai", required: true });
    }

    return found;
  }

  private mergeConnected(extra: ConnectedProvider[]): ConnectedProvider[] {
    const map = new Map(this.connectedProviders.map((p) => [p.id, p]));
    for (const p of extra) map.set(p.id, p);
    if (this.options.searchConnected) {
      map.set("search", { id: "search", name: "Search Provider", category: "search", connected: true });
    }
    return [...map.values()];
  }

  private suggestProvider(cap: ApiCapability): string {
    switch (cap.category) {
      case "weather":
        return "Connect OpenWeatherMap, WeatherAPI, or another legitimate weather data provider.";
      case "search":
        return "Connect Brave Search API, Tavily, or SerpAPI for web discovery.";
      case "database":
        return "Connect Neon PostgreSQL or your preferred managed database.";
      case "payment":
        return "Connect Stripe or your payment processor with credentials stored in the secret vault.";
      case "auth":
        return "Configure OAuth provider (Google, GitHub, etc.) via secret vault.";
      case "storage":
        return "Connect S3-compatible storage; credentials never enter prompts.";
      default:
        return `Add a ${cap.name} integration via the provider manager.`;
    }
  }
}
