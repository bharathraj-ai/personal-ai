"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface WorkspaceItem {
  id: string;
  projectName: string;
  expiresAt: string;
  status: string;
  sandboxProvider: string;
  createdAt: string;
}

interface Props {
  onActivated?: (id: string) => void;
}

export function WorkspacesView({ onActivated }: Props) {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("my-project");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/workspaces");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load workspaces");
        return;
      }
      setWorkspaces(data.workspaces ?? []);
      setActiveId(data.activeWorkspaceId ?? null);
    } catch {
      setError("Failed to load workspaces");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/workspaces", {
        method: "POST",
        body: JSON.stringify({ projectName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create workspace");
        return;
      }
      setActiveId(data.id);
      onActivated?.(data.id);
      await refresh();
    } catch {
      setError("Failed to create workspace");
    } finally {
      setBusy(false);
    }
  };

  const activate = async (id: string) => {
    await apiFetch(`/workspaces/${id}/activate`, { method: "POST" });
    setActiveId(id);
    onActivated?.(id);
    await refresh();
  };

  const destroy = async (id: string) => {
    if (!confirm("Delete this workspace permanently?")) return;
    await apiFetch(`/workspaces/${id}`, { method: "DELETE" });
    await refresh();
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-sm">
      <section>
        <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">New Workspace</h2>
        <div className="flex gap-2">
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="flex-1 bg-surface-raised border border-surface-border rounded-xl px-3 py-2 text-sm"
            placeholder="Project name"
          />
          <button
            onClick={() => void create()}
            disabled={busy}
            className="bg-accent text-[#041512] font-semibold rounded-xl px-4 py-2 text-sm disabled:opacity-50"
          >
            Create
          </button>
        </div>
        <p className="text-ink-faint text-xs mt-2">
          Local self-hosted workspace (path boundary only — not a cloud sandbox). ~30 day expiry.
        </p>
      </section>

      {error && <p className="text-danger text-xs">{error}</p>}

      <section>
        <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">Workspaces</h2>
        {workspaces.length === 0 && (
          <p className="text-ink-faint">No workspaces yet. Create one to enable coding tools.</p>
        )}
        <div className="space-y-2">
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              className={`border rounded-xl p-3 ${
                activeId === ws.id
                  ? "border-accent bg-accent/10"
                  : "border-surface-border bg-surface-raised"
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="font-medium">{ws.projectName}</p>
                  <p className="text-ink-faint text-xs mt-0.5">
                    {ws.status} · {ws.sandboxProvider} · expires{" "}
                    {new Date(ws.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-1 text-xs">
                  {activeId !== ws.id && ws.status === "active" && (
                    <button
                      onClick={() => void activate(ws.id)}
                      className="px-2 py-1 rounded bg-surface border border-surface-border"
                    >
                      Use
                    </button>
                  )}
                  <button
                    onClick={() => void destroy(ws.id)}
                    className="px-2 py-1 rounded text-danger border border-surface-border"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {activeId === ws.id && (
                <p className="text-accent-muted text-xs mt-2">Active — orchestrate will use this workspace</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
