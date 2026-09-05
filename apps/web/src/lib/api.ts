/**
 * API client helpers — always send Bearer token.
 * AUTHENTICATED USER ID ≠ CLIENT-SUPPLIED userId (never send userId as authority).
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Dev session token — must match gateway AUTH_DEV_TOKEN (default: dev-token). */
export function getAuthToken(): string {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem("personal-ai-auth-token");
    if (stored) return stored;
  }
  return process.env.NEXT_PUBLIC_API_TOKEN ?? "dev-token";
}

export function authHeaders(extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${getAuthToken()}`,
    ...extra,
  };
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${getAuthToken()}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API_URL}${path}`, { ...init, headers });
}
