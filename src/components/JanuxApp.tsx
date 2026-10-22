"use client";

import { Clapperboard, Film, Menu, MessageSquarePlus, PanelLeftOpen, Sparkles, Subtitles, TriangleAlert, Upload, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  formatDuration,
  type ConversationSnapshot,
  type ConversationSummary,
  type Message,
  type PublicAsset,
  type PublicJob,
  type PublicVersion,
} from "@/lib/client/api";
import { Composer, type ComposerHandle } from "./Composer";
import { JobCard } from "./JobCard";
import { LogoMark, Wordmark } from "./Logo";
import { AccountPanel, ProjectsPanel } from "./Panels";
import { Sidebar } from "./Sidebar";
import { VideoResult } from "./VideoResult";

const SUGGESTIONS = [
  { icon: Film, label: "Edit my clips into a reel", text: "Combine these clips into a 15-second vertical reel with smooth transitions." },
  { icon: Clapperboard, label: "Create a product advertisement", text: "Make a 30-second product ad from these clips with a cinematic look." },
  { icon: Subtitles, label: "Add captions to my video", text: "Add captions to my video.", soon: true },
  { icon: Wand2, label: "Make my video more cinematic", text: "Make my video more cinematic." },
];

function setUrlConversation(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("c", id);
  else url.searchParams.delete("c");
  window.history.replaceState(null, "", url);
}

export function JanuxApp() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  /** null = automatic (shown on desktop, hidden on mobile). */
  const [sidebarOpen, setSidebarOpen] = useState<boolean | null>(null);
  const [panel, setPanel] = useState<null | "projects" | "account">(null);
  const [workerAlive, setWorkerAlive] = useState<boolean | null>(null);
  const [limits, setLimits] = useState({ maxUploadMB: 300, maxFiles: 10 });
  const [toast, setToast] = useState<string | null>(null);
  const [thinking, setThinking] = useState<{ text: string; attachments: PublicAsset[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const creating = useRef<Promise<string> | null>(null);
  const currentId = snapshot?.conversation.id ?? null;

  const refreshList = useCallback(() => {
    api.listConversations().then((r) => setConversations(r.conversations), () => undefined);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 5000);
  };

  // Initial load: restore the conversation from ?c= so refreshes keep context.
  useEffect(() => {
    refreshList();
    api.status().then(
      (s) => {
        setLimits({ maxUploadMB: s.limits.maxUploadMB, maxFiles: s.limits.maxFilesPerMessage });
        setWorkerAlive(s.worker.alive);
      },
      () => undefined,
    );
    const id = new URL(window.location.href).searchParams.get("c");
    const restore = id ? api.getConversation(id).then(setSnapshot, () => setUrlConversation(null)) : Promise.resolve();
    restore.finally(() => setLoading(false));
  }, [refreshList]);

  // Live job progress over server-sent events.
  useEffect(() => {
    if (!currentId) return;
    const es = new EventSource(`/api/conversations/${currentId}/events`);
    let hadError = false;
    es.addEventListener("job", (e) => {
      const job = JSON.parse((e as MessageEvent).data) as PublicJob;
      setSnapshot((s) => {
        if (!s || s.conversation.id !== job.conversationId) return s;
        const exists = s.jobs.some((j) => j.id === job.id);
        return { ...s, jobs: exists ? s.jobs.map((j) => (j.id === job.id ? job : j)) : [...s.jobs, job] };
      });
    });
    es.addEventListener("snapshot", (e) => {
      const snap = JSON.parse((e as MessageEvent).data) as ConversationSnapshot;
      setSnapshot((s) => (s && s.conversation.id === snap.conversation.id ? snap : s));
      refreshList();
    });
    es.addEventListener("worker", (e) => setWorkerAlive(JSON.parse((e as MessageEvent).data).alive));
    es.addEventListener("deleted", () => es.close());
    es.onerror = () => {
      hadError = true;
    };
    es.onopen = () => {
      // After a dropped connection, resync everything we might have missed.
      if (hadError) api.getConversation(currentId).then(setSnapshot, () => undefined);
      hadError = false;
    };
    return () => es.close();
  }, [currentId, refreshList]);

  // Keep the newest message in view.
  const messageCount = (snapshot?.messages.length ?? 0) + (thinking ? 1 : 0);
  const versionCount = snapshot?.versions.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Wait a frame so newly rendered cards have their final height.
    const raf = requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
    return () => cancelAnimationFrame(raf);
  }, [messageCount, versionCount, currentId]);

  const ensureConversation = useCallback(async () => {
    if (currentId) return currentId;
    if (!creating.current) {
      creating.current = api.createConversation().then((snap) => {
        setSnapshot(snap);
        setUrlConversation(snap.conversation.id);
        refreshList();
        return snap.conversation.id;
      });
      creating.current.finally(() => {
        creating.current = null;
      });
    }
    return creating.current;
  }, [currentId, refreshList]);

  const send = useCallback(
    async (text: string, attachments: PublicAsset[]) => {
      try {
        const id = await ensureConversation();
        setThinking({ text, attachments });
        const res = await api.sendMessage(id, text, attachments.map((a) => a.id));
        const fresh = await api.getConversation(id);
        setSnapshot(fresh);
        if (res.job) setSnapshot((s) => (s && !s.jobs.some((j) => j.id === res.job!.id) ? { ...s, jobs: [...s.jobs, res.job!] } : s));
        refreshList();
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Couldn't send that message.");
        return false;
      } finally {
        setThinking(null);
      }
    },
    [ensureConversation, refreshList],
  );

  const openConversation = async (id: string) => {
    setPanel(null);
    if (!window.matchMedia("(min-width: 1024px)").matches) setSidebarOpen(false);
    if (id === currentId) return;
    try {
      const snap = await api.getConversation(id);
      setSnapshot(snap);
      setUrlConversation(id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't open that conversation.");
      refreshList();
    }
  };

  const newChat = () => {
    setSnapshot(null);
    setUrlConversation(null);
    if (!window.matchMedia("(min-width: 1024px)").matches) setSidebarOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const deleteConv = async (id: string) => {
    try {
      await api.deleteConversation(id);
      if (id === currentId) newChat();
      refreshList();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't delete that conversation.");
    }
  };

  const renameConv = async (id: string, title: string) => {
    try {
      await api.renameConversation(id, title);
      setSnapshot((s) => (s && s.conversation.id === id ? { ...s, conversation: { ...s.conversation, title } } : s));
      refreshList();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't rename.");
    }
  };

  const updateJob = (job: PublicJob) => setSnapshot((s) => (s ? { ...s, jobs: s.jobs.map((j) => (j.id === job.id ? job : j)) } : s));

  const jobs = new Map((snapshot?.jobs ?? []).map((j) => [j.id, j]));
  const versions = snapshot?.versions ?? [];
  const versionById = new Map(versions.map((v) => [v.id, v]));
  const messages = snapshot?.messages ?? [];
  const resultVersionOf = (m: Message): PublicVersion | null => {
    if (m.role !== "assistant") return null;
    if (m.jobId) {
      const j = jobs.get(m.jobId);
      return j?.state === "completed" && j.outputVersionId ? (versionById.get(j.outputVersionId) ?? null) : null;
    }
    return m.versionId ? (versionById.get(m.versionId) ?? null) : null;
  };
  const lastResultMessageId = [...messages].reverse().find((m) => resultVersionOf(m))?.id;
  const busyJob = (snapshot?.jobs ?? []).some((j) => !["completed", "failed", "cancelled"].includes(j.state));
  const isEmpty = !loading && messages.length === 0 && !thinking;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg">
      {/* Sidebar: inline on desktop, drawer on mobile */}
      {sidebarOpen !== false && (
        <>
          {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}
          <div className={`fixed inset-y-0 left-0 z-40 lg:static lg:z-auto ${sidebarOpen === null ? "hidden lg:block" : ""}`}>
            <Sidebar
              conversations={conversations}
              currentId={currentId}
              onSelect={openConversation}
              onNew={newChat}
              onRename={renameConv}
              onDelete={deleteConv}
              onClose={() => setSidebarOpen(false)}
              onOpenProjects={() => setPanel("projects")}
              onOpenAccount={() => setPanel("account")}
            />
          </div>
        </>
      )}

      <main
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) composerRef.current?.addFiles(e.dataTransfer.files);
        }}
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line/70 px-3 sm:px-4">
          {sidebarOpen !== true && (
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open conversations"
              className={`grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink ${sidebarOpen === null ? "lg:hidden" : ""}`}
            >
              <Menu size={18} className="lg:hidden" />
              <PanelLeftOpen size={18} className="hidden lg:block" />
            </button>
          )}
          <div className={`${sidebarOpen !== false ? "lg:hidden" : ""} ${snapshot ? "hidden sm:block" : ""}`}>
            <Wordmark />
          </div>
          {snapshot && (
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-ink sm:ml-2" title={snapshot.conversation.title}>
              {snapshot.conversation.title}
            </h1>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setPanel("projects")}
              className="hidden rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-card hover:text-ink sm:block"
            >
              Projects
            </button>
            <button
              onClick={() => setPanel("account")}
              className="hidden rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-card hover:text-ink sm:block"
            >
              Usage
            </button>
            <button onClick={newChat} aria-label="New video" title="New video" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-card hover:text-accent">
              <MessageSquarePlus size={18} />
            </button>
          </div>
        </header>

        {workerAlive === false && busyJob && (
          <div role="status" className="flex items-center gap-2 border-b border-warn/20 bg-warn/10 px-4 py-2 text-xs text-warn">
            <TriangleAlert size={14} />
            The render worker isn&apos;t running, so jobs are waiting. Start it with <code className="rounded bg-black/40 px-1">npm run worker</code> (or use{" "}
            <code className="rounded bg-black/40 px-1">npm run dev</code>, which starts both).
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto" aria-live="polite">
          <div className="mx-auto w-full max-w-3xl px-4 pb-6 pt-6 sm:px-6">
            {loading && <p className="pt-20 text-center text-sm text-faint">Loading…</p>}

            {isEmpty && (
              <div className="flex min-h-[55vh] flex-col items-center justify-center text-center animate-rise">
                <LogoMark size={52} />
                <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">Hey! I&apos;m JANUXAI.</h2>
                <p className="mt-2 text-base text-muted sm:text-lg">What video would you like to create today?</p>
                <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => composerRef.current?.setText(s.text)}
                      className="flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-left text-sm hover:border-accent/40"
                    >
                      <s.icon size={17} className="shrink-0 text-accent" />
                      <span className="flex-1">{s.label}</span>
                      {s.soon && <span className="rounded bg-line px-1.5 py-px text-[10px] uppercase tracking-wide text-muted">soon</span>}
                    </button>
                  ))}
                </div>
                <p className="mt-6 flex items-center gap-1.5 text-xs text-faint">
                  <Upload size={13} /> Attach clips with the paperclip, or drop them anywhere here.
                </p>
              </div>
            )}

            <ol className="space-y-6">
              {messages.map((m) => {
                const job = m.jobId ? jobs.get(m.jobId) : undefined;
                const version = resultVersionOf(m);
                return (
                  <li key={m.id} className="animate-rise">
                    {m.role === "user" ? (
                      <UserMessage text={m.text} attachments={m.attachments.map((a) => snapshot!.assets[a]).filter(Boolean)} />
                    ) : (
                      <AssistantMessage text={m.text}>
                        {job && (
                          <JobCard
                            job={job}
                            assets={snapshot!.assets}
                            workerAlive={workerAlive}
                            onCancel={async () => updateJob((await api.cancelJob(job.id)).job)}
                            onRetry={async () => {
                              try {
                                updateJob((await api.retryJob(job.id)).job);
                              } catch (err) {
                                showToast(err instanceof Error ? err.message : "Retry failed.");
                              }
                            }}
                          />
                        )}
                        {job?.state === "completed" && version && (
                          <p className="mt-3 text-[15px] text-ink">Your video is ready! Version {version.number} is below.</p>
                        )}
                        {version && (
                          <VideoResult
                            version={version}
                            versions={versions}
                            showSuggestions={m.id === lastResultMessageId}
                            onSend={(t) => void send(t, [])}
                            onRequestChanges={() => composerRef.current?.focus()}
                          />
                        )}
                      </AssistantMessage>
                    )}
                  </li>
                );
              })}
              {thinking && (
                <>
                  <li className="animate-rise">
                    <UserMessage text={thinking.text} attachments={thinking.attachments} />
                  </li>
                  <li className="animate-rise">
                    <AssistantMessage text="">
                      <p className="flex items-center gap-2 text-sm text-muted">
                        <Sparkles size={14} className="animate-pulse text-accent" /> Planning your edit…
                      </p>
                    </AssistantMessage>
                  </li>
                </>
              )}
            </ol>
          </div>
        </div>

        <div className="shrink-0 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <Composer
              ref={composerRef}
              maxUploadMB={limits.maxUploadMB}
              maxFiles={limits.maxFiles}
              ensureConversation={ensureConversation}
              onSend={send}
            />
            <p className="mt-2 text-center text-[11px] text-faint">
              JANUXAI edits with FFmpeg on this computer. Captions, music and voiceover are coming later.
            </p>
          </div>
        </div>

        {dragging && (
          <div className="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-3xl border-2 border-dashed border-accent/60 bg-bg/80">
            <p className="flex items-center gap-2 text-sm text-accent">
              <Upload size={16} /> Drop videos or images to attach
            </p>
          </div>
        )}

        {toast && (
          <div role="alert" className="absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-xl border border-danger/40 bg-card px-4 py-2.5 text-sm text-ink shadow-lg">
            {toast}
          </div>
        )}
      </main>

      {panel === "projects" && <ProjectsPanel conversations={conversations} onOpen={openConversation} onDelete={deleteConv} onClose={() => setPanel(null)} />}
      {panel === "account" && (
        <AccountPanel
          onClose={() => setPanel(null)}
          onDataDeleted={() => {
            setPanel(null);
            newChat();
            refreshList();
          }}
        />
      )}
    </div>
  );
}

function UserMessage({ text, attachments }: { text: string; attachments: PublicAsset[] }) {
  return (
    <div className="flex flex-col items-end gap-2">
      {attachments.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {attachments.map((a) => (
            <figure key={a.id} className="w-32 overflow-hidden rounded-xl border border-line bg-card">
              <div className="relative h-20 bg-black">
                {a.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                )}
                {a.duration != null && (
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[10px]">{formatDuration(a.duration)}</span>
                )}
              </div>
              <figcaption className="truncate px-2 py-1 text-[11px] text-muted" title={a.name}>
                {a.name}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {text && <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-card-2 px-4 py-2.5 text-[15px] leading-relaxed">{text}</p>}
    </div>
  );
}

function AssistantMessage({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0">
        <LogoMark size={26} />
      </div>
      <div className="min-w-0 flex-1">
        {text && <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{text}</p>}
        {children}
      </div>
    </div>
  );
}
