"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface DocItem {
  id: string;
  filename: string;
  status: string;
  sizeBytes: number;
  error?: string | null;
}

export function DocumentsView() {
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [filename, setFilename] = useState("notes.md");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/documents");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load documents");
        return;
      }
      setDocuments(data.documents ?? []);
    } catch {
      setError("Failed to load documents");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = async () => {
    if (!filename.trim() || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/documents", {
        method: "POST",
        body: JSON.stringify({
          filename,
          content,
          mimeType: "text/plain",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed");
      } else {
        setContent("");
        await refresh();
      }
    } catch {
      setError("Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await apiFetch(`/documents/${id}`, { method: "DELETE" });
    await refresh();
  };

  const statusIcon = (status: string) => {
    if (status === "indexed") return "✓ Indexed";
    if (status === "failed") return "✗ Failed";
    if (status === "processing") return "… Processing";
    return status;
  };

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4 text-sm">
      <section>
        <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">Documents</h2>
        <input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          className="w-full mb-2 bg-surface-raised border border-surface-border rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/30"
          placeholder="filename.md"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          placeholder="Paste document text…"
          className="w-full bg-surface-raised border border-surface-border rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <button
          onClick={() => void upload()}
          disabled={busy}
          className="mt-2 w-full py-2.5 rounded-xl bg-accent text-[#041512] font-semibold text-xs disabled:opacity-50"
        >
          Index Document
        </button>
        {error && <p className="text-danger text-xs mt-2">{error}</p>}
      </section>

      <section className="space-y-2">
        {documents.length === 0 && (
          <p className="text-ink-faint text-xs">No documents indexed.</p>
        )}
        {documents.map((d) => (
          <div
            key={d.id}
            className="bg-surface-raised border border-surface-border rounded-xl p-3 flex justify-between gap-2"
          >
            <div>
              <p className="font-medium text-ink">{d.filename}</p>
              <p
                className={`text-[10px] mt-1 ${
                  d.status === "indexed" ? "text-accent-muted" : "text-ink-faint"
                }`}
              >
                Status: {statusIcon(d.status)}
              </p>
              {d.error && <p className="text-danger text-[10px] mt-1">{d.error}</p>}
            </div>
            <button
              onClick={() => void remove(d.id)}
              className="text-xs text-danger shrink-0"
            >
              Delete
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
