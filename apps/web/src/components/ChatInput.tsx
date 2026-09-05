"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  containsWakePhrase,
  getSpeechRecognition,
  saveVoicePrefs,
  speechSupported,
  speakText,
  stripWakePhrase,
  type SpeechRecognitionLike,
  type VoicePrefs,
} from "@/lib/voice";

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
  voicePrefs: VoicePrefs;
  onVoicePrefsChange: (prefs: VoicePrefs) => void;
  onOpenVoiceSettings: () => void;
}

export function ChatInput({
  onSend,
  disabled,
  voicePrefs,
  onVoicePrefsChange,
  onOpenVoiceSettings,
}: Props) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [wakeActive, setWakeActive] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [canListen, setCanListen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const commandRecRef = useRef<SpeechRecognitionLike | null>(null);
  const wakeRecRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef("");
  const finalVoiceRef = useRef("");
  const onSendRef = useRef(onSend);
  const disabledRef = useRef(disabled);
  const prefsRef = useRef(voicePrefs);
  const listeningRef = useRef(false);
  const micBlockedRef = useRef(false);
  const restartWakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);
  useEffect(() => {
    prefsRef.current = voicePrefs;
  }, [voicePrefs]);
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    setCanListen(speechSupported().input);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const stopWake = useCallback(() => {
    if (restartWakeTimer.current) {
      clearTimeout(restartWakeTimer.current);
      restartWakeTimer.current = null;
    }
    try {
      wakeRecRef.current?.abort();
    } catch {
      // ignore
    }
    wakeRecRef.current = null;
    setWakeActive(false);
  }, []);

  const startCommandListening = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setMicError("Voice input not supported in this browser. Try Chrome.");
      return;
    }
    if (micBlockedRef.current) {
      setMicError("Microphone permission denied — allow mic in browser settings, then tap the mic again.");
      return;
    }

    stopWake();
    setMicError(null);
    baseTextRef.current = "";
    finalVoiceRef.current = "";

    const recognition = new Ctor();
    recognition.lang = prefsRef.current.lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    commandRecRef.current = recognition;

    recognition.onresult = (event) => {
      let interim = "";
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        const piece = result[0]?.transcript ?? "";
        if (result.isFinal) finalChunk += piece;
        else interim += piece;
      }
      if (finalChunk) {
        finalVoiceRef.current = `${finalVoiceRef.current}${finalChunk}`;
        baseTextRef.current = `${baseTextRef.current}${finalChunk}`.trimStart();
      }
      setText(`${baseTextRef.current}${interim}`.trimStart());
    };

    recognition.onerror = (ev) => {
      setListening(false);
      if (ev.error === "not-allowed") {
        micBlockedRef.current = true;
        setMicError("Microphone permission denied — allow mic in browser settings, then tap the mic again.");
        stopWake();
      } else if (ev.error !== "aborted" && ev.error !== "no-speech") {
        setMicError(`Mic error: ${ev.error}`);
      }
    };

    recognition.onend = () => {
      setListening(false);
      const spoken = stripWakePhrase(
        (finalVoiceRef.current || baseTextRef.current || "").trim(),
      );
      if (spoken && !disabledRef.current) {
        setText("");
        baseTextRef.current = "";
        finalVoiceRef.current = "";
        onSendRef.current(spoken);
      }
      // Resume wake word after command
      if (prefsRef.current.wakeWord && !disabledRef.current && !micBlockedRef.current) {
        restartWakeTimer.current = setTimeout(() => startWakeRef.current(), 600);
      }
    };

    try {
      recognition.start();
      setListening(true);
      if (prefsRef.current.autoSpeak) {
        speakText("Yes?", prefsRef.current);
      }
    } catch {
      setMicError("Could not start microphone");
      setListening(false);
    }
  }, [stopWake]);

  const startWakeRef = useRef<() => void>(() => undefined);

  const startWakeListening = useCallback(() => {
    if (
      !prefsRef.current.wakeWord ||
      disabledRef.current ||
      listeningRef.current ||
      micBlockedRef.current
    ) {
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;

    try {
      wakeRecRef.current?.abort();
    } catch {
      // ignore
    }

    const recognition = new Ctor();
    recognition.lang = prefsRef.current.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    wakeRecRef.current = recognition;

    recognition.onresult = (event) => {
      let chunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        chunk += event.results[i]?.[0]?.transcript ?? "";
      }
      if (!containsWakePhrase(chunk)) return;

      const after = stripWakePhrase(chunk);
      stopWake();
      if (after.length > 2) {
        setListening(false);
        if (!disabledRef.current) onSendRef.current(after);
        if (prefsRef.current.wakeWord) {
          restartWakeTimer.current = setTimeout(() => startWakeRef.current(), 800);
        }
      } else {
        startCommandListening();
      }
    };

    recognition.onerror = (ev) => {
      setWakeActive(false);
      if (ev.error === "not-allowed") {
        micBlockedRef.current = true;
        setMicError(
          "Microphone permission denied — allow mic in browser settings, then turn continuous off and on.",
        );
        stopWake();
        return;
      }
      if (prefsRef.current.wakeWord && ev.error !== "aborted" && !micBlockedRef.current) {
        restartWakeTimer.current = setTimeout(() => startWakeRef.current(), 2000);
      }
    };

    recognition.onend = () => {
      setWakeActive(false);
      if (
        prefsRef.current.wakeWord &&
        !listeningRef.current &&
        !disabledRef.current &&
        !micBlockedRef.current
      ) {
        restartWakeTimer.current = setTimeout(() => startWakeRef.current(), 1500);
      }
    };

    try {
      recognition.start();
      setWakeActive(true);
      setMicError(null);
    } catch {
      setWakeActive(false);
      if (!micBlockedRef.current) {
        restartWakeTimer.current = setTimeout(() => startWakeRef.current(), 2000);
      }
    }
  }, [startCommandListening, stopWake]);

  useEffect(() => {
    startWakeRef.current = startWakeListening;
  }, [startWakeListening]);

  useEffect(() => {
    if (voicePrefs.wakeWord && canListen && !disabled) {
      startWakeRef.current();
    } else {
      stopWake();
    }
    return () => stopWake();
  }, [voicePrefs.wakeWord, canListen, disabled, stopWake]);

  useEffect(() => {
    return () => {
      commandRecRef.current?.abort();
      stopWake();
    };
  }, [stopWake]);

  const submit = (value?: string) => {
    const trimmed = (value ?? text).trim();
    if (!trimmed || disabledRef.current) return;
    onSendRef.current(trimmed);
    setText("");
    baseTextRef.current = "";
    finalVoiceRef.current = "";
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const stopListening = () => {
    commandRecRef.current?.stop();
  };

  const toggleContinuous = () => {
    const enabling = !prefsRef.current.wakeWord;
    const next = { ...prefsRef.current, wakeWord: enabling };
    saveVoicePrefs(next);
    onVoicePrefsChange(next);
    if (enabling) {
      micBlockedRef.current = false;
      setMicError(null);
    } else {
      stopWake();
    }
  };

  const retryMic = () => {
    micBlockedRef.current = false;
    setMicError(null);
    if (voicePrefs.wakeWord) {
      startWakeRef.current();
    } else {
      startCommandListening();
    }
  };

  return (
    <div className="space-y-2">
      <div className="min-h-[1.125rem] px-1">
        {micError ? (
          <p className="text-[11px] text-danger leading-snug">
            {micError}{" "}
            <button
              type="button"
              onClick={retryMic}
              className="underline text-danger/90 hover:text-danger"
            >
              Retry
            </button>
          </p>
        ) : listening ? (
          <p className="text-[11px] text-accent-muted">Listening… pause when done — sends automatically</p>
        ) : voicePrefs.wakeWord ? (
          <p className="text-[11px] text-ink-faint">
            Continuous on — say <span className="text-accent-muted">“Hey Jarvis”</span>
          </p>
        ) : (
          <p className="text-[11px] text-ink-faint">Continuous off — tap mic, or enable continuous</p>
        )}
      </div>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (listening) {
            stopListening();
            return;
          }
          submit();
        }}
        className="flex items-end gap-2"
      >
        <button
          type="button"
          onClick={onOpenVoiceSettings}
          title="Voice settings"
          className="shrink-0 h-[46px] w-[46px] rounded-2xl border border-surface-border bg-surface-raised text-ink-muted hover:text-ink hover:border-accent/40 transition flex items-center justify-center"
        >
          <span className="text-sm font-semibold">♪</span>
        </button>

        <button
          type="button"
          onClick={toggleContinuous}
          title={
            voicePrefs.wakeWord
              ? "Disable continuous (Hey Jarvis)"
              : "Enable continuous (Hey Jarvis)"
          }
          className={`shrink-0 h-[46px] px-2.5 rounded-2xl border text-[10px] font-semibold uppercase tracking-wide transition ${
            voicePrefs.wakeWord
              ? "border-accent/50 bg-accent/15 text-accent-muted"
              : "border-surface-border bg-surface-raised text-ink-faint"
          }`}
        >
          {voicePrefs.wakeWord ? "On" : "Off"}
        </button>

        <button
          type="button"
          disabled={disabled || !canListen}
          onClick={() => {
            if (listening) {
              stopListening();
              return;
            }
            micBlockedRef.current = false;
            startCommandListening();
          }}
          title={canListen ? "Speak — or say Hey Jarvis" : "Voice input not supported"}
          className={`shrink-0 h-[46px] w-[46px] rounded-2xl border transition flex items-center justify-center disabled:opacity-40 ${
            listening
              ? "bg-danger/20 border-danger/50 text-danger ring-2 ring-danger/30"
              : wakeActive
                ? "border-accent/40 bg-accent/10 text-accent-muted ring-2 ring-accent/20"
                : "border-surface-border bg-surface-raised text-ink-muted hover:text-ink hover:border-accent/40"
          }`}
        >
          <MicIcon active={listening || wakeActive} />
        </button>

        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            listening
              ? "Speak now — auto send…"
              : wakeActive
                ? "Hey Jarvis… or type here"
                : "Ask, search, or speak…"
          }
          disabled={disabled}
          className="flex-1 resize-none bg-surface-raised border border-surface-border rounded-2xl px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/35 focus:border-accent/40 disabled:opacity-50 leading-relaxed max-h-[140px]"
        />
        <button
          type="submit"
          disabled={disabled || (!text.trim() && !listening)}
          className="shrink-0 h-[46px] px-4 rounded-2xl bg-accent hover:bg-accent-muted disabled:opacity-40 text-[#041512] text-sm font-semibold transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        fill={active ? "currentColor" : "none"}
      />
      <path
        d="M19 11a7 7 0 0 1-14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
