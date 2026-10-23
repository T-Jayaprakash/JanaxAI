"use client";

import { AlertCircle, ArrowUp, AudioLines, Check, Film, ImageIcon, Loader2, Mic, Music, Paperclip, X } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { deleteUnsentUpload, formatBytes, formatDuration, uploadFile, type PublicAsset } from "@/lib/client/api";

const VIDEO_EXT = ["mp4", "mov", "m4v", "webm", "mkv"];
const IMAGE_EXT = ["jpg", "jpeg", "png", "webp"];
const AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "ogg"];
const ACCEPT = [...VIDEO_EXT, ...IMAGE_EXT, ...AUDIO_EXT].map((e) => `.${e}`).join(",") + ",video/*,image/*,audio/*";
const MAX_VOICE_SECONDS = 180;

const LANGUAGE_NAMES: Record<string, string> = {
  ta: "Tamil", ml: "Malayalam", te: "Telugu", kn: "Kannada", hi: "Hindi", en: "English", mr: "Marathi", bn: "Bengali", gu: "Gujarati", ur: "Urdu",
};

interface Pending {
  localId: string;
  name: string;
  size: number;
  kind: "video" | "image" | "audio" | "voice";
  previewUrl: string;
  duration: number | null;
  progress: number;
  status: "uploading" | "processing" | "ready" | "error";
  error?: string;
  asset?: PublicAsset;
  abort?: () => void;
}

export interface ComposerHandle {
  setText: (text: string) => void;
  focus: () => void;
  addFiles: (files: FileList | File[]) => void;
}

const noopSubscribe = () => () => {};

/** Languages for live dictation (Whisper auto-detects when it polishes the text). */
const DICTATION_LANGS = [
  { code: "ta-IN", label: "தமிழ்" },
  { code: "en-IN", label: "EN" },
  { code: "hi-IN", label: "हिंदी" },
  { code: "ml-IN", label: "മലയാളം" },
  { code: "te-IN", label: "తెలుగు" },
];

interface SpeechResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onerror: (() => void) | null;
}

function getSpeechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const canRecord = () => typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

function pickRecorderType(): { mime: string; ext: string } {
  for (const [mime, ext] of [
    ["audio/webm;codecs=opus", "webm"],
    ["audio/ogg;codecs=opus", "ogg"],
    ["audio/mp4", "m4a"],
  ] as const) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: "", ext: "webm" };
}

export function Composer({
  ref,
  disabled,
  maxUploadMB,
  maxFiles,
  voiceNotes,
  ensureConversation,
  onSend,
}: {
  ref?: Ref<ComposerHandle>;
  disabled?: boolean;
  maxUploadMB: number;
  maxFiles: number;
  /** Whether the server can transcribe voice notes. */
  voiceNotes: boolean;
  ensureConversation: () => Promise<string>;
  onSend: (text: string, attachments: PublicAsset[]) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState<{ startedAt: number } | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [lang, setLang] = useState("ta-IN");
  const [now, setNow] = useState(0);
  const recordSupported = useSyncExternalStore(noopSubscribe, canRecord, () => false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const dictationRef = useRef<{ stream: MediaStream; speech: SpeechRecognitionLike | null; cancelled: boolean; before: string } | null>(null);

  // Remember the dictation language between visits.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const saved = localStorage.getItem("janux.dictationLang");
        if (saved && DICTATION_LANGS.some((l) => l.code === saved)) setLang(saved);
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const cycleLang = () => {
    const i = DICTATION_LANGS.findIndex((l) => l.code === lang);
    const next = DICTATION_LANGS[(i + 1) % DICTATION_LANGS.length].code;
    setLang(next);
    try {
      localStorage.setItem("janux.dictationLang", next);
    } catch {}
  };
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.previewUrl)), []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - recording.startedAt > MAX_VOICE_SECONDS * 1000) recorderRef.current?.stop();
    }, 250);
    return () => clearInterval(t);
  }, [recording]);

  // Auto-grow the textarea up to a limit.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const patch = (localId: string, p: Partial<Pending>) => setItems((list) => list.map((i) => (i.localId === localId ? { ...i, ...p } : i)));

  const upload = async (entries: { file: File; item: Pending; purpose: "media" | "voice" }[]) => {
    if (!entries.length) return;
    setItems((cur) => [...cur, ...entries.map((e) => e.item)]);
    let conversationId: string;
    try {
      conversationId = await ensureConversation();
    } catch {
      entries.forEach(({ item }) => patch(item.localId, { status: "error", error: "Couldn't start a conversation." }));
      return;
    }
    // Upload a few at a time so dozens of clips don't overload the machine.
    const queue = [...entries];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { file, item, purpose } = next;
        if (!itemsRef.current.some((i) => i.localId === item.localId)) continue; // removed while waiting
        const up = uploadFile(file, conversationId, (p) => patch(item.localId, { progress: p, status: p >= 1 ? "processing" : "uploading" }), purpose);
        patch(item.localId, { abort: up.abort });
        await up.promise
          .then((asset) => patch(item.localId, { status: "ready", asset, duration: asset.duration, progress: 1, abort: undefined }))
          .catch((err: Error) => patch(item.localId, { status: "error", error: err.message, abort: undefined }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
  };

  const addFiles = async (files: FileList | File[]) => {
    setNotice(null);
    const list = Array.from(files);
    const room = maxFiles - itemsRef.current.length;
    if (list.length > room) setNotice(`You can attach up to ${maxFiles} files per message.`);
    const accepted: { file: File; item: Pending; purpose: "media" }[] = [];
    for (const file of list.slice(0, Math.max(room, 0))) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const kind = VIDEO_EXT.includes(ext) ? "video" : IMAGE_EXT.includes(ext) ? "image" : AUDIO_EXT.includes(ext) ? "audio" : null;
      if (!kind) {
        setNotice(`"${file.name}" isn't a supported video, image or audio file.`);
        continue;
      }
      if (file.size > maxUploadMB * 1048576) {
        setNotice(`"${file.name}" is larger than the ${maxUploadMB} MB limit.`);
        continue;
      }
      accepted.push({
        file,
        purpose: "media",
        item: { localId: crypto.randomUUID(), name: file.name, size: file.size, kind, previewUrl: URL.createObjectURL(file), duration: null, progress: 0, status: "uploading" },
      });
    }
    await upload(accepted);
  };

  /**
   * Dictation, like ChatGPT: words appear in the box while you speak (browser
   * speech recognition), then the recording is re-transcribed locally with
   * Whisper for a cleaner result you can edit before sending.
   */
  const startDictation = async () => {
    setNotice(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setNotice("Microphone access was blocked. Allow it in your browser to dictate.");
      return;
    }
    const before = text;
    const base = text.trim() ? `${text.replace(/\s+$/, "")} ` : "";
    let heard = "";
    const { mime } = pickRecorderType();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const Speech = getSpeechCtor();
    let speech: SpeechRecognitionLike | null = null;
    if (Speech) {
      speech = new Speech();
      speech.lang = lang;
      speech.interimResults = true;
      speech.continuous = true;
      speech.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) heard += `${r[0].transcript.trim()} `;
          else interim += r[0].transcript;
        }
        setText(base + heard + interim);
      };
      speech.onerror = () => undefined; // live text is a bonus; Whisper still runs
      try {
        speech.start();
      } catch {
        speech = null;
      }
    }

    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try {
        speech?.stop();
      } catch {}
      const state = dictationRef.current;
      dictationRef.current = null;
      setRecording(null);
      if (state?.cancelled) {
        setText(state.before);
        return;
      }
      const type = (rec.mimeType || mime || "audio/webm").split(";")[0];
      const blob = new Blob(chunks, { type });
      if (blob.size < 2000) return;
      if (!voiceNotes) {
        if (!heard.trim()) setNotice("I couldn't catch that. Try again a little closer to the mic.");
        return;
      }
      setPolishing(true);
      try {
        const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": type }, body: blob });
        const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (res.ok && body.text) setText(base + body.text);
        else if (!heard.trim()) setNotice(body.error ?? "I couldn't catch that. Try again a little closer to the mic.");
      } catch {
        if (!heard.trim()) setNotice("Couldn't transcribe that. Check your connection and try again.");
      } finally {
        setPolishing(false);
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    };
    dictationRef.current = { stream, speech, cancelled: false, before };
    recorderRef.current = rec;
    rec.start(1000);
    setNow(Date.now());
    setRecording({ startedAt: Date.now() });
  };

  const stopDictation = (cancel = false) => {
    if (dictationRef.current) dictationRef.current.cancelled = cancel;
    recorderRef.current?.stop();
  };

  const remove = (i: Pending) => {
    i.abort?.();
    if (i.asset) deleteUnsentUpload(i.asset.id);
    URL.revokeObjectURL(i.previewUrl);
    setItems((list) => list.filter((x) => x.localId !== i.localId));
  };

  useImperativeHandle(ref, () => ({
    setText: (t: string) => {
      setText(t);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(t.length, t.length);
      });
    },
    focus: () => textareaRef.current?.focus(),
    addFiles: (files) => void addFiles(files),
  }));

  const uploading = items.some((i) => i.status === "uploading" || i.status === "processing");
  const ready = items.filter((i) => i.status === "ready");
  const canSend = !disabled && !sending && !uploading && !recording && !polishing && (text.trim().length > 0 || ready.length > 0);

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    const ok = await onSend(text.trim(), ready.map((i) => i.asset!));
    setSending(false);
    if (ok) {
      setText("");
      items.forEach((i) => URL.revokeObjectURL(i.previewUrl));
      setItems((list) => list.filter((i) => i.status === "error"));
      textareaRef.current?.focus();
    }
  };

  const recSeconds = recording ? Math.max(0, Math.floor((now - recording.startedAt) / 1000)) : 0;

  return (
    <div className="rounded-3xl border border-line bg-card shadow-[0_-8px_30px_rgba(0,0,0,0.35)] focus-within:border-accent/40">
      {items.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto px-3 pt-3" aria-label="Attachments">
          {items.map((i) => (
            <li key={i.localId} className={`relative shrink-0 overflow-hidden rounded-xl border border-line bg-bg-2 ${i.kind === "voice" ? "w-56" : "w-28"}`}>
              <div className="relative h-16 bg-black">
                {i.kind === "voice" || i.kind === "audio" ? (
                  <div className="flex h-full items-center gap-2 px-3">
                    {i.kind === "voice" ? <AudioLines size={20} className="shrink-0 text-accent" /> : <Music size={20} className="shrink-0 text-accent" />}
                    <p className="line-clamp-2 text-[11px] leading-snug text-muted">
                      {i.kind === "voice"
                        ? i.status === "ready"
                          ? `“${i.asset?.transcript}”`
                          : i.status === "error"
                            ? ""
                            : "Listening to your voice note…"
                        : "Background music"}
                    </p>
                  </div>
                ) : i.asset?.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.asset.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : i.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.previewUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <video
                    src={`${i.previewUrl}#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(e) => patch(i.localId, { duration: i.duration ?? e.currentTarget.duration })}
                    className="h-full w-full object-cover"
                  />
                )}
                {(i.status === "uploading" || i.status === "processing") && i.kind !== "voice" && (
                  <div className="absolute inset-0 grid place-items-center bg-black/55">
                    <span className="flex items-center gap-1 text-[10px] text-ink">
                      <Loader2 size={12} className="animate-spin" />
                      {i.status === "uploading" ? `${Math.round(i.progress * 100)}%` : "Checking"}
                    </span>
                  </div>
                )}
                {i.status === "error" && (
                  <div className="absolute inset-0 grid place-items-center bg-danger/25">
                    <AlertCircle size={18} className="text-danger" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Remove ${i.name}`}
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/75 text-ink hover:bg-black"
                >
                  <X size={13} />
                </button>
              </div>
              {i.status === "uploading" && (
                <div className="h-0.5 bg-line">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${i.progress * 100}%` }} />
                </div>
              )}
              <div className="px-2 py-1">
                <p className="flex items-center gap-1 truncate text-[11px]" title={i.error ?? i.name}>
                  {i.kind === "image" ? (
                    <ImageIcon size={10} className="shrink-0 text-muted" />
                  ) : i.kind === "video" ? (
                    <Film size={10} className="shrink-0 text-muted" />
                  ) : i.status === "processing" ? (
                    <Loader2 size={10} className="shrink-0 animate-spin text-muted" />
                  ) : null}
                  <span className="truncate">
                    {i.name}
                    {i.kind === "voice" && i.asset?.language ? ` · ${LANGUAGE_NAMES[i.asset.language] ?? i.asset.language}` : ""}
                    {i.kind === "voice" && i.status === "processing" ? " · transcribing" : ""}
                  </span>
                </p>
                <p className={`truncate text-[10px] ${i.status === "error" ? "text-danger" : "text-faint"}`} title={i.error}>
                  {i.status === "error" ? i.error : [formatDuration(i.duration), formatBytes(i.size)].filter(Boolean).join(" · ")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <p role="status" className="px-4 pt-2 text-xs text-warn">
          {notice}
        </p>
      )}

      {(
        <div className="flex items-end gap-1.5 p-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            aria-label="Attach videos, images or music"
            title="Attach videos, images or music"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-card-2 hover:text-ink disabled:opacity-40"
          >
            <Paperclip size={19} />
          </button>
          <label htmlFor="composer-input" className="sr-only">
            Describe the video or design you want
          </label>
          <textarea
            id="composer-input"
            ref={textareaRef}
            rows={1}
            value={text}
            readOnly={!!recording || polishing}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                void addFiles(e.clipboardData.files);
              }
            }}
            placeholder={recording ? "Listening… speak naturally" : items.length ? "How should I edit this?" : "Describe the video you want…"}
            className="max-h-[200px] min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-6 text-ink placeholder:text-faint focus:outline-none focus-visible:outline-none"
          />
          {recording ? (
            <>
              <span className="flex h-10 shrink-0 items-center gap-1.5 px-1 font-mono text-xs text-muted" aria-live="polite">
                <span className="h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden="true" />
                {formatDuration(recSeconds) || "0.0s"}
              </span>
              <button
                type="button"
                onClick={() => stopDictation(true)}
                aria-label="Cancel dictation"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-card-2 hover:text-ink"
              >
                <X size={18} />
              </button>
              <button
                type="button"
                onClick={() => stopDictation(false)}
                aria-label="Finish dictation"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-bg hover:bg-accent-2"
              >
                <Check size={18} strokeWidth={2.6} />
              </button>
            </>
          ) : polishing ? (
            <span className="flex h-10 shrink-0 items-center gap-1.5 px-2 text-xs text-muted">
              <Loader2 size={14} className="animate-spin" /> Polishing…
            </span>
          ) : (
            recordSupported && (
              <>
                <button
                  type="button"
                  onClick={cycleLang}
                  title="Dictation language (tap to change)"
                  aria-label={`Dictation language: ${DICTATION_LANGS.find((l) => l.code === lang)?.label}`}
                  className="h-8 shrink-0 self-center rounded-full border border-line px-2.5 text-[11px] text-muted hover:text-ink"
                >
                  {DICTATION_LANGS.find((l) => l.code === lang)?.label}
                </button>
                <button
                  type="button"
                  onClick={() => void startDictation()}
                  disabled={disabled}
                  aria-label="Dictate"
                  title="Dictate: speak and your words appear here"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-card-2 hover:text-ink disabled:opacity-40"
                >
                  <Mic size={18} />
                </button>
              </>
            )
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSend}
            aria-label="Send"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-bg transition-colors hover:bg-accent-2 disabled:bg-line disabled:text-faint"
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={19} strokeWidth={2.4} />}
          </button>
        </div>
      )}
      {uploading && <p className="px-4 pb-2 text-[11px] text-faint">Uploading… you can send once files finish processing.</p>}
    </div>
  );
}
