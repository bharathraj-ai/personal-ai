"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatInput } from "@/components/ChatInput";
import { DocumentsView } from "@/components/DocumentsView";
import { MemoryView } from "@/components/MemoryView";
import { MessageList } from "@/components/MessageList";
import { ProjectsView } from "@/components/ProjectsView";
import { ProjectProgressPanel, type ProjectProgressData } from "@/components/ProjectProgressPanel";
import { StatusBar } from "@/components/StatusBar";
import { StatusView } from "@/components/StatusView";
import { SystemPanel } from "@/components/SystemPanel";
import { VoiceSettings } from "@/components/VoiceSettings";
import { WorkspacesView } from "@/components/WorkspacesView";
import type { ApiRequirementItem, ChatMessage, MessageVerification, OrchestratorEvent } from "@/lib/types";
import { API_URL, authHeaders } from "@/lib/api";
import {
  DEFAULT_VOICE_PREFS,
  loadVoicePrefs,
  saveVoicePrefs,
  speakText,
  stopSpeaking,
  type VoicePrefs,
} from "@/lib/voice";
import {
  fetchJarvisBriefing,
  isJarvisModeEnabled,
  resolveJarvisRoute,
  setJarvisModeEnabled,
  speakableJarvisReply,
  JARVIS_SUGGESTIONS,
  JARVIS_VOICE_PREFS,
} from "@/lib/jarvis";

type Tab = "chat" | "memory" | "docs" | "projects" | "workspaces" | "status";

const TAB_LABELS: Record<Tab, string> = {
  chat: "Chat",
  memory: "Memory",
  docs: "Docs",
  projects: "Projects",
  workspaces: "Spaces",
  status: "Status",
};

export default function HomePage() {
  const [tab, setTab] = useState<Tab>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"chat" | "orchestrate" | "jarvis">("chat");
  const [events, setEvents] = useState<OrchestratorEvent[]>([]);
  const [apiRequirements, setApiRequirements] = useState<ApiRequirementItem[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | undefined>();
  const [projectId, setProjectId] = useState<string | undefined>();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [voicePrefs, setVoicePrefs] = useState<VoicePrefs>(DEFAULT_VOICE_PREFS);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [pendingGoal, setPendingGoal] = useState<string | undefined>();
  const [pendingStatus, setPendingStatus] = useState<
    "awaiting_clarification" | "awaiting_implementation_approval" | undefined
  >();
  const [projectProgress, setProjectProgress] = useState<ProjectProgressData | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const voicePrefsRef = useRef(voicePrefs);
  const jarvisBriefedRef = useRef(false);

  useEffect(() => {
    const prefs = loadVoicePrefs();
    if (isJarvisModeEnabled()) {
      setMode("jarvis");
      setVoicePrefs({ ...prefs, ...JARVIS_VOICE_PREFS });
    } else {
      setVoicePrefs(prefs);
    }
  }, []);

  useEffect(() => {
    if (mode !== "jarvis" || jarvisBriefedRef.current) return;
    jarvisBriefedRef.current = true;
    void (async () => {
      const briefing = await fetchJarvisBriefing(API_URL, authHeaders());
      setMessages((prev) =>
        prev.length === 0
          ? [{ role: "assistant", content: briefing, id: crypto.randomUUID() }]
          : prev,
      );
      if (voicePrefsRef.current.autoSpeak) {
        speakText(speakableJarvisReply(briefing), voicePrefsRef.current);
      }
    })();
  }, [mode]);

  const enableJarvis = useCallback(async () => {
    setMode("jarvis");
    setJarvisModeEnabled(true);
    setVoicePrefs((prev) => {
      const next = { ...prev, ...JARVIS_VOICE_PREFS };
      saveVoicePrefs(next);
      return next;
    });
    if (!jarvisBriefedRef.current) {
      jarvisBriefedRef.current = true;
      const briefing = await fetchJarvisBriefing(API_URL, authHeaders());
      setMessages((prev) =>
        prev.length === 0
          ? [{ role: "assistant", content: briefing, id: crypto.randomUUID() }]
          : prev,
      );
      speakText(speakableJarvisReply(briefing), { ...voicePrefsRef.current, ...JARVIS_VOICE_PREFS });
    }
  }, []);

  const disableJarvis = useCallback(() => {
    setMode("chat");
    setJarvisModeEnabled(false);
  }, []);

  useEffect(() => {
    voicePrefsRef.current = voicePrefs;
  }, [voicePrefs]);

  useEffect(() => {
    return () => stopSpeaking();
  }, []);

  const speakReply = useCallback(
    (content: string) => {
      const prefs = voicePrefsRef.current;
      if (!prefs.autoSpeak || !content.trim()) return;
      const spoken = mode === "jarvis" ? speakableJarvisReply(content) : content;
      speakText(spoken, prefs);
    },
    [mode],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      stopSpeaking();
      const userMsg: ChatMessage = { role: "user", content: text, id: crypto.randomUUID() };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);
      setEvents([]);
      setApiRequirements([]);

      const history = messages
        .filter((m) => !/\[Model not loaded\]/i.test(m.content))
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        const agentMode = mode === "jarvis" ? "jarvis" : undefined;
        const useOrchestrate =
          mode === "orchestrate" || (mode === "jarvis" && resolveJarvisRoute(text) === "orchestrate");

        if (useOrchestrate) {
          const res = await fetch(`${API_URL}/orchestrate`, {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              message: text,
              history,
              workspaceId,
              projectId,
              conversationId,
              originalGoal: pendingGoal,
              agentMode,
            }),
          });
          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(
              errBody.slice(0, 200) || `Orchestrate request failed (${res.status})`,
            );
          }
          const data = await res.json();

          if (
            data.status === "awaiting_clarification" ||
            data.status === "awaiting_implementation_approval"
          ) {
            setPendingGoal(
              typeof data.goal === "string"
                ? data.goal
                : pendingGoal ?? text,
            );
            setPendingStatus(data.status);
          } else {
            setPendingGoal(undefined);
            setPendingStatus(undefined);
          }

          if (data.workspaceId) setWorkspaceId(data.workspaceId);

          if (data.completeness || data.projectPlan) {
            const comp = data.completeness as {
              status?: string;
              counts?: ProjectProgressData["counts"];
              storage?: string[];
            } | undefined;
            setProjectProgress({
              projectName: data.projectPlan?.project?.name ?? "Project",
              status: data.projectStatus ?? comp?.status ?? "PARTIAL",
              phase: data.events?.find((e: { phase: string }) => e.phase === "EXECUTE")?.detail,
              workspaceId: data.workspaceId,
              counts: comp?.counts,
              modules: data.projectPlan?.modules?.map(
                (m: { id: string; name: string; status?: string }) => ({
                  id: m.id,
                  name: m.name,
                  status: m.status,
                }),
              ),
              testStatus: comp?.counts?.tests
                ? `${comp.counts.tests.passed}/${comp.counts.tests.total}`
                : undefined,
              storage: comp?.storage?.join(" / "),
            });
          }

          if (Array.isArray(data.events) && data.events.length > 0) {
            const mapped = data.events
              .filter((e: { phase: string }) =>
                [
                  "ANALYZE",
                  "CLARIFY",
                  "DECIDE",
                  "PLAN",
                  "EXECUTE",
                  "VERIFY",
                  "RETRY",
                  "AWAIT_APPROVAL",
                  "FAILED",
                  "COMPLETE",
                ].includes(e.phase),
              )
              .map((e: {
                detail?: string;
                phase: string;
                status: string;
                tool?: string;
                error?: string;
              }) => ({
                label: e.error || e.detail || e.tool || e.phase,
                status:
                  data.status === "awaiting_clarification" &&
                  (e.phase === "CLARIFY" || e.status === "awaiting_approval")
                    ? ("pending" as const)
                    : data.status === "awaiting_implementation_approval" &&
                        e.phase === "AWAIT_APPROVAL"
                      ? ("pending" as const)
                      : e.status === "completed" || e.phase === "COMPLETE"
                        ? ("done" as const)
                        : e.status === "failed" || e.phase === "FAILED"
                          ? ("failed" as const)
                          : ("pending" as const),
              }));

            const planSaysUnavailable = mapped.some((e: { label: string }) =>
              /model unavailable|weights not loaded/i.test(e.label),
            );
            const terminalOk =
              data.status === "completed" ||
              data.status === "awaiting_clarification" ||
              data.status === "awaiting_implementation_approval";
            setEvents(
              planSaysUnavailable && !terminalOk
                ? [{ label: "Model weights not loaded", status: "failed" as const }]
                : mapped.length > 0
                  ? mapped
                  : data.status === "awaiting_clarification"
                    ? [{ label: "Awaiting clarification answers", status: "pending" as const }]
                    : data.status === "awaiting_implementation_approval"
                      ? [{ label: "Awaiting implementation approval", status: "pending" as const }]
                      : (data.plan?.steps ?? []).map((s: { description: string }, i: number) => ({
                          label: s.description,
                          status: data.verifications?.[i]?.passed ? "done" : "failed",
                        })),
            );
          } else if (data.plan?.steps) {
            setEvents(
              data.plan.steps.map((s: { description: string }, i: number) => ({
                label: s.description,
                status: data.verifications?.[i]?.passed ? "done" : "failed",
              })),
            );
          }

          if (data.apiRequirements?.missing?.length) {
            const items: ApiRequirementItem[] = [
              ...data.apiRequirements.required.map(
                (r: { id: string; name: string; required: boolean }) => ({
                  id: r.id,
                  name: r.name,
                  required: r.required,
                  connected: !data.apiRequirements.missing.some(
                    (m: { id: string }) => m.id === r.id,
                  ),
                }),
              ),
            ];
            setApiRequirements(items);
          }

          const reply = data.finalResponse ?? data.error ?? "No response";
          const av = data.answerVerification as
            | {
                status?: MessageVerification["status"];
                reason?: string;
                confidence?: number;
                sources?: MessageVerification["sources"];
                evidence?: Array<{
                  title?: string;
                  url?: string;
                  sourceQuality?: string;
                  type?: string;
                }>;
              }
            | undefined;
          const verification: MessageVerification | undefined = av?.status
            ? {
                status: av.status,
                reason: av.reason,
                confidence: av.confidence,
                sources:
                  av.sources ??
                  av.evidence?.map((e) => ({
                    title: e.title,
                    url: e.url,
                    sourceQuality: e.sourceQuality,
                    type: e.type,
                  })),
              }
            : undefined;
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: reply,
              id: crypto.randomUUID(),
              verification,
            },
          ]);
          speakReply(reply);
        } else {
          abortRef.current = new AbortController();
          const assistantId = crypto.randomUUID();
          setMessages((prev) => [...prev, { role: "assistant", content: "", id: assistantId }]);

          const res = await fetch(`${API_URL}/chat/stream`, {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              message: text,
              history,
              projectId,
              conversationId,
              agentMode,
            }),
            signal: abortRef.current.signal,
          });

          if (!res.ok) {
            throw new Error(`API ${res.status}`);
          }

          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          let accumulated = "";

          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value);
              for (const line of chunk.split("\n")) {
                if (!line.startsWith("data: ")) continue;
                try {
                  const parsed = JSON.parse(line.slice(6)) as {
                    type: string;
                    content?: string;
                    conversationId?: string;
                    error?: string;
                    verification?: MessageVerification;
                  };
                  if (parsed.type === "text" && parsed.content) {
                    accumulated += parsed.content;
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId ? { ...m, content: accumulated } : m,
                      ),
                    );
                  }
                  if (parsed.type === "replace" && typeof parsed.content === "string") {
                    accumulated = parsed.content;
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId ? { ...m, content: accumulated } : m,
                      ),
                    );
                  }
                  if (parsed.type === "error" && parsed.error) {
                    accumulated = accumulated || `Error: ${parsed.error}`;
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId ? { ...m, content: accumulated } : m,
                      ),
                    );
                  }
                  if (parsed.type === "done") {
                    if (parsed.conversationId) {
                      setConversationId(parsed.conversationId);
                    }
                    if (parsed.verification) {
                      const v = parsed.verification;
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === assistantId ? { ...m, verification: v } : m,
                        ),
                      );
                    }
                  }
                } catch {
                  // skip
                }
              }
            }
          }
          if (accumulated) speakReply(accumulated);
        }
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          const msg = `Error: ${err.message}`;
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: msg, id: crypto.randomUUID() },
          ]);
          speakReply(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [messages, mode, workspaceId, projectId, conversationId, pendingGoal, speakReply],
  );

  return (
    <div className="relative flex flex-col h-dvh max-w-lg mx-auto border-x border-surface-border/60 bg-surface/40 backdrop-blur-[2px]">
      <header className="px-3 pt-3 pb-2 border-b border-surface-border/80">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div>
            <h1 className="font-display text-xl tracking-tight text-ink leading-none">
              Personal AI
            </h1>
            <p className="text-[11px] text-ink-faint mt-1">
              {mode === "jarvis"
                ? "Jarvis · Voice · Orchestrate · Tools"
                : "Bharath · Orchestrator · Tools"}
            </p>
          </div>
          {(projectId || workspaceId) && (
            <span className="text-[10px] text-ink-muted bg-surface-raised border border-surface-border rounded-full px-2.5 py-1 max-w-[40%] truncate">
              {projectId ? `Project ${projectId.slice(0, 8)}` : `Space ${workspaceId?.slice(0, 8)}`}
            </span>
          )}
        </div>
        <nav className="flex gap-1 overflow-x-auto scrollbar-thin pb-0.5">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                tab === t
                  ? "bg-accent text-[#041512] shadow-glow"
                  : "text-ink-muted hover:text-ink hover:bg-surface-raised"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </nav>
      </header>

      {tab === "status" ? (
        <StatusView />
      ) : tab === "workspaces" ? (
        <WorkspacesView onActivated={setWorkspaceId} />
      ) : tab === "memory" ? (
        <MemoryView />
      ) : tab === "docs" ? (
        <DocumentsView />
      ) : tab === "projects" ? (
        <ProjectsView
          workspaceId={workspaceId}
          activeProjectId={projectId}
          onSelectProject={setProjectId}
        />
      ) : (
        <>
          <div className="flex justify-between items-center px-4 py-2 border-b border-surface-border/70 gap-2">
            <span className="text-[11px] text-ink-faint truncate">
              {projectId
                ? "Project context on"
                : workspaceId
                  ? "Workspace linked"
                  : "No project selected"}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setMessages([]);
                    setEvents([]);
                    setApiRequirements([]);
                    setConversationId(undefined);
                  }}
                  className="text-[11px] text-ink-faint hover:text-ink px-2 py-1 rounded-full hover:bg-surface-raised transition"
                >
                  Clear
                </button>
              )}
              <div className="flex rounded-full p-0.5 bg-surface-raised border border-surface-border text-xs">
                <button
                  onClick={() => {
                    disableJarvis();
                    setMode("chat");
                  }}
                  className={`px-2.5 py-1 rounded-full transition ${
                    mode === "chat" ? "bg-accent/90 text-[#041512] font-semibold" : "text-ink-muted"
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => {
                    disableJarvis();
                    setMode("orchestrate");
                  }}
                  title="Multi-step builds with tools"
                  className={`px-2.5 py-1 rounded-full transition ${
                    mode === "orchestrate"
                      ? "bg-accent/90 text-[#041512] font-semibold"
                      : "text-ink-muted"
                  }`}
                >
                  Orchestrate
                </button>
                <button
                  onClick={() => void enableJarvis()}
                  title="Voice-first Jarvis agent — Hey Jarvis"
                  className={`px-2.5 py-1 rounded-full transition ${
                    mode === "jarvis"
                      ? "bg-accent/90 text-[#041512] font-semibold"
                      : "text-ink-muted"
                  }`}
                >
                  Jarvis
                </button>
              </div>
            </div>
          </div>

          <SystemPanel apiRequirements={apiRequirements} />
          {projectProgress && (mode === "orchestrate" || mode === "jarvis") && (
            <div className="px-4">
              <ProjectProgressPanel data={projectProgress} />
            </div>
          )}
          {(loading || events.length > 0) &&
            (mode === "orchestrate" || mode === "jarvis") && (
            <StatusBar events={events} loading={loading} />
          )}
          <MessageList
            messages={messages}
            loading={loading}
            onSuggestion={sendMessage}
            emptyTitle={mode === "jarvis" ? "Jarvis" : "Personal AI"}
            emptyHint={
              mode === "jarvis"
                ? "Hands-free assistant. Say Hey Jarvis, ask anything, or tell me to build a project."
                : "Bharath is the brain. Ask questions, search the web, or manage files on your laptop."
            }
            suggestions={mode === "jarvis" ? JARVIS_SUGGESTIONS : undefined}
            assistantBadge={mode === "jarvis" ? "JV" : "AI"}
          />

          <div className="safe-bottom border-t border-surface-border/80 p-3 bg-surface/70 backdrop-blur-md space-y-2">
            {(mode === "orchestrate" || mode === "jarvis") && pendingStatus && (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="text-warn px-2 py-1 rounded-lg bg-warn/10 border border-warn/30">
                  {pendingStatus === "awaiting_clarification"
                    ? "Awaiting clarification"
                    : "Awaiting implementation approval"}
                </span>
                {pendingStatus === "awaiting_clarification" && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => sendMessage("use defaults")}
                    className="px-3 py-1 rounded-full bg-surface-raised border border-surface-border hover:border-accent/50"
                  >
                    Use defaults
                  </button>
                )}
                {pendingStatus === "awaiting_implementation_approval" && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => sendMessage("approve")}
                    className="px-3 py-1 rounded-full bg-accent/90 text-[#041512] font-semibold"
                  >
                    Approve implementation
                  </button>
                )}
              </div>
            )}
            <ChatInput
              onSend={sendMessage}
              disabled={loading}
              voicePrefs={voicePrefs}
              onVoicePrefsChange={setVoicePrefs}
              onOpenVoiceSettings={() => setVoiceOpen(true)}
            />
          </div>
        </>
      )}

      <VoiceSettings
        prefs={voicePrefs}
        onChange={setVoicePrefs}
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
      />
    </div>
  );
}
