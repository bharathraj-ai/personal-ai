import { ToolPermissionLevel, type ToolResult } from "@personal-ai/shared";
import type { ToolHandler } from "./registry.js";
import { webSearch } from "./web-search.js";
import { extractMainContent, htmlToText } from "./extract-content.js";
import { fetchPublicUrl, SsrfBlockedError } from "./ssrf.js";

export * from "./web-search.js";
export * from "./extract-content.js";
export * from "./ssrf.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 512_000;

export interface InternetToolsConfig {
  searchApiUrl?: string;
  searchApiKey?: string;
}

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const re = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      links.add(new URL(match[1], baseUrl).href);
    } catch {
      // skip invalid URLs
    }
  }
  return [...links].slice(0, 50);
}

async function safeFetch(url: string): Promise<{
  ok: boolean;
  status: number;
  body: string;
  contentType: string;
  lastModified?: string;
}> {
  const response = await fetchPublicUrl(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: MAX_BODY_BYTES,
    headers: { "User-Agent": "PersonalAI-Orchestrator/1.0 (research bot)" },
  });

  const contentType = response.headers.get("content-type") ?? "unknown";
  const lastModified = response.headers.get("last-modified") ?? undefined;
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      status: 413,
      body: `Response too large (${buffer.byteLength} bytes, max ${MAX_BODY_BYTES})`,
      contentType,
      lastModified,
    };
  }

  const body = new TextDecoder().decode(buffer);
  return { ok: response.ok, status: response.status, body, contentType, lastModified };
}

function extractTitle(html: string, fallback: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const t = m ? htmlToText(m[1] ?? "") : "";
  return t.slice(0, 200) || fallback;
}

function extractPublishedAt(html: string, lastModified?: string): string | undefined {
  const patterns = [
    /property=["']article:published_time["'][^>]*content=["']([^"']+)/i,
    /content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i,
    /property=["']article:modified_time["'][^>]*content=["']([^"']+)/i,
    /property=["']og:updated_time["'][^>]*content=["']([^"']+)/i,
    /name=["']date["'][^>]*content=["']([^"']+)/i,
    /name=["']pubdate["'][^>]*content=["']([^"']+)/i,
    /itemprop=["']datePublished["'][^>]*content=["']([^"']+)/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1] && !Number.isNaN(Date.parse(m[1]))) {
      return new Date(m[1]).toISOString();
    }
  }
  if (lastModified && !Number.isNaN(Date.parse(lastModified))) {
    return new Date(lastModified).toISOString();
  }
  return undefined;
}

export function createInternetTools(config: InternetToolsConfig = {}): ToolHandler[] {
  const fetchUrl: ToolHandler = {
    definition: {
      name: "fetch_url",
      description: "HTTP GET a URL and return status, content-type, and raw body (truncated)",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Full URL to fetch" } },
        required: ["url"],
      },
      permissionLevel: ToolPermissionLevel.READ,
    },
    async execute(args): Promise<ToolResult> {
      const url = String(args.url ?? "");
      try {
        new URL(url);
      } catch {
        return { success: false, output: null, error: "Invalid URL" };
      }

      try {
        const result = await safeFetch(url);
        return {
          success: result.ok,
          output: {
            url,
            status: result.status,
            contentType: result.contentType,
            body: result.body.slice(0, 8000),
            truncated: result.body.length > 8000,
            lastModified: result.lastModified,
            publishedAt: result.contentType.includes("html")
              ? extractPublishedAt(result.body, result.lastModified)
              : result.lastModified && !Number.isNaN(Date.parse(result.lastModified))
                ? new Date(result.lastModified).toISOString()
                : undefined,
          },
          error: result.ok ? undefined : `HTTP ${result.status}`,
        };
      } catch (err) {
        return {
          success: false,
          output: null,
          error:
            err instanceof SsrfBlockedError
              ? `SSRF blocked: ${err.message}`
              : err instanceof Error
                ? err.message
                : "Fetch failed",
        };
      }
    },
  };

  const readPage: ToolHandler = {
    definition: {
      name: "read_page",
      description: "Fetch a URL and extract readable text content from HTML",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
      permissionLevel: ToolPermissionLevel.READ,
    },
    async execute(args): Promise<ToolResult> {
      const url = String(args.url ?? "");
      try {
        const result = await safeFetch(url);
        if (!result.ok) {
          return { success: false, output: null, error: `HTTP ${result.status}` };
        }
        const extracted = result.contentType.includes("html")
          ? extractMainContent(result.body, url)
          : undefined;
        const text = extracted
          ? extracted.content
          : result.body.slice(0, 8000);
        const title = extracted?.title || (result.contentType.includes("html")
          ? extractTitle(result.body, url)
          : url);
        const publishedAt = extracted?.publishedAt
          ?? (result.contentType.includes("html")
            ? extractPublishedAt(result.body, result.lastModified)
            : result.lastModified && !Number.isNaN(Date.parse(result.lastModified))
              ? new Date(result.lastModified).toISOString()
              : undefined);
        return {
          success: true,
          output: {
            url,
            title,
            text: text.slice(0, 8000),
            wordCount: extracted?.wordCount ?? text.split(/\s+/).length,
            publishedAt,
            author: extracted?.author,
            lastModified: result.lastModified,
          },
        };
      } catch (err) {
        return {
          success: false,
          output: null,
          error:
            err instanceof SsrfBlockedError
              ? `SSRF blocked: ${err.message}`
              : err instanceof Error
                ? err.message
                : "Read failed",
        };
      }
    },
  };

  const extractContent: ToolHandler = {
    definition: {
      name: "extract_content",
      description:
        "Fetch a URL and extract title, main article content, author, and publication date. Strips navigation, menus, ads, and footers.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
      permissionLevel: ToolPermissionLevel.READ,
    },
    async execute(args): Promise<ToolResult> {
      const url = String(args.url ?? "");
      try {
        const result = await safeFetch(url);
        if (!result.ok) {
          return { success: false, output: null, error: `HTTP ${result.status}` };
        }
        if (!result.contentType.includes("html")) {
          const text = result.body.slice(0, 8000);
          return {
            success: true,
            output: {
              url,
              title: url,
              content: text,
              relevantText: text,
              wordCount: text.split(/\s+/).length,
            },
          };
        }
        const extracted = extractMainContent(result.body, url);
        return { success: true, output: extracted };
      } catch (err) {
        return {
          success: false,
          output: null,
          error:
            err instanceof SsrfBlockedError
              ? `SSRF blocked: ${err.message}`
              : err instanceof Error
                ? err.message
                : "Extract failed",
        };
      }
    },
  };

  const extractLinks: ToolHandler = {
    definition: {
      name: "extract_links",
      description: "Fetch a page and extract outbound links",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
      permissionLevel: ToolPermissionLevel.READ,
    },
    async execute(args): Promise<ToolResult> {
      const url = String(args.url ?? "");
      try {
        const result = await safeFetch(url);
        if (!result.ok) {
          return { success: false, output: null, error: `HTTP ${result.status}` };
        }
        const links = extractLinksFromHtml(result.body, url);
        return { success: true, output: { url, links, count: links.length } };
      } catch (err) {
        return {
          success: false,
          output: null,
          error:
            err instanceof SsrfBlockedError
              ? `SSRF blocked: ${err.message}`
              : err instanceof Error
                ? err.message
                : "Link extraction failed",
        };
      }
    },
  };

  const searchWeb: ToolHandler = {
    definition: {
      name: "search_web",
      description:
        "Search the web for current information (DuckDuckGo by default; Brave/Tavily if configured)",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results" },
        },
        required: ["query"],
      },
      permissionLevel: ToolPermissionLevel.READ,
    },
    async execute(args): Promise<ToolResult> {
      const query = String(args.query ?? "");
      try {
        const data = await webSearch(query, {
          searchApiUrl: config.searchApiUrl,
          searchApiKey: config.searchApiKey,
          limit: Number(args.limit ?? 5),
        });
        if (data.error && data.results.length === 0 && !data.answer) {
          return { success: false, output: data, error: data.error };
        }
        return { success: true, output: data };
      } catch (err) {
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : "Search failed",
        };
      }
    },
  };

  return [fetchUrl, readPage, extractContent, extractLinks, searchWeb];
}
