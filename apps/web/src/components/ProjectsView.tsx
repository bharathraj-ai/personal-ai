"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { ProjectProgressPanel, type ProjectProgressData } from "@/components/ProjectProgressPanel";

interface ProjectItem {
  id: string;
  name: string;
  description?: string | null;
  workspaceId?: string | null;
}

interface ProjectDetail {
  project: ProjectItem;
  memories: Array<{ id: string; content: string }>;
  documents: Array<{ id: string; filename: string; status: string }>;
}

interface Props {
  onSelectProject?: (projectId: string | undefined) => void;
  activeProjectId?: string;
  workspaceId?: string;
}

export function ProjectsView({ onSelectProject, activeProjectId, workspaceId }: Props) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planProgress, setPlanProgress] = useState<ProjectProgressData | undefined>();

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/projects");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load projects");
        return;
      }
      setProjects(data.projects ?? []);
    } catch {
      setError("Failed to load projects");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: description || undefined,
          workspaceId: workspaceId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Create failed");
      } else {
        setName("");
        setDescription("");
        onSelectProject?.(data.id);
        await refresh();
        await openDetail(data.id);
      }
    } catch {
      setError("Create failed");
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (id: string) => {
    const res = await apiFetch(`/projects/${id}`);
    const data = await res.json();
    if (res.ok) {
      setDetail(data);
      onSelectProject?.(id);
      await apiFetch("/context", {
        method: "POST",
        body: JSON.stringify({ projectId: id }),
      });
      setPlanProgress(undefined);
      const planRes = await apiFetch(`/projects/${id}/plan`);
      if (planRes.ok) {
        const planData = await planRes.json();
        const comp = planData.completeness as {
          status?: string;
          counts?: ProjectProgressData["counts"];
          storage?: string[];
        } | null;
        if (comp || planData.plan) {
          setPlanProgress({
            projectName: planData.plan?.project?.name ?? data.project.name,
            status: planData.projectStatus ?? comp?.status ?? "PARTIAL",
            workspaceId: planData.workspaceId ?? undefined,
            counts: comp?.counts,
            modules: planData.plan?.modules?.map(
              (m: { id: string; name: string; status?: string }) => ({
                id: m.id,
                name: m.name,
                status: m.status,
              }),
            ),
            testStatus: comp?.counts?.tests
              ? `${comp.counts.tests.passed}/${comp.counts.tests.total}`
              : undefined,
            storage: comp?.storage?.join(" / ") ?? planData.storageRefs?.join(" / "),
          });
        }
      }
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this project?")) return;
    await apiFetch(`/projects/${id}`, { method: "DELETE" });
    if (activeProjectId === id) onSelectProject?.(undefined);
    setDetail(null);
    await refresh();
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-sm">
      <section>
        <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">New Project</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
          className="w-full mb-2 bg-surface-raised border border-surface-border rounded-lg px-3 py-2"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="w-full mb-2 bg-surface-raised border border-surface-border rounded-lg px-3 py-2"
        />
        <button
          onClick={() => void create()}
          disabled={busy}
          className="w-full py-2 rounded-lg bg-accent text-[#041512] font-semibold text-xs disabled:opacity-50"
        >
          Create Project
        </button>
        {error && <p className="text-danger text-xs mt-2">{error}</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-[0.14em] text-ink-faint font-semibold mb-2">Projects</h2>
        {projects.length === 0 && (
          <p className="text-ink-faint text-xs">No knowledge projects yet.</p>
        )}
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => void openDetail(p.id)}
            className={`w-full text-left bg-surface-raised border rounded-xl p-3 ${
              activeProjectId === p.id ? "border-accent" : "border-surface-border"
            }`}
          >
            <p className="font-medium">{p.name}</p>
            {p.description && (
              <p className="text-ink-faint text-xs mt-1">{p.description}</p>
            )}
            {p.workspaceId && (
              <p className="text-[10px] text-ink-faint mt-1">
                Workspace {p.workspaceId.slice(0, 8)}…
              </p>
            )}
          </button>
        ))}
      </section>

      {detail && (
        <section className="bg-surface-raised border border-surface-border rounded-xl p-3 space-y-2">
          <div className="flex justify-between items-start">
            <h3 className="font-medium">{detail.project.name}</h3>
            <button
              onClick={() => void remove(detail.project.id)}
              className="text-xs text-danger"
            >
              Delete
            </button>
          </div>
          <ul className="text-xs text-ink-muted space-y-1 pl-2 border-l border-surface-border">
            <li>
              Workspace:{" "}
              {detail.project.workspaceId
                ? `${detail.project.workspaceId.slice(0, 8)}…`
                : "—"}
            </li>
            <li>Memory: {detail.memories.length} items</li>
            <li>Documents: {detail.documents.length} files</li>
            <li>Conversations: linked when chatting with this project active</li>
          </ul>
          {planProgress && <ProjectProgressPanel data={planProgress} />}
          {detail.memories.slice(0, 3).map((m) => (
            <p key={m.id} className="text-xs text-ink-muted truncate">
              · {m.content}
            </p>
          ))}
          {detail.documents.slice(0, 3).map((d) => (
            <p key={d.id} className="text-xs text-ink-muted">
              · {d.filename} ({d.status})
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
