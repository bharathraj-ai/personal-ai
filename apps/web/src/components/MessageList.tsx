"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/types";
import { MessageContent } from "./MessageContent";

interface Props {
  messages: ChatMessage[];
  loading: boolean;
  onSuggestion?: (text: string) => void;
  emptyTitle?: string;
  emptyHint?: string;
  suggestions?: string[];
  assistantBadge?: string;
}

const DEFAULT_SUGGESTIONS = [
  "how's my laptop",
  "create folder notes in downloads",
  "ind vs wi score",
];

export function MessageList({
  messages,
  loading,
  onSuggestion,
  emptyTitle = "Personal AI",
  emptyHint = "Bharath is the brain. Ask questions, search the web, or manage files on your laptop.",
  suggestions = DEFAULT_SUGGESTIONS,
  assistantBadge = "AI",
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4">
      {messages.length === 0 && (
        <div className="mt-10 animate-fade-up text-center px-2">
          <p className="font-display text-3xl text-ink tracking-tight">{emptyTitle}</p>
          <p className="mt-2 text-sm text-ink-muted max-w-xs mx-auto leading-relaxed">{emptyHint}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSuggestion?.(s)}
                className="text-left text-xs text-ink-muted border border-surface-border bg-surface-raised/70 hover:border-accent/40 hover:text-ink rounded-full px-3 py-2 transition"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex animate-fade-up ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          {msg.role === "assistant" && (
            <div className="mr-2 mt-1 h-7 w-7 shrink-0 rounded-full bg-accent/15 border border-accent/25 flex items-center justify-center text-[10px] font-semibold text-accent-muted">
              {assistantBadge}
            </div>
          )}
          <div
            className={`max-w-[88%] rounded-2xl px-3.5 py-3 text-sm ${
              msg.role === "user"
                ? "bg-accent text-[#041512] font-medium rounded-br-md shadow-glow"
                : "bg-surface-raised/90 border border-surface-border rounded-bl-md backdrop-blur-sm"
            }`}
          >
            <MessageContent
              content={msg.content}
              role={msg.role}
              verification={msg.verification}
            />
          </div>
        </div>
      ))}

      {loading && messages[messages.length - 1]?.role === "user" && (
        <div className="flex items-center gap-2 text-ink-faint text-xs pl-9">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
          Thinking…
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
