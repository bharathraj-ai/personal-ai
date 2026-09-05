"use client";

import { useEffect, useState } from "react";
import type { SystemStatus } from "@/lib/types";
import { apiFetch } from "@/lib/api";

interface LaptopStats {
  hostname: string;
  platform: string;
  arch: string;
  uptime: string;
  cpu: { model: string; cores: number; load1: number; load5: number; load15: number };
  memory: { total: string; used: string; free: string; usedPercent: number };
  battery: { percent: number | null; status: string | null; present: boolean };
  disks: Array<{
    mount: string;
    size: string;
    used: string;
    avail: string;
    usePercent: string;
  }>;
  fans: Array<{ name: string; rpm: number }>;
  temps: Array<{ name: string; celsius: number }>;
}

export function StatusView() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [laptop, setLaptop] = useState<LaptopStats | null>(null);
  const [providers, setProviders] = useState<{
    ownModel: { name: string };
    specialists: unknown[];
    keys?: Record<
      string,
      {
        available?: boolean;
        healthyKeys?: number;
        cooldownKeys?: number;
        invalidKeys?: number;
        totalKeys?: number;
        reason?: string;
      }
    >;
    events?: Array<{ event?: string; from?: string; to?: string; reason?: string }>;
  } | null>(null);

  const refreshLaptop = () => {
    apiFetch("/system/laptop")
      .then((r) => r.json())
      .then(setLaptop)
      .catch(() => setLaptop(null));
  };

  useEffect(() => {
    Promise.all([
      apiFetch("/system/status").then((r) => r.json()),
      apiFetch("/providers").then((r) => r.json()),
    ]).then(([s, p]) => {
      setStatus(s);
      setProviders(p);
    });
    refreshLaptop();
    const id = setInterval(refreshLaptop, 15_000);
    return () => clearInterval(id);
  }, []);

  if (!status) {
    return <div className="p-4 text-sm text-ink-faint">Loading system status...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-6 text-sm">
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold">
            This laptop
          </h2>
          <button
            type="button"
            onClick={refreshLaptop}
            className="text-[11px] text-accent-muted hover:text-ink"
          >
            Refresh
          </button>
        </div>
        {laptop ? (
          <div className="bg-surface-raised border border-surface-border rounded-xl p-3 space-y-2">
            <p className="font-medium text-ink">{laptop.hostname}</p>
            <p className="text-[11px] text-ink-faint">
              {laptop.platform} · {laptop.arch} · up {laptop.uptime}
            </p>
            <Row
              label="Battery"
              value={
                laptop.battery.present
                  ? `${laptop.battery.percent ?? "?"}% · ${laptop.battery.status ?? "?"}`
                  : "Not detected"
              }
            />
            <Row
              label="Memory"
              value={`${laptop.memory.used} / ${laptop.memory.total} (${laptop.memory.usedPercent}%)`}
            />
            <Row
              label="CPU"
              value={`${laptop.cpu.cores} cores · load ${laptop.cpu.load1}`}
            />
            {laptop.fans.length > 0 && (
              <Row
                label="Fans"
                value={laptop.fans.map((f) => `${f.rpm} RPM`).join(" · ")}
              />
            )}
            {laptop.temps[0] && (
              <Row label="Temp" value={`${laptop.temps[0].celsius}°C (${laptop.temps[0].name})`} />
            )}
            {laptop.disks.slice(0, 3).map((d) => (
              <Row
                key={d.mount}
                label={d.mount === "/" ? "Disk /" : d.mount}
                value={`${d.used}/${d.size} (${d.usePercent}) free ${d.avail}`}
              />
            ))}
          </div>
        ) : (
          <p className="text-ink-faint text-xs">Laptop sensors unavailable</p>
        )}
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">
          Own Model
        </h2>
        <div className="bg-surface-raised border border-surface-border rounded-xl p-3">
          <p className="font-medium">{status.model.name}</p>
          <p
            className={
              status.model.state === "LOADED" || status.model.ready
                ? "text-accent-muted"
                : "text-warn"
            }
          >
            {status.model.state ??
              (status.model.modelLoaded === false
                ? "NOT_LOADED"
                : status.model.healthy
                  ? "LOADED"
                  : "UNAVAILABLE")}
          </p>
          {status.model.message && <p className="text-ink-faint mt-1">{status.model.message}</p>}
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">
          Workspace
        </h2>
        <div className="bg-surface-raised border border-surface-border rounded-xl p-3 space-y-1">
          <p className="text-ink-muted">
            Kind: {status.workspace?.kind ?? (status.phases.localWorkspace ? "LOCAL" : "CLOUD")}
          </p>
          <p className="text-ink-muted">
            Provider:{" "}
            {status.workspace?.provider?.toUpperCase() ??
              String(status.phases.workspaceProvider ?? status.phases.sandboxProvider ?? "?")}
          </p>
          <p className="text-ink-faint text-[11px]">
            {status.workspace?.isolation ??
              "path-boundary-only (LOCAL WORKSPACE ≠ CLOUD SANDBOX)"}
          </p>
          {status.phases.cloudSandbox === true ? (
            <p className="text-warn text-[11px]">cloudSandbox reported true</p>
          ) : (
            <p className="text-ink-faint text-[11px]">cloudSandbox=false</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">
          S3 Storage
        </h2>
        <div className="bg-surface-raised border border-surface-border rounded-xl p-3">
          <p
            className={
              status.s3?.state === "CONNECTED"
                ? "text-accent-muted"
                : status.s3?.state === "NOT_CONFIGURED"
                  ? "text-ink-faint"
                  : "text-warn"
            }
          >
            {status.s3?.state ?? status.phases.s3 ?? "NOT_CONFIGURED"}
          </p>
          {status.s3?.bucket && (
            <p className="text-ink-faint text-[11px] mt-1">Bucket: {status.s3.bucket}</p>
          )}
          {status.s3?.message && (
            <p className="text-ink-faint text-[11px] mt-1">{status.s3.message}</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">
          System Phases
        </h2>
        <div className="space-y-1.5">
          {Object.entries(status.phases).map(([key, value]) => {
            const isBool = typeof value === "boolean";
            const ok = isBool ? value : Boolean(value);
            return (
              <div key={key} className="flex items-center gap-2">
                <span className={ok ? "text-accent-muted" : "text-ink-faint"}>
                  {isBool ? (ok ? "✓" : "○") : "·"}
                </span>
                <span className="text-ink-muted capitalize">
                  {key.replace(/([A-Z])/g, " $1")}
                  {!isBool ? `: ${String(value)}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {providers && (
        <section>
          <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">
            Providers
          </h2>
          <p className="text-ink-muted">{providers.ownModel.name} (primary)</p>
          {providers.specialists.length === 0 ? (
            <p className="text-ink-faint mt-1">No specialist providers configured</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {providers.specialists.map((s) => {
                const item = s as {
                  id?: string;
                  provider?: string;
                  name?: string;
                  type?: string;
                  enabled?: boolean;
                  available?: boolean;
                  healthy?: boolean;
                  model?: string;
                  capabilities?: string[];
                };
                const pid = item.provider ?? item.id ?? "";
                const keyState = pid ? providers.keys?.[pid] : undefined;
                const healthy = keyState?.healthyKeys;
                const total = keyState?.totalKeys;
                const cooldown = keyState?.cooldownKeys;
                const invalid = keyState?.invalidKeys;
                const reason = keyState?.reason;
                return (
                  <li key={pid || item.name} className="text-ink-muted text-sm">
                    <span className="text-accent-muted">○</span>{" "}
                    {item.name ?? pid}
                    {item.model ? (
                      <span className="text-ink-faint"> · {item.model}</span>
                    ) : null}
                    {typeof healthy === "number" ? (
                      <span className="text-ink-faint">
                        {" "}
                        · healthy {healthy}/{total ?? healthy}
                        {cooldown ? ` · cooldown ${cooldown}` : ""}
                        {invalid ? ` · invalid ${invalid}` : ""}
                      </span>
                    ) : null}
                    {item.healthy === false ? (
                      <span className="text-warn"> · unhealthy</span>
                    ) : null}
                    {reason ? <span className="text-warn"> · {reason}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
          {providers.events && providers.events.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-[11px] text-ink-faint">
              {providers.events.slice(0, 6).map((e, i) => (
                <li key={`${e.event}-${i}`}>
                  {e.event}
                  {e.from && e.to ? ` ${e.from} → ${e.to}` : ""}
                  {e.reason ? ` (${e.reason})` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}

      <section>
        <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">
          Last search
        </h2>
        {status.lastSearch?.original_query ? (
          <div className="bg-surface-raised border border-surface-border rounded-xl p-3 space-y-1 text-xs">
            <Row label="Original" value={status.lastSearch.original_query} />
            <Row label="Intent" value={status.lastSearch.detected_intent ?? "—"} />
            <Row label="Entity" value={status.lastSearch.resolved_entity ?? "—"} />
            <Row label="Relation" value={status.lastSearch.relationship ?? "—"} />
            <Row
              label="Search"
              value={(status.lastSearch.generated_queries ?? []).join(" · ") || "—"}
            />
            <Row label="Confidence" value={(status.lastSearch.confidence ?? "—").toUpperCase()} />
            <Row label="Analyzer" value={status.lastSearch.analyzer ?? "search-intent"} />
            {typeof status.lastSearch.evidence_count === "number" && (
              <Row label="Evidence" value={String(status.lastSearch.evidence_count)} />
            )}
          </div>
        ) : (
          <p className="text-ink-faint text-xs">No search ran in this session yet</p>
        )}
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">
          Knowledge Layer
        </h2>
        <p className="text-ink-muted">Embeddings: {status.embeddingProvider ?? "unknown"}</p>
        <p className="text-ink-muted mt-1">
          Postgres: {status.phases.postgres ? "healthy" : "offline / in-memory"}
        </p>
        <p className="text-ink-muted mt-1">
          pgvector: {status.phases.pgvector ? "enabled" : "unavailable"}
        </p>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-ink-faint w-16 shrink-0">{label}</span>
      <span className="text-ink-muted break-all">{value}</span>
    </div>
  );
}
