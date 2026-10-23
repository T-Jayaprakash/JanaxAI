"use client";

import { Check, ChevronRight, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Markdown } from "./Markdown";

export interface TimelineStep {
  label: string;
  status: "running" | "done" | "failed";
  at?: number;
  images?: string[];
  detail?: string;
  progress?: number;
}

type Segment = { kind: "text"; text: string } | { kind: "steps"; steps: TimelineStep[] };

/** Splits the reply text at the points where steps happened, like a work log. */
function buildSegments(text: string, steps: TimelineStep[]): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  let group: TimelineStep[] = [];
  const flushGroup = () => {
    if (group.length) out.push({ kind: "steps", steps: group });
    group = [];
  };
  for (const s of steps) {
    const at = Math.min(Math.max(s.at ?? cursor, cursor), text.length);
    const before = text.slice(cursor, at);
    if (before.trim()) {
      flushGroup();
      out.push({ kind: "text", text: before });
    }
    cursor = at;
    group.push(s);
  }
  flushGroup();
  const rest = text.slice(cursor);
  if (rest.trim()) out.push({ kind: "text", text: rest });
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Watched 3 clips, listened to 1 file, made 2 edits" */
function summarize(steps: TimelineStep[]): string {
  const counts = { watch: 0, look: 0, listen: 0, beat: 0, animate: 0, deliver: 0, other: 0 };
  for (const s of steps) {
    const l = s.label.toLowerCase();
    if (l.startsWith("watching")) counts.watch++;
    else if (l.startsWith("looking closely") || l.startsWith("checking")) counts.look++;
    else if (l.startsWith("listening")) counts.listen++;
    else if (l.startsWith("finding the beat")) counts.beat++;
    else if (l.startsWith("animating")) counts.animate++;
    else if (l.startsWith("delivering")) counts.deliver++;
    else counts.other++;
  }
  const parts: string[] = [];
  if (counts.watch) parts.push(`watched ${plural(counts.watch, "clip", "clips")}`);
  if (counts.listen) parts.push(`listened to ${plural(counts.listen, "file", "files")}`);
  if (counts.beat) parts.push("found the beat");
  if (counts.look) parts.push(`checked ${plural(counts.look, "set of frames", "sets of frames")}`);
  if (counts.other) parts.push(`made ${plural(counts.other, "edit", "edits")}`);
  if (counts.animate) parts.push(`animated ${plural(counts.animate, "graphic", "graphics")}`);
  if (counts.deliver) parts.push("delivered the video");
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function ReplyTimeline({
  text,
  steps,
  streaming,
  conversationId,
}: {
  text: string;
  steps: TimelineStep[];
  streaming: boolean;
  conversationId: string;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const imageUrl = (rel: string) => `/api/conversations/${conversationId}/workspace?path=${encodeURIComponent(rel)}`;
  const segments = buildSegments(text, steps);
  return (
    <div className="space-y-3">
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <div key={i} className={streaming && i === segments.length - 1 ? "typing-caret" : undefined}>
            <Markdown text={seg.text} />
          </div>
        ) : (
          <StepGroup key={i} steps={seg.steps} imageUrl={imageUrl} onOpen={setLightbox} />
        ),
      )}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function StepGroup({ steps, imageUrl, onOpen }: { steps: TimelineStep[]; imageUrl: (rel: string) => string; onOpen: (src: string) => void }) {
  const running = steps.find((s) => s.status === "running");
  const failed = steps.filter((s) => s.status === "failed").length;
  const [open, setOpen] = useState(false);
  const thumbs = steps.flatMap((s) => s.images ?? []).slice(-3);

  return (
    <div className="rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex w-full items-center gap-2 py-1 text-left text-sm text-muted hover:text-ink"
      >
        {running ? <Loader2 size={14} className="shrink-0 animate-spin text-ink" /> : null}
        <span className="min-w-0 flex-1 truncate">
          {running ? (
            <span className="text-ink">
              {running.label}
              {running.progress !== undefined ? ` · ${Math.round(running.progress * 100)}%` : "…"}
            </span>
          ) : (
            summarize(steps)
          )}
          {!running && failed > 0 && <span className="text-faint"> · {plural(failed, "step retried", "steps retried")}</span>}
        </span>
        <ChevronRight size={14} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        {thumbs.length > 0 && (
          <span className="ml-2 flex shrink-0 -space-x-3">
            {thumbs.map((t) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={t} src={imageUrl(t)} alt="" className="h-9 w-14 rounded-md border border-line object-cover shadow" />
            ))}
          </span>
        )}
      </button>
      {running && running.progress !== undefined && (
        <div className="mt-1 h-0.5 w-full max-w-sm overflow-hidden rounded-full bg-line" aria-hidden="true">
          <div className="h-full bg-ink transition-[width] duration-500" style={{ width: `${Math.round(running.progress * 100)}%` }} />
        </div>
      )}
      {open && (
        <ol className="mt-2 space-y-2 border-l border-line pl-4">
          {steps.map((s, i) => (
            <li key={i} className="text-sm">
              <div className="flex items-center gap-2">
                {s.status === "done" ? (
                  <Check size={13} className="shrink-0 text-ink" />
                ) : s.status === "running" ? (
                  <Loader2 size={13} className="shrink-0 animate-spin text-ink" />
                ) : (
                  <X size={13} className="shrink-0 text-danger" />
                )}
                <span className={s.status === "failed" ? "text-danger" : "text-ink"}>{s.label}</span>
              </div>
              {s.detail && <p className="ml-5 mt-0.5 break-words text-xs text-faint">{s.detail}</p>}
              {s.images && s.images.length > 0 && (
                <div className="ml-5 mt-2 flex flex-wrap gap-2">
                  {s.images.map((img) => (
                    <button key={img} type="button" onClick={() => onOpen(imageUrl(img))} className="overflow-hidden rounded-lg border border-line hover:border-line-strong">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageUrl(img)} alt="What the editor looked at" className="h-24 w-auto max-w-[260px] object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Preview" className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-6" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="What the editor looked at" className="max-h-full max-w-full rounded-xl" />
      <button type="button" aria-label="Close" onClick={onClose} className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full border border-line-strong text-ink">
        <X size={18} />
      </button>
    </div>
  );
}
