"use client";

import { AlertCircle, ArrowUp, Film, ImageIcon, Loader2, Mic, MicOff, Paperclip, X } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { deleteUnsentUpload, formatBytes, formatDuration, uploadFile, type PublicAsset } from "@/lib/client/api";

const VIDEO_EXT = ["mp4", "mov", "m4v", "webm", "mkv"];
const IMAGE_EXT = ["jpg", "jpeg", "png", "webp"];
const ACCEPT = [...VIDEO_EXT, ...IMAGE_EXT].map((e) => `.${e}`).join(",") + ",video/*,image/*";

interface Pending {
  localId: string;
  name: string;
  size: number;
  kind: "video" | "image";
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

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function getSpeechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};

export function Composer({
  ref,
  disabled,
  maxUploadMB,
  maxFiles,
  ensureConversation,
  onSend,
}: {
  ref?: Ref<ComposerHandle>;
  disabled?: boolean;
  maxUploadMB: number;
  maxFiles: number;
  ensureConversation: () => Promise<string>;
  onSend: (text: string, attachments: PublicAsset[]) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const speechSupported = useSyncExternalStore(noopSubscribe, () => !!getSpeechCtor(), () => false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.previewUrl)), []);

  // Auto-grow the textarea up to a limit.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const patch = (localId: string, p: Partial<Pending>) => setItems((list) => list.map((i) => (i.localId === localId ? { ...i, ...p } : i)));

  const addFiles = async (files: FileList | File[]) => {
    setNotice(null);
    const list = Array.from(files);
    const room = maxFiles - itemsRef.current.length;
    if (list.length > room) setNotice(`You can attach up to ${maxFiles} files per message.`);
    const accepted: { file: File; item: Pending }[] = [];
    for (const file of list.slice(0, Math.max(room, 0))) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const kind = VIDEO_EXT.includes(ext) ? "video" : IMAGE_EXT.includes(ext) ? "image" : null;
      if (!kind) {
        setNotice(`"${file.name}" isn't a supported video or image file.`);
        continue;
      }
      if (file.size > maxUploadMB * 1048576) {
        setNotice(`"${file.name}" is larger than the ${maxUploadMB} MB limit.`);
        continue;
      }
      const item: Pending = {
        localId: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        kind,
        previewUrl: URL.createObjectURL(file),
        duration: null,
        progress: 0,
        status: "uploading",
      };
      accepted.push({ file, item });
    }
    if (!accepted.length) return;
    setItems((cur) => [...cur, ...accepted.map((a) => a.item)]);

    let conversationId: string;
    try {
      conversationId = await ensureConversation();
    } catch {
      accepted.forEach(({ item }) => patch(item.localId, { status: "error", error: "Couldn't start a conversation." }));
      return;
    }
    for (const { file, item } of accepted) {
      const up = uploadFile(file, conversationId, (p) => patch(item.localId, { progress: p, status: p >= 1 ? "processing" : "uploading" }));
      patch(item.localId, { abort: up.abort });
      up.promise
        .then((asset) => patch(item.localId, { status: "ready", asset, duration: asset.duration, progress: 1, abort: undefined }))
        .catch((err: Error) => patch(item.localId, { status: "error", error: err.message, abort: undefined }));
    }
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
  const canSend = !disabled && !sending && !uploading && (text.trim().length > 0 || ready.length > 0);

  const submit = async () => {
    if (!canSend) return;
    recognitionRef.current?.stop();
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

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    let lang = "en-IN";
    try {
      lang = localStorage.getItem("janux.voiceLang") || "en-IN";
    } catch {}
    rec.lang = lang;
    rec.interimResults = false;
    rec.continuous = true;
    const startText = text;
    let finalText = "";
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
      setText(`${startText}${startText && finalText ? " " : ""}${finalText.trim()}`);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => {
      setListening(false);
      setNotice("Voice input stopped. Check microphone permission and try again.");
    };
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  return (
    <div className="rounded-3xl border border-line bg-card shadow-[0_-8px_30px_rgba(0,0,0,0.35)] focus-within:border-accent/40">
      {items.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto px-3 pt-3" aria-label="Attachments">
          {items.map((i) => (
            <li key={i.localId} className="relative w-28 shrink-0 overflow-hidden rounded-xl border border-line bg-bg-2">
              <div className="relative h-16 bg-black">
                {i.asset?.thumbnailUrl ? (
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
                {(i.status === "uploading" || i.status === "processing") && (
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
                  {i.kind === "image" ? <ImageIcon size={10} className="shrink-0 text-muted" /> : <Film size={10} className="shrink-0 text-muted" />}
                  <span className="truncate">{i.name}</span>
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
          aria-label="Attach videos or images"
          title="Attach videos or images"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-card-2 hover:text-ink disabled:opacity-40"
        >
          <Paperclip size={19} />
        </button>
        <label htmlFor="composer-input" className="sr-only">
          Describe the video you want
        </label>
        <textarea
          id="composer-input"
          ref={textareaRef}
          rows={1}
          value={text}
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
          placeholder={items.length ? "Describe the video you want…" : "Describe your video…"}
          className="max-h-[200px] min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-6 text-ink placeholder:text-faint focus:outline-none focus-visible:outline-none"
        />
        {speechSupported && (
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
            aria-pressed={listening}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
              listening ? "bg-danger/20 text-danger" : "text-muted hover:bg-card-2 hover:text-ink"
            }`}
          >
            {listening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
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
      {uploading && <p className="px-4 pb-2 text-[11px] text-faint">Uploading… you can send once files finish checking.</p>}
    </div>
  );
}
