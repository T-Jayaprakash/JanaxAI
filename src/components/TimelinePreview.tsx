"use client";

import { ArrowRightLeft, Film, ImageIcon } from "lucide-react";
import type { PublicAsset, PublicJob } from "@/lib/client/api";
import { ASPECT_LABELS, LOOK_LABELS, TRANSITION_LABELS } from "@/lib/spec";

const ts = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};

/** Compact, read-only view of the timeline the worker renders. */
export function TimelinePreview({ job, assets }: { job: PublicJob; assets: Record<string, PublicAsset> }) {
  const tl = job.timeline;
  if (!tl) return null;
  const total = tl.segments.reduce((s, x) => s + x.duration, 0) || 1;
  const spec = job.spec;
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="list" aria-label="Timeline segments">
        {tl.segments.map((seg) => {
          const a = assets[seg.assetId];
          return (
            <div key={seg.index} className="flex items-center gap-1.5" role="listitem">
              {seg.transitionIn !== "none" && (
                <span title={`${TRANSITION_LABELS[seg.transitionIn]} ${tl.transition.duration}s`} className="text-accent/80">
                  <ArrowRightLeft size={13} aria-label={`${TRANSITION_LABELS[seg.transitionIn]} transition`} />
                </span>
              )}
              <div
                className="shrink-0 overflow-hidden rounded-lg border border-line bg-bg-2"
                style={{ width: `${Math.max(84, Math.min(220, (seg.duration / total) * 560))}px` }}
              >
                <div className="relative h-14 bg-black">
                  {a?.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.thumbnailUrl} alt="" className="h-full w-full object-cover opacity-90" />
                  ) : null}
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-ink">
                    #{seg.index + 1}
                  </span>
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-ink">
                    {seg.duration.toFixed(1)}s
                  </span>
                </div>
                <div className="px-2 py-1.5">
                  <p className="flex items-center gap-1 truncate text-[11px] text-ink" title={seg.name}>
                    {seg.mediaType === "image" ? <ImageIcon size={11} className="shrink-0 text-muted" /> : <Film size={11} className="shrink-0 text-muted" />}
                    <span className="truncate">{seg.name}</span>
                  </p>
                  <p className="font-mono text-[10px] text-faint">
                    {seg.mediaType === "image" ? "still" : `${ts(seg.srcStart)}–${ts(seg.srcEnd)}`}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <Fact k="Output" v={`${tl.width}×${tl.height}`} />
        <Fact k="Length" v={`~${tl.totalDuration.toFixed(1)}s`} />
        <Fact k="Shape" v={ASPECT_LABELS[spec.aspect]} />
        <Fact k="Transitions" v={tl.transition.type === "none" ? "hard cuts" : `${TRANSITION_LABELS[tl.transition.type]} ${tl.transition.duration}s`} />
        <Fact k="Look" v={LOOK_LABELS[spec.look]} />
        <Fact k="Audio" v={spec.audio.keepOriginal ? (spec.audio.volume === 1 ? "original" : `original ×${spec.audio.volume}`) : "muted"} />
        <Fact k="Framing" v={spec.fit === "blur" ? "blurred background" : spec.fit === "crop" ? "crop to fill" : "black bars"} />
        <Fact k="Fades" v={spec.fadeInOut ? "in & out" : "none"} />
      </dl>
      {tl.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {tl.notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-faint">{k}</dt>
      <dd className="truncate text-ink">{v}</dd>
    </div>
  );
}
