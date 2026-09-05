"use client";

import { useEffect, useState } from "react";
import type { ApiRequirementItem, SystemStatus } from "@/lib/types";
import { apiFetch } from "@/lib/api";

interface Props {
  apiRequirements?: ApiRequirementItem[];
}

export function SystemPanel({ apiRequirements = [] }: Props) {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    const load = () =>
      apiFetch("/system/status")
        .then((r) => r.json())
        .then(setStatus)
        .catch(() => setStatus(null));
    load();
    const id = setInterval(load, 8_000);
    return () => clearInterval(id);
  }, []);

  if (!status && apiRequirements.length === 0) return null;

  const modelOk = status?.model.healthy;
  const weightsMissing = /not loaded|weights/i.test(status?.model.message ?? "");

  return (
    <div className="px-4 py-2.5 border-b border-surface-border/80 space-y-2">
      {status && (
        <div className="flex items-start gap-2.5 rounded-xl bg-surface-raised/60 border border-surface-border px-3 py-2">
          <span
            className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
              modelOk ? (weightsMissing ? "bg-warn" : "bg-accent") : "bg-danger"
            }`}
          />
          <div className="min-w-0">
            <p className="text-xs text-ink font-medium truncate">{status.model.name}</p>
            <p className="text-[11px] text-ink-faint leading-snug">
              {weightsMissing
                ? "Model weights not loaded — web search & laptop status still work"
                : status.model.message || (modelOk ? "Ready" : "Unavailable")}
            </p>
          </div>
        </div>
      )}

      {apiRequirements.some((item) => !item.connected) && (
        <div className="rounded-xl border border-surface-border bg-surface-raised/40 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-ink-faint mb-1.5">APIs needed</p>
          <div className="space-y-1">
            {apiRequirements
              .filter((item) => !item.connected)
              .map((item) => (
                <div key={item.id} className="flex items-center gap-2 text-xs">
                  <span className="text-ink-faint">○</span>
                  <span className="text-ink-muted">{item.name}</span>
                </div>
              ))}
          </div>
        </div>
      )}

          {status && status.pendingApprovals > 0 && (
        <p className="text-[11px] text-warn px-1">
          {status.pendingApprovals} approval{status.pendingApprovals > 1 ? "s" : ""} pending
        </p>
      )}

      {status?.lastSearch?.original_query && (
        <div className="rounded-xl border border-surface-border bg-surface-raised/40 px-3 py-2 space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-ink-faint">Last search</p>
          <p className="text-[11px] text-ink-muted truncate">
            {status.lastSearch.detected_intent}
            {status.lastSearch.resolved_entity ? ` · ${status.lastSearch.resolved_entity}` : ""}
          </p>
          <p className="text-[11px] text-ink-faint truncate">
            {(status.lastSearch.generated_queries ?? [])[0] ?? status.lastSearch.original_query}
          </p>
          <p className="text-[11px] text-ink-faint">
            {(status.lastSearch.confidence ?? "").toUpperCase()} · {status.lastSearch.analyzer}
          </p>
        </div>
      )}
    </div>
  );
}
