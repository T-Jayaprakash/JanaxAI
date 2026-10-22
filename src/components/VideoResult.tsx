"use client";

import { Download, History, PencilLine } from "lucide-react";
import { useState } from "react";
import { formatBytes, formatDuration, type PublicVersion } from "@/lib/client/api";

interface Suggestion {
  label: string;
  message: string;
}

/** Revision chips that send real instructions for edits the planner supports. */
function suggestionsFor(v: PublicVersion): Suggestion[] {
  const s = v.spec;
  if (!Array.isArray(s.clips)) return []; // motion graphics have no clip edit to revise
  const out: Suggestion[] = [];
  if (v.duration > 4) out.push({ label: "Make it shorter", message: "Make it shorter" });
  out.push(s.aspect === "9:16" ? { label: "Change to 16:9", message: "Change to 16:9" } : { label: "Change to 9:16", message: "Change to 9:16" });
  out.push(s.look === "cinematic" ? { label: "Try a different style", message: "Try a different style" } : { label: "More cinematic", message: "Make it more cinematic" });
  if (s.clips.length > 1) {
    out.push(s.transition.type === "none" ? { label: "Smooth transitions", message: "Add smooth transitions" } : { label: "Hard cuts", message: "Use hard cuts, no transitions" });
  }
  out.push(s.audio.keepOriginal ? { label: "Mute audio", message: "Mute the original audio" } : { label: "Restore audio", message: "Restore the original audio" });
  if (s.clips.length > 2) out.push({ label: "Remove 2nd clip", message: "Remove the second clip" });
  return out;
}

export function VideoResult({
  version,
  versions,
  showSuggestions,
  onSend,
  onRequestChanges,
}: {
  version: PublicVersion;
  versions: PublicVersion[];
  showSuggestions: boolean;
  onSend: (text: string) => void;
  onRequestChanges: () => void;
}) {
  const [viewingId, setViewingId] = useState(version.id);
  const viewing = versions.find((v) => v.id === viewingId) ?? version;
  const asset = viewing.asset;
  const vertical = viewing.height > viewing.width;

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-line bg-card animate-rise" aria-label={`Video version ${viewing.number}`}>
      <div className="flex justify-center bg-black">
        {asset ? (
          <video
            key={viewing.id}
            controls
            playsInline
            preload="metadata"
            poster={asset.thumbnailUrl ?? undefined}
            src={asset.url}
            className={vertical ? "max-h-[70vh] w-auto max-w-full" : "max-h-[70vh] w-full"}
            style={{ aspectRatio: `${viewing.width} / ${viewing.height}` }}
          />
        ) : (
          <p className="p-8 text-sm text-muted">This video file is no longer available.</p>
        )}
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent">Version {viewing.number}</span>
          <span>{formatDuration(viewing.duration)}</span>
          <span>
            {viewing.width}×{viewing.height}
          </span>
          {asset && <span>{formatBytes(asset.size)}</span>}
          <span>MP4 · H.264</span>
          <span className="inline-flex items-center gap-1 text-accent/90">● Exported</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {asset && (
            <a
              href={viewing.downloadUrl}
              download
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-sm font-medium text-bg hover:bg-accent-2"
            >
              <Download size={15} /> Download
            </a>
          )}
          <button
            type="button"
            onClick={onRequestChanges}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-sm hover:border-line-strong"
          >
            <PencilLine size={15} /> Request changes
          </button>
          {viewing.id !== version.id && (
            <button
              type="button"
              onClick={() => onSend(`Go back to version ${viewing.number}`)}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 px-3.5 py-2 text-sm text-accent hover:bg-accent/10"
            >
              Continue from version {viewing.number}
            </button>
          )}
        </div>

        {versions.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <History size={13} className="text-faint" aria-hidden="true" />
            <span className="sr-only">Versions:</span>
            {versions.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setViewingId(v.id)}
                aria-pressed={v.id === viewing.id}
                className={`rounded-full px-2.5 py-0.5 text-xs ${
                  v.id === viewing.id ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink"
                }`}
              >
                v{v.number}
              </button>
            ))}
          </div>
        )}

        {showSuggestions && (
          <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
            {suggestionsFor(version).map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => onSend(s.message)}
                className="rounded-full border border-line bg-bg-2 px-3 py-1.5 text-xs text-ink hover:border-accent/50 hover:text-accent"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
