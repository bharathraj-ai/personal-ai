"use client";

import type { ReactNode } from "react";
import type { MessageVerification } from "@/lib/types";
import { isRenderLeakContent, normalizeAssistantContent } from "@/lib/message-content";

export { isRenderLeakContent } from "@/lib/message-content";

interface SourceItem {
  index: number;
  title: string;
  snippet?: string;
  url?: string;
}

function parseWebSearch(content: string): {
  query?: string;
  provider?: string;
  sources: SourceItem[];
  answer?: string;
  footer?: string;
} | null {
  if (!content.includes("Web search for")) return null;

  const queryMatch = /Web search for [“"](.+?)[”"]\s*\(([^)]+)\)/i.exec(content);
  const footerMatch = /\(Live web results[\s\S]*$/i.exec(content);
  const sources: SourceItem[] = [];

  const sourceBlock = content.split(/Sources:\s*/i)[1] ?? "";
  const body = sourceBlock.replace(/\(Live web results[\s\S]*$/i, "");

  const itemRe =
    /(\d+)\.\s+(.+?)\n(?:\s{2,}(.+?)\n)?(?:\s{2,}(https?:\/\/\S+))?/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(body)) !== null) {
    const maybeUrl = m[3]?.startsWith("http") ? m[3] : m[4];
    const snippet = m[3]?.startsWith("http") ? undefined : m[3];
    sources.push({
      index: Number(m[1]),
      title: m[2].trim(),
      snippet: snippet?.trim(),
      url: maybeUrl?.trim(),
    });
  }

  if (sources.length === 0) {
    const urls = content.match(/https?:\/\/\S+/g) ?? [];
    urls.slice(0, 6).forEach((url, i) => {
      sources.push({ index: i + 1, title: url.replace(/^https?:\/\//, "").slice(0, 60), url });
    });
  }

  const answerPart = content
    .replace(/Web search for[\s\S]*?:/, "")
    .split(/Sources:/i)[0]
    ?.trim();

  return {
    query: queryMatch?.[1],
    provider: queryMatch?.[2],
    sources,
    answer: answerPart && answerPart.length > 8 ? answerPart : undefined,
    footer: footerMatch?.[0],
  };
}

function linkifyPath(content: string) {
  return content.split(/(\/[^\s]+)/g).map((part, i) => {
    if (part.startsWith("/home/") || part.startsWith("/Users/")) {
      return (
        <code
          key={i}
          className="font-mono text-[12px] text-accent-muted bg-surface-soft px-1.5 py-0.5 rounded"
        >
          {part}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function parseVerificationFooter(content: string): MessageVerification | undefined {
  const m =
    /Verification:\s*(verified|uncertain|failed|not_verified)\.?\s*(.*)$/im.exec(content);
  if (!m) return undefined;
  return {
    status: m[1] as MessageVerification["status"],
    reason: m[2]?.trim() || undefined,
  };
}

function SourceChips({ verification }: { verification: MessageVerification }) {
  const sources = (verification.sources ?? [])
    .filter((s) => s.url || s.title)
    .slice(0, 6);

  if (sources.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint font-semibold">
        Sources
      </p>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s, i) => (
          <a
            key={`${s.url ?? s.title}-${i}`}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className={`rounded-lg border border-surface-border bg-surface-soft/60 px-2 py-1 text-[11px] text-ink max-w-full truncate ${
              s.url ? "hover:border-accent/40" : "pointer-events-none"
            }`}
            title={s.url ?? s.title}
          >
            {s.title || s.url?.replace(/^https?:\/\//, "")}
          </a>
        ))}
      </div>
    </div>
  );
}

function VerificationBadge({ verification }: { verification: MessageVerification }) {
  const showVerified = verification.status === "verified";
  const showFailed = verification.status === "failed";
  if (!showVerified && !showFailed) return null;

  return (
    <div className="space-y-2">
      {showVerified && (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent-muted">
          Verified from sources
        </div>
      )}
      {showFailed && (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-danger">
          Could not verify
        </div>
      )}
    </div>
  );
}

export function MessageContent({
  content,
  role,
  verification,
}: {
  content: string;
  role: "user" | "assistant";
  verification?: MessageVerification;
}) {
  if (role === "user") {
    return <span className="whitespace-pre-wrap break-words">{content}</span>;
  }

  const raw = typeof content === "string" ? content : "";
  if (!raw.trim()) {
    const hasSources = (verification?.sources?.length ?? 0) > 0;
    return (
      <div className="space-y-3">
        <span className="text-ink-muted text-sm">
          {hasSources
            ? "I found sources but couldn’t generate an answer. Please try again."
            : "…"}
        </span>
        {verification && <SourceChips verification={verification} />}
      </div>
    );
  }

  if (isRenderLeakContent(raw)) {
    return (
      <div className="space-y-3">
        <p className="text-ink-muted text-sm">
          I couldn’t produce a clear answer for that. Please try again.
        </p>
        {verification && <SourceChips verification={verification} />}
      </div>
    );
  }

  // Success / local action
  if (/^Created (folder|file)/i.test(raw) || /^Deleted /i.test(raw)) {
    const isDelete = /^Deleted /i.test(raw);
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
              isDelete ? "bg-danger/20 text-danger" : "bg-accent/20 text-accent-muted"
            }`}
          >
            {isDelete ? "–" : "✓"}
          </span>
          <p className="font-medium text-ink">{raw.split("\n")[0]}</p>
        </div>
        {raw.includes("\n") && (
          <pre className="font-mono text-[12px] text-ink-muted bg-surface-soft/80 rounded-xl px-3 py-2 overflow-x-auto whitespace-pre-wrap">
            {raw.split("\n").slice(1).join("\n").trim()}
          </pre>
        )}
      </div>
    );
  }

  if (/^Laptop status/i.test(raw)) {
    return (
      <div className="space-y-2">
        <p className="text-warn text-xs font-semibold tracking-[0.12em] uppercase">Laptop</p>
        <pre className="font-mono text-[12px] text-ink-muted whitespace-pre-wrap leading-relaxed">
          {raw}
        </pre>
      </div>
    );
  }

  if (/Orchestrate needs Bharath model weights/i.test(raw)) {
    return (
      <div className="space-y-2">
        <p className="text-warn text-xs font-semibold tracking-[0.12em] uppercase">Orchestrate unavailable</p>
        <p className="text-ink leading-relaxed">
          Bharath weights aren’t loaded, so full multi-step planning can’t run for this request.
        </p>
        <p className="text-sm text-ink-muted leading-relaxed">
          Coding bootstrap still works for <span className="text-accent-muted font-medium">websites</span>,{" "}
          <span className="text-accent-muted font-medium">Project O</span>, and similar tool tasks — or switch to{" "}
          <span className="text-accent-muted font-medium">Chat</span> for search. Load weights under{" "}
          <code className="font-mono text-[12px] text-accent-muted">Documents/model</code> for full planning.
        </p>
      </div>
    );
  }

  if (/\[Model not loaded\]/i.test(raw)) {
    return (
      <div className="space-y-1.5">
        <p className="text-warn text-xs font-semibold tracking-[0.12em] uppercase">Model not loaded</p>
        <p className="text-sm text-ink-muted leading-relaxed">
          Bharath is running, but weights aren’t loaded. Use Chat for search and local files.
        </p>
      </div>
    );
  }

  if (/^Error:/i.test(raw)) {
    return (
      <div className="space-y-1">
        <p className="text-warn text-xs font-medium tracking-wide uppercase">Notice</p>
        <p className="text-ink-muted whitespace-pre-wrap break-words">{raw}</p>
      </div>
    );
  }

  const resolvedVerification = verification ?? parseVerificationFooter(raw);
  const displayContent = normalizeAssistantContent(raw);

  if (!displayContent || isRenderLeakContent(displayContent)) {
    return (
      <div className="space-y-3">
        <p className="text-ink-muted text-sm">
          I couldn’t produce a clear answer for that. Please try again.
        </p>
        {resolvedVerification && <SourceChips verification={resolvedVerification} />}
      </div>
    );
  }

  let answerBody: ReactNode;
  if (/^I couldn't verify this information from the available sources\.?$/i.test(displayContent.trim())) {
    answerBody = (
      <p className="text-ink leading-relaxed">
        I couldn&apos;t verify this information from the available sources.
      </p>
    );
  } else {
    const search = parseWebSearch(displayContent);
    if (search) {
      answerBody = (
        <div className="space-y-3">
          {search.answer ? (
            <p className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap">
              {search.answer}
            </p>
          ) : (
            <p className="text-sm text-ink-muted">
              Results for {search.query ? `“${search.query}”` : "your query"}
            </p>
          )}
          {search.sources.length > 0 && !resolvedVerification?.sources?.length && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint font-semibold">
                Sources
              </p>
              {search.sources.map((s) => (
                <a
                  key={`${s.index}-${s.url ?? s.title}`}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`block rounded-xl border border-surface-border bg-surface-soft/60 px-3 py-2.5 transition ${
                    s.url ? "hover:border-accent/40 hover:bg-surface-soft" : "pointer-events-none"
                  }`}
                >
                  <p className="text-sm text-ink font-medium leading-snug">
                    <span className="text-ink-faint mr-1.5">{s.index}.</span>
                    {s.title}
                  </p>
                  {s.snippet && (
                    <p className="mt-1 text-xs text-ink-muted line-clamp-2">{s.snippet}</p>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      );
    } else {
      answerBody = (
        <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
          {linkifyPath(displayContent)}
        </div>
      );
    }
  }

  // Answer first, then status badge, then sources underneath.
  return (
    <div className="space-y-3">
      {answerBody}
      {resolvedVerification && <VerificationBadge verification={resolvedVerification} />}
      {resolvedVerification && <SourceChips verification={resolvedVerification} />}
    </div>
  );
}
