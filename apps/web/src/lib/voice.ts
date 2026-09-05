/** Browser voice I/O via Web Speech API (no cloud TTS key required). */

export type VoiceGender = "female" | "male";

/** Assistant-inspired styles (not the proprietary Siri/Bixby/Alexa engines). */
export type AssistantStyle = "natural" | "siri" | "bixby" | "alexa" | "google";

export interface AssistantVoiceOption {
  id: AssistantStyle;
  label: string;
  hint: string;
  /** Default gender when this style is picked */
  defaultGender: VoiceGender;
  pitch: number;
  rate: number;
  /** Prefer these lang tags when ranking voices */
  preferLangs: string[];
  /** Boost voices whose name matches */
  nameHints: RegExp;
}

export const ASSISTANT_VOICES: AssistantVoiceOption[] = [
  {
    id: "natural",
    label: "Natural",
    hint: "Best match on this device",
    defaultGender: "female",
    pitch: 1,
    rate: 1,
    preferLangs: ["en-IN", "en-US", "en-GB"],
    nameHints: /./,
  },
  {
    id: "siri",
    label: "Siri-style",
    hint: "iPhone / Apple–like",
    defaultGender: "female",
    pitch: 1.05,
    rate: 0.98,
    preferLangs: ["en-US", "en-GB", "en-AU", "en-IN"],
    nameHints:
      /siri|samantha|karen|moira|tessa|fiona|victoria|karen|serena|apple|nora|allison|ava|susan|zoe|siri/i,
  },
  {
    id: "bixby",
    label: "Bixby-style",
    hint: "Samsung–like",
    defaultGender: "female",
    pitch: 1.08,
    rate: 0.96,
    preferLangs: ["en-US", "en-GB", "ko-KR", "en-IN"],
    nameHints: /bixby|samsung|yuna|sora|hyeryun|samsung english|narae|yuri/i,
  },
  {
    id: "alexa",
    label: "Alexa-style",
    hint: "Amazon–like",
    defaultGender: "female",
    pitch: 1.02,
    rate: 0.97,
    preferLangs: ["en-US", "en-GB", "en-IN"],
    nameHints:
      /alexa|amazon|joanna|salli|kimberly|kendra|ivy|amy|emma|polly|nicole/i,
  },
  {
    id: "google",
    label: "Google-style",
    hint: "Google Assistant–like",
    defaultGender: "female",
    pitch: 1.0,
    rate: 1.02,
    preferLangs: ["en-US", "en-GB", "en-IN"],
    nameHints:
      /google|chrome os|android|wavenet|neural|google us english|google uk english|google हिन्दी|google hindi/i,
  },
];

export interface VoiceTone {
  id: string;
  label: string;
  pitch: number;
  rate: number;
}

/** 10 selectable speaking tones (layered on top of assistant style) */
export const VOICE_TONES: VoiceTone[] = [
  { id: "calm", label: "Calm", pitch: 0.95, rate: 0.9 },
  { id: "warm", label: "Warm", pitch: 1.05, rate: 0.95 },
  { id: "clear", label: "Clear", pitch: 1.0, rate: 1.0 },
  { id: "soft", label: "Soft", pitch: 1.1, rate: 0.85 },
  { id: "bright", label: "Bright", pitch: 1.2, rate: 1.05 },
  { id: "deep", label: "Deep", pitch: 0.75, rate: 0.92 },
  { id: "fast", label: "Fast", pitch: 1.05, rate: 1.25 },
  { id: "slow", label: "Slow", pitch: 0.95, rate: 0.75 },
  { id: "narrator", label: "Narrator", pitch: 0.9, rate: 0.88 },
  { id: "energetic", label: "Energetic", pitch: 1.15, rate: 1.2 },
];

export interface VoicePrefs {
  gender: VoiceGender;
  toneId: string;
  assistantStyle: AssistantStyle;
  autoSpeak: boolean;
  /** Continuously listen for “Hey Papa” to start voice input */
  wakeWord: boolean;
  lang: string;
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  gender: "female",
  toneId: "clear",
  assistantStyle: "google",
  autoSpeak: true,
  wakeWord: true,
  lang: "en-IN",
};

export const WAKE_PHRASE = "hey jarvis";

/** Match wake phrases with common speech-to-text variants */
export function containsWakePhrase(transcript: string): boolean {
  const t = transcript.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  return (
    /\bhey\s+jarvis\b/.test(t) ||
    /\bok(?:ay)?\s+jarvis\b/.test(t) ||
    /\bhey\s+papa\b/.test(t) ||
    /\bhey\s+poppa\b/.test(t) ||
    /\bhay\s+papa\b/.test(t) ||
    /\ba\s+papa\b/.test(t) ||
    /\bhey\s+ppa\b/.test(t)
  );
}

export function stripWakePhrase(transcript: string): string {
  return transcript
    .replace(/\b(hey|hay|ok(?:ay)?)\s+(jarvis|papa|poppa|ppa)\b[,!.\s]*/gi, "")
    .trim();
}

const STORAGE_KEY = "personal-ai-voice-prefs";

export function loadVoicePrefs(): VoicePrefs {
  if (typeof window === "undefined") return DEFAULT_VOICE_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_PREFS;
    return { ...DEFAULT_VOICE_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_VOICE_PREFS;
  }
}

export function saveVoicePrefs(prefs: VoicePrefs): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

const FEMALE_HINTS =
  /female|woman|girl|zira|samantha|victoria|karen|moira|tessa|fiona|veena|raveena|priya|neerja|google uk english female|microsoft.*aria|microsoft.*jenny|microsoft.*sara|natasha|susan|hazel|joanna|salli|ivy|amy|emma|allison|ava|zoe/i;
const MALE_HINTS =
  /male|man|boy|david|mark|daniel|fred|bruce|tom|ravi|google uk english male|microsoft.*guy|microsoft.*ryan|microsoft.*davis|microsoft.*christopher|james|george|matthew|justin|joey|brian/i;

function getAssistant(style: AssistantStyle): AssistantVoiceOption {
  return ASSISTANT_VOICES.find((a) => a.id === style) ?? ASSISTANT_VOICES[0]!;
}

function scoreVoice(
  v: SpeechSynthesisVoice,
  gender: VoiceGender,
  lang: string,
  style: AssistantStyle,
): number {
  let score = 0;
  const name = `${v.name} ${v.voiceURI}`;
  const assistant = getAssistant(style);
  const langLower = v.lang.toLowerCase();

  if (langLower.startsWith(lang.slice(0, 2).toLowerCase())) score += 4;
  if (langLower === lang.toLowerCase()) score += 3;

  for (const prefer of assistant.preferLangs) {
    if (langLower === prefer.toLowerCase()) score += 4;
    else if (langLower.startsWith(prefer.slice(0, 2).toLowerCase())) score += 1;
  }

  if (style !== "natural" && assistant.nameHints.test(name)) score += 14;

  // Platform boosts
  if (style === "siri" && /apple|mac|iphone|siri|samantha|karen|moira/i.test(name)) score += 10;
  if (style === "bixby" && /samsung|bixby/i.test(name)) score += 12;
  if (style === "alexa" && /amazon|polly|joanna|salli|matthew/i.test(name)) score += 10;
  if (style === "google" && /google|chrome|android|wavenet|neural/i.test(name)) score += 12;

  if (gender === "female") {
    if (FEMALE_HINTS.test(name)) score += 8;
    if (MALE_HINTS.test(name)) score -= 8;
  } else {
    if (MALE_HINTS.test(name)) score += 8;
    if (FEMALE_HINTS.test(name)) score -= 8;
  }

  if (v.localService) score += 1;
  return score;
}

export function pickVoice(prefs: VoicePrefs): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  const ranked = [...voices].sort(
    (a, b) =>
      scoreVoice(b, prefs.gender, prefs.lang, prefs.assistantStyle) -
      scoreVoice(a, prefs.gender, prefs.lang, prefs.assistantStyle),
  );
  return ranked[0] ?? null;
}

export function resolveSpeechParams(prefs: VoicePrefs): { pitch: number; rate: number } {
  const assistant = getAssistant(prefs.assistantStyle);
  const tone = VOICE_TONES.find((t) => t.id === prefs.toneId) ?? VOICE_TONES[2]!;
  // Blend assistant baseline with selected tone (tone wins slightly)
  return {
    pitch: clamp(assistant.pitch * 0.45 + tone.pitch * 0.55, 0.5, 2),
    rate: clamp(assistant.rate * 0.45 + tone.rate * 0.55, 0.5, 2),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Strip markup / URLs for cleaner speech */
export function textForSpeech(raw: string): string {
  let t = raw
    .replace(/\[Model not loaded\][\s\S]*/gi, "Model weights are not loaded.")
    .replace(/Orchestrate needs Bharath[\s\S]*/gi, "Orchestrate needs model weights loaded.")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/```[\s\S]*?```/g, " code block. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[#*_>~]/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();

  if (t.length > 600) t = `${t.slice(0, 580)}…`;
  return t;
}

export function stopSpeaking(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}

export function speakText(text: string, prefs: VoicePrefs): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const clean = textForSpeech(text);
  if (!clean) return;

  stopSpeaking();

  const { pitch, rate } = resolveSpeechParams(prefs);
  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = prefs.lang;
  utter.pitch = pitch;
  utter.rate = rate;
  utter.volume = 1;

  const applyVoiceAndSpeak = () => {
    const voice = pickVoice(prefs);
    if (voice) {
      utter.voice = voice;
      if (voice.lang) utter.lang = voice.lang;
    }
    window.speechSynthesis.speak(utter);
  };

  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      applyVoiceAndSpeak();
      window.speechSynthesis.onvoiceschanged = null;
    };
  } else {
    applyVoiceAndSpeak();
  }
}

export function previewTone(prefs: VoicePrefs): void {
  const style = getAssistant(prefs.assistantStyle);
  const tone = VOICE_TONES.find((t) => t.id === prefs.toneId);
  speakText(
    `Hi, I'm your ${style.label} ${prefs.gender} voice, ${tone?.label ?? "Clear"} tone, for Personal AI.`,
    prefs,
  );
}

export function listInstalledVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean; length: number }>;
};

export function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): { input: boolean; output: boolean } {
  if (typeof window === "undefined") return { input: false, output: false };
  return {
    input: Boolean(getSpeechRecognition()),
    output: "speechSynthesis" in window,
  };
}
