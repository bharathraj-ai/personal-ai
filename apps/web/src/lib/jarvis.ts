/** Jarvis agent mode — voice-first, proactive, auto-routes builds to Orchestrate. */

import type { VoicePrefs } from "./voice";

const JARVIS_MODE_KEY = "personal-ai-jarvis-mode";

export const JARVIS_WAKE_VARIANTS = ["hey jarvis", "hey papa", "ok jarvis", "okay jarvis"];

/** Voice defaults tuned for a calm assistant. */
export const JARVIS_VOICE_PREFS: Partial<VoicePrefs> = {
  autoSpeak: true,
  wakeWord: true,
  toneId: "calm",
  assistantStyle: "google",
  lang: "en-IN",
};

const BUILD_INTENT =
  /\b(create|build|make|implement|develop|scaffold|add|fix|update|deploy|generate)\b/i;
const BUILD_TARGET =
  /\b(website|web app|school|college|collage|management|project|app|api|folder|workspace|rbac|role|auth|code|feature|system)\b/i;
const ORCHESTRATE_EXPLICIT = /\b(orchestrate|approve|use defaults)\b/i;

export function isJarvisModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(JARVIS_MODE_KEY) === "true";
}

export function setJarvisModeEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(JARVIS_MODE_KEY, on ? "true" : "false");
}

/** Route Jarvis utterances: builds → orchestrate, Q&A → chat. */
export function resolveJarvisRoute(message: string): "orchestrate" | "chat" {
  const m = message.trim();
  if (ORCHESTRATE_EXPLICIT.test(m)) return "orchestrate";
  if (BUILD_INTENT.test(m) && BUILD_TARGET.test(m)) return "orchestrate";
  if (/\b(create|build)\s+(?:a\s+)?(?:school|management|website|project)\b/i.test(m)) {
    return "orchestrate";
  }
  return "chat";
}

/** Trim long markdown replies for text-to-speech. */
export function speakableJarvisReply(text: string, maxChars = 420): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " code block omitted ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxChars) return plain;
  const cut = plain.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("?"), cut.lastIndexOf("!"));
  return (lastStop > 80 ? cut.slice(0, lastStop + 1) : cut).trim() + "…";
}

export async function fetchJarvisBriefing(apiUrl: string, headers: HeadersInit): Promise<string> {
  try {
    const [healthRes, statusRes, laptopRes] = await Promise.all([
      fetch(`${apiUrl}/health`),
      fetch(`${apiUrl}/system/status`, { headers }),
      fetch(`${apiUrl}/system/laptop`, { headers }),
    ]);
    const health = healthRes.ok ? await healthRes.json() : null;
    const status = statusRes.ok ? await statusRes.json() : null;
    const laptop = laptopRes.ok ? await laptopRes.json() : null;

    const modelOk = health?.model?.modelLoaded === true || health?.model?.ready === true;
    const dbOk = health?.database?.healthy === true;
    const parts: string[] = ["Jarvis online."];

    if (modelOk) parts.push("Bharath model is loaded.");
    else parts.push("Bharath model weights are not loaded — search and tools still work.");

    if (dbOk) parts.push("Memory database connected.");
    else if (health?.database?.message) parts.push("Database offline — using in-memory fallback.");

    if (laptop?.cpuPercent != null) {
      parts.push(
        `Laptop CPU ${Math.round(laptop.cpuPercent)} percent, memory ${Math.round(laptop.memoryUsedPercent ?? 0)} percent.`,
      );
    }

    parts.push("Say Hey Jarvis or tap the mic. Ask anything, or tell me to build a project.");
    return parts.join(" ");
  } catch {
    return "Jarvis online. I'm ready — allow microphone access for hands-free mode, or type your request.";
  }
}

export const JARVIS_SUGGESTIONS = [
  "how's my laptop",
  "create school management system",
  "search latest AI news",
  "what can you do",
];
