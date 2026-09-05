"use client";

import { useEffect, useState } from "react";
import {
  ASSISTANT_VOICES,
  VOICE_TONES,
  type AssistantStyle,
  type VoiceGender,
  type VoicePrefs,
  listInstalledVoices,
  previewTone,
  saveVoicePrefs,
  speechSupported,
} from "@/lib/voice";

interface Props {
  prefs: VoicePrefs;
  onChange: (prefs: VoicePrefs) => void;
  open: boolean;
  onClose: () => void;
}

export function VoiceSettings({ prefs, onChange, open, onClose }: Props) {
  const [support, setSupport] = useState({ input: false, output: false });
  const [voiceCount, setVoiceCount] = useState(0);

  useEffect(() => {
    setSupport(speechSupported());
    const refresh = () => setVoiceCount(listInstalledVoices().length);
    refresh();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = refresh;
      return () => {
        window.speechSynthesis.onvoiceschanged = null;
      };
    }
  }, []);

  if (!open) return null;

  const set = (patch: Partial<VoicePrefs>) => {
    const next = { ...prefs, ...patch };
    onChange(next);
    saveVoicePrefs(next);
  };

  const pickAssistant = (id: AssistantStyle) => {
    const opt = ASSISTANT_VOICES.find((a) => a.id === id);
    set({
      assistantStyle: id,
      gender: opt?.defaultGender ?? prefs.gender,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/55"
        aria-label="Close voice settings"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg mx-auto max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-surface-border bg-surface-raised p-4 shadow-glow animate-fade-up">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg text-ink">Voice</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-ink-faint hover:text-ink px-2 py-1"
          >
            Done
          </button>
        </div>

        <p className="text-[11px] text-ink-faint mb-3 leading-relaxed">
          Siri / Bixby / Alexa / Google styles use the closest voices installed on this device
          ({voiceCount} available). Real branded engines aren’t available to third-party apps.
        </p>

        <label className="flex items-center justify-between gap-3 py-2 border-b border-surface-border/70">
          <span className="text-sm text-ink">Speak replies</span>
          <input
            type="checkbox"
            checked={prefs.autoSpeak}
            onChange={(e) => set({ autoSpeak: e.target.checked })}
            className="h-4 w-4 accent-[#2eb8a0]"
          />
        </label>

        <label className="flex items-center justify-between gap-3 py-2 border-b border-surface-border/70">
          <div>
            <span className="text-sm text-ink block">Hey Jarvis wake word</span>
            <span className="text-[11px] text-ink-faint">Always listen — say “Hey Jarvis” (or Hey Papa) to talk</span>
          </div>
          <input
            type="checkbox"
            checked={prefs.wakeWord}
            onChange={(e) => set({ wakeWord: e.target.checked })}
            className="h-4 w-4 accent-[#2eb8a0]"
          />
        </label>

        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">
            Assistant voice
          </p>
          <div className="grid grid-cols-1 gap-2">
            {ASSISTANT_VOICES.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => pickAssistant(a.id)}
                className={`text-left px-3 py-2.5 rounded-xl transition ${
                  prefs.assistantStyle === a.id
                    ? "bg-accent/20 border border-accent/50"
                    : "bg-surface-soft border border-surface-border hover:border-accent/30"
                }`}
              >
                <span className="block text-sm text-ink font-medium">{a.label}</span>
                <span className="block text-[11px] text-ink-faint mt-0.5">{a.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">
            Gender
          </p>
          <div className="flex gap-2">
            {(["female", "male"] as VoiceGender[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => set({ gender: g })}
                className={`flex-1 py-2 rounded-xl text-sm capitalize transition ${
                  prefs.gender === g
                    ? "bg-accent text-[#041512] font-semibold"
                    : "bg-surface-soft border border-surface-border text-ink-muted"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">
            Tone · 10 styles
          </p>
          <div className="grid grid-cols-2 gap-2">
            {VOICE_TONES.map((tone) => (
              <button
                key={tone.id}
                type="button"
                onClick={() => set({ toneId: tone.id })}
                className={`text-left px-3 py-2 rounded-xl text-sm transition ${
                  prefs.toneId === tone.id
                    ? "bg-accent/20 border border-accent/50 text-ink font-medium"
                    : "bg-surface-soft border border-surface-border text-ink-muted hover:text-ink"
                }`}
              >
                {tone.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => previewTone(prefs)}
            disabled={!support.output}
            className="flex-1 py-2.5 rounded-xl bg-accent text-[#041512] text-sm font-semibold disabled:opacity-40"
          >
            Preview voice
          </button>
        </div>
      </div>
    </div>
  );
}
