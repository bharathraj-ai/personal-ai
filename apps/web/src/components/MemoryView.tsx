"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface MemoryItem {
  id: string;
  content: string;
  memoryType: string;
  importance: number;
  projectId?: string | null;
}

export function MemoryView() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/memory");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load memories");
        return;
      }
      setMemories(data.memories ?? []);
      setError(null);
    } catch {
      setError("Failed to load memories");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async () => {
    if (!content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/memory", {
        method: "POST",
        body: JSON.stringify({ content, memoryType: "preference" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save");
      } else {
        setContent("");
        await refresh();
      }
    } catch {
      setError("Failed to save memory");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await apiFetch(`/memory/${id}`, { method: "DELETE" });
    await refresh();
  };

  const clearAll = async () => {
    if (!confirm("Clear all personal memory? This cannot be undone.")) return;
    await apiFetch("/memory?confirm=yes", { method: "DELETE" });
    await refresh();
  };

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4 text-sm">
      <section>
        <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">Personal Memory</h2>
        <p className="text-ink-muted text-xs mb-3 leading-relaxed">
          Preferences and facts used as context. Secrets are never stored.
        </p>
        <div className="flex gap-2">
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="I prefer TypeScript…"
            className="flex-1 bg-surface-raised border border-surface-border rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <button
            onClick={() => void add()}
            disabled={busy}
            className="px-3.5 py-2.5 rounded-xl bg-accent text-[#041512] font-semibold text-xs disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {error && <p className="text-danger text-xs mt-2">{error}</p>}
      </section>

      <section className="space-y-2">
        {memories.length === 0 && (
          <p className="text-ink-faint text-xs">No memories yet.</p>
        )}
        {memories.map((m) => (
          <div
            key={m.id}
            className="bg-surface-raised border border-surface-border rounded-xl p-3 flex justify-between gap-2"
          >
            <div>
              <p className="text-ink">{m.content}</p>
              <p className="text-[10px] text-ink-faint mt-1 capitalize">
                {m.memoryType}
                {m.projectId ? " · project" : ""}
              </p>
            </div>
            <button
              onClick={() => void remove(m.id)}
              className="text-xs text-danger shrink-0 self-start"
            >
              Delete
            </button>
          </div>
        ))}
      </section>

      {memories.length > 0 && (
        <button
          onClick={() => void clearAll()}
          className="w-full py-2 text-xs text-danger border border-red-900/50 rounded-lg"
        >
          Clear All Memory
        </button>
      )}
    </div>
  );
}
