import type { OrchestratorEvent } from "@/lib/types";

interface Props {
  events: OrchestratorEvent[];
  loading: boolean;
}

function shortLabel(label: string): string {
  const trimmed = label.trim();
  if (/model unavailable|weights not loaded/i.test(trimmed)) {
    return "Model weights not loaded";
  }
  if (trimmed.length > 90) return `${trimmed.slice(0, 87)}…`;
  return trimmed;
}

export function StatusBar({ events, loading }: Props) {
  if (!loading && events.length === 0) return null;

  const modelBlocked = events.some((e) =>
    /model unavailable|weights not loaded|Orchestrate needs/i.test(e.label),
  );

  if (modelBlocked && !loading) {
    return (
      <div className="px-4 py-2.5 border-b border-surface-border/80">
        <div className="rounded-xl border border-warn/30 bg-warn/10 px-3 py-2.5">
          <p className="text-xs font-medium text-warn">Model weights not loaded</p>
          <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">
            Full planner needs Bharath weights — website / Project O bootstrap may still work via tools.
          </p>
        </div>
      </div>
    );
  }

  const failed = events.filter((e) => e.status === "failed");
  const done = events.filter((e) => e.status === "done");
  const uniqueLabels = Array.from(
    new Map(events.map((e) => [`${e.status}:${shortLabel(e.label)}`, e])).values(),
  ).slice(0, 5);

  return (
    <div className="px-4 py-2.5 border-b border-surface-border/80 bg-surface-raised/50 space-y-2">
      {loading && events.length === 0 && (
        <p className="text-xs text-accent-muted animate-pulse">Planning…</p>
      )}

      {events.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="uppercase tracking-[0.12em] text-ink-faint font-semibold">Run</span>
          <span className="text-accent-muted">{done.length} ok</span>
          {failed.length > 0 && <span className="text-danger">{failed.length} failed</span>}
          {loading && <span className="text-ink-faint animate-pulse">working…</span>}
        </div>
      )}

      <div className="space-y-1 max-h-24 overflow-y-auto scrollbar-thin">
        {uniqueLabels.map((event, i) => (
          <div key={`${event.label}-${i}`} className="flex items-start gap-2 text-xs">
            <span
              className={`mt-0.5 shrink-0 ${
                event.status === "done"
                  ? "text-accent-muted"
                  : event.status === "failed"
                    ? "text-danger"
                    : "text-ink-faint"
              }`}
            >
              {event.status === "done" ? "✓" : event.status === "failed" ? "✗" : "○"}
            </span>
            <span className="text-ink-muted leading-snug">{shortLabel(event.label)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
