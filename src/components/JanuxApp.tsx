"use client";

import {
  AudioLines,
  Check,
  Clapperboard,
  Film,
  Images,
  Loader2,
  Menu,
  MessageSquarePlus,
  Music,
  PanelLeftOpen,
  Sparkles,
  Square,
  TriangleAlert,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  formatDuration,
  type AppStatus,
  type ReplyMeta,
  type ConversationSnapshot,
  type ConversationSummary,
  type Message,
  type PublicAsset,
  type PublicJob,
} from "@/lib/client/api";
import { takeHandoff } from "@/lib/client/handoff";
import { DesignGallery } from "./DesignGallery";
import { LibraryPanel } from "./LibraryPanel";
import { Markdown } from "./Markdown";
import { ReplyTimeline, type TimelineStep } from "./ReplyTimeline";
import { Composer, type ComposerHandle } from "./Composer";
import { JobCard } from "./JobCard";
import { LogoMark, Wordmark } from "./Logo";
import { AccountPanel, ProjectsPanel } from "./Panels";
import { Sidebar } from "./Sidebar";
import { UsageRing, useUsage } from "./UsageMeters";
import { VideoResult } from "./VideoResult";

const SUGGESTIONS = [
  { icon: Film, label: "Edit my raw footage into a reel", text: "Edit my raw footage into a vertical reel: cut the pauses and mistakes, and keep the best parts." },
  { icon: Sparkles, label: "Add mass captions with emojis", text: "Add word-by-word animated captions with emojis to my video." },
  { icon: Wand2, label: "Make an animated intro", text: "Make a 4-second animated intro with my channel name." },
  { icon: Images, label: "Match a reference style", text: "Edit my clips in the same style as this reference." },
  { icon: Clapperboard, label: "Create a product promo", text: "Make a 20-second product promo reel from my clips with music on the beat." },
  { icon: Music, label: "Sync my clips to a song", text: "Cut my clips to the beat of this song." },
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
  const [panel, setPanel] = useState<null | "projects" | "account" | "library">(null);
  const [workerAlive, setWorkerAlive] = useState<boolean | null>(null);
  const [limits, setLimits] = useState({ maxUploadMB: 300, maxFiles: 10 });
  const [status, setStatus] = useState<AppStatus | null>(null);
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
        setStatus(s);
        setWorkerAlive(s.worker.alive);
      },
      () => undefined,
    );
    // A prompt or files started on the landing page.
    const url = new URL(window.location.href);
    const handoff = takeHandoff();
    const prompt = handoff?.prompt || url.searchParams.get("prompt");
    if (prompt || handoff?.files.length) {
      url.searchParams.delete("prompt");
      window.history.replaceState(null, "", url);
      requestAnimationFrame(() => {
        if (prompt) composerRef.current?.setText(prompt);
        if (handoff?.files.length) composerRef.current?.addFiles(handoff.files);
      });
    }
    const id = url.searchParams.get("c");
    const restore = id ? api.getConversation(id).then(setSnapshot, () => setUrlConversation(null)) : Promise.resolve();
    restore.finally(() => setLoading(false));
  }, [refreshList]);

  // Live job progress over server-sent events.
  useEffect(() => {
    if (!currentId) return;
    const es = new EventSource(`/api/conversations/${currentId}/events`);
    let hadError = false;
    es.addEventListener("message", (e) => {
      const msg = JSON.parse((e as MessageEvent).data) as Message;
      setSnapshot((s) => {
        if (!s || s.conversation.id !== msg.conversationId) return s;
        const exists = s.messages.some((x) => x.id === msg.id);
        return { ...s, messages: exists ? s.messages.map((x) => (x.id === msg.id ? msg : x)) : [...s.messages, msg] };
      });
    });
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
  const lastVersionId = [...messages].reverse().find((m) => m.versionId)?.versionId ?? null;
  const assistantEnabled = !!status?.assistant;
  const busyJob = (snapshot?.jobs ?? []).some((j) => !["completed", "failed", "cancelled"].includes(j.state));
  const isEmpty = !loading && messages.length === 0 && !thinking;
  // Refresh the usage meters whenever a reply starts or finishes.
  const usage = useUsage(`${messages.length}:${messages.filter((m) => (m.meta as ReplyMeta | null)?.status === "done").length}`);

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
            <button onClick={() => setPanel("library")} className="rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-card hover:text-ink">
              Library
            </button>
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
                <p className="mt-2 text-base text-muted sm:text-lg">What video should we make today?</p>
                <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => composerRef.current?.setText(s.text)}
                      className="flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-left text-sm hover:border-accent/40"
                    >
                      <s.icon size={17} className="shrink-0 text-accent" />
                      <span className="flex-1">{s.label}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-6 flex items-center gap-1.5 text-xs text-faint">
                  <Upload size={13} /> Attach raw clips, a reference, or a song. Tell me in any language, or send a voice note.
                </p>
              </div>
            )}

            <ol className="space-y-6">
              {messages.map((m) => {
                const meta = (m.meta ?? {}) as ReplyMeta;
                const legacyJob = m.jobId ? jobs.get(m.jobId) : undefined;
                const replyJobs = [legacyJob, ...(meta.jobIds ?? []).map((id) => jobs.get(id))].filter((j): j is PublicJob => !!j);
                const delivered = (meta.deliveries ?? []).map((d) => versionById.get(d.versionId)).filter((v): v is NonNullable<typeof v> => !!v);
                const shownVersion =
                  !m.jobId && !meta.jobIds?.length && !meta.deliveries?.length && m.versionId ? versionById.get(m.versionId) : undefined;
                const streaming = meta.status === "pending" || meta.status === "streaming";
                return (
                  <li key={m.id} className="animate-rise">
                    {m.role === "user" ? (
                      <UserMessage text={m.text} attachments={m.attachments.map((a) => snapshot!.assets[a]).filter(Boolean)} />
                    ) : (
                      <AssistantMessage
                        text={m.text}
                        streaming={streaming}
                        pending={meta.status === "pending" || (streaming && !m.text)}
                        queued={meta.status === "pending" && messages.some((x) => x.id !== m.id && (x.meta as ReplyMeta)?.status === "streaming")}
                        steps={meta.activity?.some((a) => a.at !== undefined) ? meta.activity : undefined}
                        conversationId={m.conversationId}
                      >
                        {meta.activity && meta.activity.length > 0 && !meta.activity.some((a) => a.at !== undefined) && <ActivityList items={meta.activity} />}
                        {meta.status === "error" && meta.error && (
                          <p role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm">
                            {meta.error}
                          </p>
                        )}
                        {streaming && (
                          <button
                            onClick={() => void api.stopReply(m.id)}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"
                          >
                            <Square size={11} /> Stop
                          </button>
                        )}
                        {(meta.designs ?? []).map((d, i) => (
                          <DesignGallery key={`${m.id}-d${i}`} design={d} assets={snapshot!.assets} />
                        ))}
                        {replyJobs.map((job) => {
                          const version = job.state === "completed" && job.outputVersionId ? versionById.get(job.outputVersionId) : undefined;
                          return (
                            <div key={job.id}>
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
                              {version && (
                                <>
                                  <p className="mt-3 text-[15px] text-ink">
                                    {job.kind === "motion" ? "Your animation is ready!" : "Your video is ready!"} Version {version.number} is below.
                                  </p>
                                  <VideoResult
                                    version={version}
                                    versions={versions}
                                    showSuggestions={version.id === lastVersionId && !assistantEnabled}
                                    onSend={(t) => void send(t, [])}
                                    onRequestChanges={() => composerRef.current?.focus()}
                                  />
                                </>
                              )}
                            </div>
                          );
                        })}
                        {delivered.map((v) => {
                          const credits = meta.deliveries?.find((d) => d.versionId === v.id)?.credits;
                          return (
                            <div key={v.id}>
                              <VideoResult
                                version={v}
                                versions={versions}
                                showSuggestions={false}
                                onSend={(t) => void send(t, [])}
                                onRequestChanges={() => composerRef.current?.focus()}
                              />
                              {credits && credits.length > 0 && (
                                <p className="mt-2 text-[11px] text-faint">Credits to include when posting: {credits.join(" · ")}</p>
                              )}
                            </div>
                          );
                        })}
                        {shownVersion && (
                          <VideoResult
                            version={shownVersion}
                            versions={versions}
                            showSuggestions={shownVersion.id === lastVersionId && !assistantEnabled}
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
                        <Sparkles size={14} className="animate-pulse text-accent" /> {assistantEnabled ? "Thinking…" : "Planning your edit…"}
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
              voiceNotes={!!status?.capabilities.voiceNotes}
              ensureConversation={ensureConversation}
              onSend={send}
            />
            <div className="mt-1.5 flex items-center gap-2">
              <p className="min-w-0 flex-1 text-center text-[11px] text-faint">
                {status?.assistant
                  ? `${status.assistant.devOnly ? "Dev mode · " : ""}Edits by ${status.assistant.label}. Videos render on this computer.`
                  : "AI chat is off (no API key or local Claude Code). Video edits use the keyword planner."}
              </p>
              <UsageRing report={usage} />
            </div>
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

      {panel === "library" && (
        <LibraryPanel
          onClose={() => setPanel(null)}
          onUse={(text) => {
            setPanel(null);
            composerRef.current?.setText(text);
          }}
        />
      )}
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
  const voice = attachments.filter((a) => a.transcript !== undefined);
  const media = attachments.filter((a) => a.transcript === undefined);
  return (
    <div className="flex flex-col items-end gap-2">
      {media.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {media.map((a) => (
            <figure key={a.id} className="w-32 overflow-hidden rounded-xl border border-line bg-card">
              <div className="relative grid h-20 place-items-center bg-black">
                {a.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : a.mediaType === "audio" ? (
                  <Music size={22} className="text-accent" />
                ) : null}
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
      {voice.map((a) => (
        <div key={a.id} className="max-w-[85%] rounded-2xl rounded-br-md border border-line bg-card-2 px-4 py-2.5">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
            <AudioLines size={13} className="text-accent" /> Voice note{a.language ? ` · ${LANGUAGE_NAMES[a.language] ?? a.language}` : ""}
            {a.duration ? ` · ${formatDuration(a.duration)}` : ""}
          </p>
          <audio controls preload="none" src={a.url} className="mb-1.5 h-8 w-full max-w-xs" />
          <p className="text-[15px] leading-relaxed">“{a.transcript}”</p>
        </div>
      ))}
      {text && <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-card-2 px-4 py-2.5 text-[15px] leading-relaxed">{text}</p>}
    </div>
  );
}

const LANGUAGE_NAMES: Record<string, string> = {
  ta: "Tamil", ml: "Malayalam", te: "Telugu", kn: "Kannada", hi: "Hindi", en: "English", mr: "Marathi", bn: "Bengali", gu: "Gujarati", ur: "Urdu",
};

function AssistantMessage({
  text,
  streaming,
  pending,
  queued,
  steps,
  conversationId,
  children,
}: {
  text: string;
  streaming?: boolean;
  pending?: boolean;
  queued?: boolean;
  /** Work steps placed within the reply (studio agent). */
  steps?: TimelineStep[];
  conversationId?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0">
        <LogoMark size={26} />
      </div>
      <div className="min-w-0 flex-1">
        {steps && conversationId ? (
          <>
            <ReplyTimeline text={text} steps={steps} streaming={!!streaming} conversationId={conversationId} />
            {/* Between steps, before new words arrive: show that it's still thinking. */}
            {streaming && !steps.some((s) => s.status === "running") && (steps.at(-1)?.at ?? 0) >= text.trimEnd().length && (
              <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                <Sparkles size={14} className="animate-pulse text-accent" /> Thinking…
              </p>
            )}
          </>
        ) : pending && !text ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Sparkles size={14} className="animate-pulse text-accent" /> {queued ? "Waiting for the previous reply to finish…" : "Thinking…"}
          </p>
        ) : (
          text && (
            <div className={streaming ? "typing-caret" : undefined}>
              <Markdown text={text} />
            </div>
          )
        )}
        {children}
      </div>
    </div>
  );
}

function ActivityList({ items }: { items: { label: string; status: "running" | "done" | "failed" }[] }) {
  return (
    <ul className="mt-3 space-y-1.5" aria-label="What JANUXAI is doing">
      {items.map((a, i) => (
        <li key={i} className="flex items-center gap-2 text-sm">
          {a.status === "running" ? (
            <Loader2 size={14} className="animate-spin text-accent" />
          ) : a.status === "done" ? (
            <Check size={14} className="text-accent" />
          ) : (
            <X size={14} className="text-danger" />
          )}
          <span className={a.status === "failed" ? "text-danger" : "text-muted"}>{a.label}</span>
        </li>
      ))}
    </ul>
  );
}
