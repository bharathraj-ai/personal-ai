import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
    Object.setPrototypeOf(this, SsrfBlockedError.prototype);
  }
}

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google.com",
]);

const METADATA_IPS = new Set(["169.254.169.254", "169.254.170.2", "fd00:ec2::254"]);

function isPrivateV4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isBlockedIp(ip: string): boolean {
  const trimmed = ip.replace(/^\[/, "").replace(/\]$/, "");
  if (METADATA_IPS.has(trimmed)) return true;
  if (trimmed === "::1" || trimmed === "0:0:0:0:0:0:0:1") return true;
  if (trimmed.toLowerCase().startsWith("fe80:")) return true; // link-local
  if (trimmed.toLowerCase().startsWith("fc") || trimmed.toLowerCase().startsWith("fd")) return true; // ULA
  if (trimmed.startsWith("::ffff:")) {
    return isBlockedIp(trimmed.slice(7));
  }
  const v4 = trimmed.split(".").map((n) => Number(n));
  if (v4.length === 4 && v4.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return isPrivateV4(v4);
  }
  return false;
}

export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError("Only http/https URLs are allowed");
  }
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new SsrfBlockedError(`Blocked host: ${host}`);
  }
  if (host === "metadata" || host.includes("169.254.169.254")) {
    throw new SsrfBlockedError("Blocked metadata endpoint");
  }
  if (host === "::1" || (isIP(host) && isBlockedIp(host))) {
    throw new SsrfBlockedError(`Blocked IP: ${host}`);
  }
  return url;
}

export async function assertResolvedPublic(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (isIP(host)) {
    if (isBlockedIp(host)) {
      throw new SsrfBlockedError(`Blocked IP: ${host}`);
    }
    return;
  }
  try {
    const records = await lookup(url.hostname, { all: true, verbatim: true });
    for (const rec of records) {
      if (isBlockedIp(rec.address)) {
        throw new SsrfBlockedError(`Host ${url.hostname} resolves to blocked address ${rec.address}`);
      }
    }
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw err;
    throw new SsrfBlockedError(`DNS lookup failed for ${url.hostname}`);
  }
}

/** Fetch with SSRF checks on the initial URL and each redirect hop. */
export async function fetchPublicUrl(
  raw: string,
  init: RequestInit & { timeoutMs?: number; maxRedirects?: number; maxBytes?: number } = {},
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? 15_000;
  const maxRedirects = init.maxRedirects ?? 5;
  const maxBytes = init.maxBytes ?? 512_000;

  let current = String(raw);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = assertPublicHttpUrl(current);
    await assertResolvedPublic(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url.href, {
        method: init.method ?? "GET",
        headers: init.headers,
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const loc = response.headers.get("location");
        if (!loc) {
          throw new SsrfBlockedError("Redirect without Location header");
        }
        current = new URL(loc, url.href).href;
        continue;
      }

      const len = Number(response.headers.get("content-length") ?? "0");
      if (len > maxBytes) {
        throw new SsrfBlockedError(`Response too large (${len} bytes)`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SsrfBlockedError("Too many redirects");
}
