/**
 * Web search — Brave/Tavily when configured, else DuckDuckGo (no API key).
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  provider: string;
  results: WebSearchResult[];
  answer?: string;
  error?: string;
}

export interface WebSearchConfig {
  searchApiUrl?: string;
  searchApiKey?: string;
  /** Force provider: brave | tavily | duckduckgo | auto */
  provider?: string;
  limit?: number;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchDuckDuckGo(query: string, limit: number): Promise<WebSearchResponse> {
  const results: WebSearchResult[] = [];
  let answer: string | undefined;

  // Instant Answer API (free, no key)
  try {
    const iaUrl = new URL("https://api.duckduckgo.com/");
    iaUrl.searchParams.set("q", query);
    iaUrl.searchParams.set("format", "json");
    iaUrl.searchParams.set("no_html", "1");
    iaUrl.searchParams.set("skip_disambig", "1");

    const iaRes = await fetch(iaUrl, {
      headers: { "User-Agent": "PersonalAI/1.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (iaRes.ok) {
      const data = (await iaRes.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        AbstractSource?: string;
        Heading?: string;
        Answer?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: unknown[] }>;
      };

      if (data.Answer?.trim()) answer = data.Answer.trim();
      if (data.AbstractText?.trim()) {
        answer = answer
          ? `${answer}\n\n${data.AbstractText.trim()}`
          : data.AbstractText.trim();
        if (data.AbstractURL) {
          results.push({
            title: data.Heading || data.AbstractSource || "DuckDuckGo",
            url: data.AbstractURL,
            snippet: data.AbstractText.trim(),
          });
        }
      }

      for (const topic of data.RelatedTopics ?? []) {
        if (topic.Text && topic.FirstURL && results.length < limit) {
          results.push({
            title: topic.Text.split(" - ")[0]?.slice(0, 120) || topic.Text.slice(0, 80),
            url: topic.FirstURL,
            snippet: topic.Text,
          });
        }
      }
    }
  } catch {
    // continue to HTML fallback
  }

  // HTML lite results (broader coverage for news/sports)
  try {
    const htmlCandidates = [
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    ];
    for (const htmlUrl of htmlCandidates) {
      if (results.length >= limit) break;
      const htmlRes = await fetch(htmlUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      });

      if (!htmlRes.ok) continue;
      const html = await htmlRes.text();
      const patterns = [
        /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>)?/gi,
        /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
        /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
      ];
      for (const blockRe of patterns) {
        let match: RegExpExecArray | null;
        while ((match = blockRe.exec(html)) !== null && results.length < limit) {
          let url = match[1];
          try {
            const u = new URL(url, "https://duckduckgo.com");
            const uddg = u.searchParams.get("uddg");
            if (uddg) url = decodeURIComponent(uddg);
          } catch {
            // keep
          }
          const title = htmlToText(match[2] ?? "").slice(0, 160);
          const snippet = htmlToText(match[3] ?? "").slice(0, 300);
          if (!title || !url.startsWith("http")) continue;
          if (results.some((r) => r.url === url)) continue;
          results.push({ title, url, snippet: snippet || title });
        }
      }
    }
  } catch {
    // ignore
  }

  if (results.length === 0 && !answer) {
    // Wikipedia OpenSearch — free entity lookup when DDG returns nothing (still not a replacement for DDG)
    try {
      const wikiUrl = new URL("https://en.wikipedia.org/w/api.php");
      wikiUrl.searchParams.set("action", "opensearch");
      wikiUrl.searchParams.set("search", query);
      wikiUrl.searchParams.set("limit", String(Math.min(limit, 5)));
      wikiUrl.searchParams.set("namespace", "0");
      wikiUrl.searchParams.set("format", "json");
      const wikiRes = await fetch(wikiUrl, {
        headers: { "User-Agent": "PersonalAI/1.0 (local; entity-fallback)" },
        signal: AbortSignal.timeout(10_000),
      });
      if (wikiRes.ok) {
        const data = (await wikiRes.json()) as [string, string[], string[], string[]];
        const titles = data[1] ?? [];
        const descs = data[2] ?? [];
        const urls = data[3] ?? [];
        for (let i = 0; i < titles.length && results.length < limit; i++) {
          const url = urls[i];
          if (!url?.startsWith("http")) continue;
          results.push({
            title: titles[i] || "Wikipedia",
            url,
            snippet: descs[i] || titles[i] || "Wikipedia result",
          });
        }
      }
    } catch {
      // ignore
    }
  }

  if (results.length === 0 && !answer) {
    return {
      query,
      provider: "duckduckgo",
      results: [],
      error: "No search results (network blocked or DuckDuckGo unavailable)",
    };
  }

  return {
    query,
    provider: results.some((r) => r.url.includes("wikipedia.org")) && !answer
      ? "duckduckgo+wikipedia"
      : "duckduckgo",
    results: results.slice(0, limit),
    answer,
  };
}

async function searchBrave(
  query: string,
  apiUrl: string,
  apiKey: string,
  limit: number,
): Promise<WebSearchResponse> {
  const base = apiUrl.includes("?")
    ? apiUrl
    : `${apiUrl.replace(/\/$/, "")}?q=${encodeURIComponent(query)}&count=${limit}`;

  const url = apiUrl.includes("q=")
    ? apiUrl
    : `${apiUrl.split("?")[0]}?q=${encodeURIComponent(query)}&count=${limit}`;

  const res = await fetch(url || base, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    return {
      query,
      provider: "brave",
      results: [],
      error: `Brave Search HTTP ${res.status}`,
    };
  }

  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };

  const results = (data.web?.results ?? [])
    .slice(0, limit)
    .map((r) => ({
      title: r.title ?? "Result",
      url: r.url ?? "",
      snippet: r.description ?? "",
    }))
    .filter((r) => r.url);

  return { query, provider: "brave", results };
}

async function searchTavily(
  query: string,
  apiUrl: string,
  apiKey: string,
  limit: number,
): Promise<WebSearchResponse> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: limit,
      include_answer: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    return {
      query,
      provider: "tavily",
      results: [],
      error: `Tavily HTTP ${res.status}`,
    };
  }

  const data = (await res.json()) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  return {
    query,
    provider: "tavily",
    answer: data.answer,
    results: (data.results ?? []).slice(0, limit).map((r) => ({
      title: r.title ?? "Result",
      url: r.url ?? "",
      snippet: r.content ?? "",
    })),
  };
}

/** Run a web search using the best available provider. */
export async function webSearch(
  query: string,
  config: WebSearchConfig = {},
): Promise<WebSearchResponse> {
  const limit = config.limit ?? 5;
  const provider = (config.provider ?? process.env.SEARCH_PROVIDER ?? "auto").toLowerCase();
  const apiUrl = config.searchApiUrl ?? process.env.SEARCH_API_URL;
  const apiKey = config.searchApiKey ?? process.env.SEARCH_API_KEY;

  if ((provider === "brave" || provider === "auto") && apiUrl?.includes("brave") && apiKey) {
    return searchBrave(query, apiUrl, apiKey, limit);
  }
  if ((provider === "tavily" || provider === "auto") && apiUrl?.includes("tavily") && apiKey) {
    return searchTavily(query, apiUrl, apiKey, limit);
  }
  if (provider === "brave" || provider === "tavily") {
    return {
      query,
      provider,
      results: [],
      error: `${provider} requires SEARCH_API_URL and SEARCH_API_KEY`,
    };
  }

  // Default: free DuckDuckGo (no key)
  return searchDuckDuckGo(query, limit);
}

/** Format search results into a chat-ready answer. */
export function formatSearchAnswer(search: WebSearchResponse): string {
  if (search.error && search.results.length === 0 && !search.answer) {
    return `I couldn't search the web right now (${search.error}).`;
  }

  const lines: string[] = [];
  if (search.answer?.trim()) {
    lines.push(search.answer.trim());
  } else if (search.results[0]?.snippet) {
    lines.push(search.results[0].snippet);
  } else {
    lines.push("I found some web results, but not a clear answer.");
  }

  return lines.join("\n").trim();
}

/** Heuristic: should Chat auto-search the web for this message? */
export function shouldAutoWebSearch(message: string): boolean {
  const m = message.toLowerCase().trim();
  if (m.length < 2) return false;

  if (/^(?:what(?:'s| is)\s+)?\d+\s*[\+\-×x*\/÷]\s*\d+/.test(m)) return false;

  // Casual / conversational — never force search
  if (
    /^(hi|hello|hey|thanks|thank you|ok|okay|bye|good morning|good night)\b/i.test(m) ||
    /^(what('?s| is| are)?\s+you\s+(doing|up to)|how are you|who are you|what can you do)\b/i.test(
      m,
    ) ||
    /^(help|test|ping|status)\b/i.test(m)
  ) {
    return false;
  }

  // Never auto-search for local laptop / coding / project requests
  if (
    (/\b(create|make|mkdir|delete|remove|rm|erase|rename|move|copy)\b/.test(m) &&
      (/\b(folder|directory|dir|file)\b/.test(m) ||
        /\b(downloads?|desktop|documents?|laptop)\b/.test(m) ||
        /personal\s*ai/.test(m))) ||
    /\bin my (laptop|pc|computer|downloads?|desktop|documents?)\b/.test(m) ||
    /\b(write code|create project|run tests|npm install|school\s+management|management\s+system)\b/.test(
      m,
    ) ||
    /\bbuild (?:a |an )?(react|next\.?js|vue)(?:\s+app)?\b/.test(m)
  ) {
    return false;
  }

  const patterns = [
    /\bvs\.?\b/,
    /\bscore\b/,
    /\bnews\b/,
    /\btoday\b/,
    /\blatest\b/,
    /\bcurrent\b/,
    /\bweather\b/,
    /\bwho won\b/,
    /\bwho is\b/,
    /\bmatch\b/,
    /\bcricket\b/,
    /\bfootball\b/,
    /\bstock\b/,
    /\bprice of\b/,
    /\bwhat is happening\b/,
    /\bsearch\b/,
    /\bgoogle\b/,
    /\blive\b/,
    /\bbiography\b/,
    /\babout\b.+\b(player|cricketer|actor|ceo)\b/,
  ];

  if (patterns.some((p) => p.test(m))) return true;

  // Question-form factual asks
  if (
    /^(who|what|when|where|how)\b/.test(m) &&
    m.split(/\s+/).length <= 12 &&
    !/^(what('?s| is| are)?\s+you\b)/.test(m)
  ) {
    return true;
  }

  // Short entity / person / topic lookups (e.g. "virat kohli") — optional search only
  const words = m.split(/\s+/);
  if (
    words.length >= 1 &&
    words.length <= 4 &&
    /^[a-z0-9][a-z0-9 .'-]*$/i.test(m) &&
    !/^(you|me|my|the|a|an|this|that|it|yes|no)$/i.test(m)
  ) {
    return true;
  }

  return false;
}
