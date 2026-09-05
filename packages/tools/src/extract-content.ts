/**
 * Extract the main article from HTML.
 * Strips navigation, menus, cookie banners, ads, and footers.
 * Does not invent facts — it only cleans retrieved markup.
 */

export interface ExtractedPage {
  url: string;
  title: string;
  content: string;
  author?: string;
  publishedAt?: string;
  relevantText: string;
  wordCount: number;
  /** True when the fetch is a bot wall / JS shell, not an article. */
  unusable?: boolean;
}

const UNUSABLE_PAGE_RE =
  /\b(your browser is deprecated|please upgrade|enable javascript|javascript (is )?required|supported browser|update your browser|access denied|pardon our interruption|are you a robot|unusual traffic|verify you are human|just a moment|checking your browser|request unsuccessful)\b/i;

const APP_SHELL_HOST_RE =
  /(^|\.)(music\.youtube\.com|youtube\.com|youtu\.be|m\.youtube\.com|instagram\.com|facebook\.com|fb\.com|tiktok\.com|x\.com|twitter\.com|accounts\.google\.com)$/i;

/** Interstitials, bot walls, and JS app shells are not evidence. */
export function isUnusableWebContent(text: string, title?: string, url?: string): boolean {
  const blob = `${title ?? ""} ${text}`.replace(/\s+/g, " ").trim();
  if (!blob) return true;
  if (UNUSABLE_PAGE_RE.test(blob)) return true;
  if (url && isAppShellUrl(url) && blob.length < 400) return true;
  if (blob.length < 40 && /upgrade|deprecated|enable javascript/i.test(blob)) return true;
  return false;
}

export function isAppShellUrl(url: string): boolean {
  try {
    return APP_SHELL_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

const NOISE_TAG_RE =
  /<(script|style|noscript|svg|iframe|canvas|form|button|nav|footer|header|aside)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;

const NOISE_ATTR_RE =
  /\b(id|class|role)=["'][^"']*\b(nav|menu|footer|header|sidebar|cookie|consent|advert|adsbygoogle|promo|related|share|social|comment|toc|mw-navigation|mw-panel|vector-header|vector-menu|catlinks|navbox)\b[^"']*["']/i;

export function extractMainContent(html: string, url = ""): ExtractedPage {
  const title = extractTitle(html, url);
  const author = extractAuthor(html);
  const publishedAt = extractPublishedAt(html);

  let working = html;
  working = working.replace(/<!--[\s\S]*?-->/g, " ");
  working = working.replace(NOISE_TAG_RE, " ");

  const preferred = pickPreferredRegion(working);
  const cleanedHtml = preferred ?? stripNoiseElements(working);
  let text = htmlToText(cleanedHtml);
  text = dropChromeLines(text);

  const content = text.replace(/\s+/g, " ").trim();
  const relevantText = content.slice(0, 6000);
  const unusable = isUnusableWebContent(relevantText, title, url);

  return {
    url,
    title: unusable && UNUSABLE_PAGE_RE.test(title) ? url : title,
    content: unusable ? "" : relevantText,
    author,
    publishedAt,
    relevantText: unusable ? "" : relevantText,
    wordCount: unusable ? 0 : relevantText ? relevantText.split(/\s+/).length : 0,
    unusable,
  };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function pickPreferredRegion(html: string): string | undefined {
  const patterns = [
    /id=["']mw-content-text["'][^>]*>([\s\S]*?)<div[^>]*id=["']mw-navigation/i,
    /class=["'][^"']*mw-parser-output[^"']*["'][^>]*>([\s\S]*?)$/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /role=["']main["'][^>]*>([\s\S]*?)$/i,
    /id=["']content["'][^>]*>([\s\S]*?)$/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    const body = m?.[1]?.trim();
    if (body && htmlToText(body).length >= 80) return body;
  }
  return undefined;
}

function stripNoiseElements(html: string): string {
  return html.replace(/<([a-z][a-z0-9]*)\b([^>]*)>[\s\S]*?<\/\1>/gi, (full, _tag, attrs: string) => {
    if (NOISE_ATTR_RE.test(attrs)) return " ";
    return full;
  });
}

function dropChromeLines(text: string): string {
  const drop =
    /^(jump to|skip to|main menu|navigation|contents|from wikipedia|the free encyclopedia|cookie|accept all|sign in|log in|subscribe|related articles|see also|edit links|languages?)$/i;
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && !drop.test(l) && !/^[\[\]|•·]+$/.test(l))
    .join(" ");
}

function extractTitle(html: string, fallback: string): string {
  const og = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i);
  if (og?.[1]) return htmlToText(og[1]).slice(0, 200);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t?.[1]) return htmlToText(t[1]).replace(/\s*[—|-]\s*Wikipedia$/i, "").slice(0, 200);
  return fallback.slice(0, 200);
}

function extractAuthor(html: string): string | undefined {
  const patterns = [
    /name=["']author["'][^>]*content=["']([^"']+)/i,
    /content=["']([^"']+)["'][^>]*name=["']author["']/i,
    /property=["']article:author["'][^>]*content=["']([^"']+)/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]?.trim()) return htmlToText(m[1]).slice(0, 120);
  }
  return undefined;
}

function extractPublishedAt(html: string): string | undefined {
  const patterns = [
    /property=["']article:published_time["'][^>]*content=["']([^"']+)/i,
    /itemprop=["']datePublished["'][^>]*content=["']([^"']+)/i,
    /name=["']date["'][^>]*content=["']([^"']+)/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1] && !Number.isNaN(Date.parse(m[1]))) {
      return new Date(m[1]).toISOString();
    }
  }
  return undefined;
}
