"use client";

import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";

interface Entry {
  id: string;
  kind: string;
  name: string;
  description: string;
  tags: string[];
  license: string;
  preview:
    | { type: "font"; family: string; weight: number; tamil: boolean }
    | { type: "caption"; font: string; weight: number; color: string; activeColor: string; box: string | null; uppercase: boolean }
    | { type: "emoji"; char: string }
    | { type: "none" };
}

const KINDS: { id: string; label: string }[] = [
  { id: "font", label: "Fonts" },
  { id: "caption_style", label: "Captions" },
  { id: "transition", label: "Transitions" },
  { id: "sticker", label: "Stickers" },
  { id: "emoji", label: "Emoji" },
  { id: "sfx", label: "Sound FX" },
  { id: "look", label: "Looks" },
  { id: "meme_format", label: "Meme formats" },
];

/** Browse the asset library the editor uses. Ask for anything here by name in the chat. */
export function LibraryPanel({ onClose, onUse }: { onClose: () => void; onUse: (text: string) => void }) {
  const [kind, setKind] = useState("font");
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ installed: boolean; counts: Record<string, number>; entries: Entry[] } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/library?kind=${kind}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then(setData)
        .catch(() => undefined);
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [kind, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fonts = (data?.entries ?? []).filter((e) => e.preview.type === "font") as (Entry & { preview: { type: "font"; family: string; weight: number } })[];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-[2px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Library" onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-2xl flex-col border-l border-line bg-bg-2 animate-rise">
        <style>{fonts.map((f) => `@font-face{font-family:'lib-${f.preview.family}';font-weight:${f.preview.weight};src:url(/api/library/font?family=${encodeURIComponent(f.preview.family)}&weight=${f.preview.weight})}`).join("")}</style>
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Library</h2>
            <p className="text-xs text-muted">Professional assets the editor uses. Ask for any of them by name.</p>
          </div>
          <button autoFocus onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink">
            <X size={17} />
          </button>
        </header>
        <div className="space-y-3 border-b border-line px-5 py-3">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-card px-3">
            <Search size={15} className="text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: tamil bold, glitch, sale, warm…" aria-label="Search the library" className="flex-1 bg-transparent py-2.5 text-sm focus:outline-none" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist">
            {KINDS.map((k) => (
              <button
                key={k.id}
                role="tab"
                aria-selected={kind === k.id}
                onClick={() => setKind(k.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs ${kind === k.id ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink"}`}
              >
                {k.label}
                {data?.counts[k.id] ? <span className="ml-1 opacity-60">{data.counts[k.id]}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {data && !data.installed && (
            <p className="mb-4 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn">The library files aren&apos;t downloaded yet. Run: npm run setup:library</p>
          )}
          <ul className="grid gap-3 sm:grid-cols-2">
            {(data?.entries ?? []).map((e) => (
              <li key={e.id} className="flex flex-col rounded-xl border border-line bg-card p-4">
                {e.preview.type === "font" && (
                  <p className="mb-2 truncate text-2xl" style={{ fontFamily: `'lib-${e.preview.family}'`, fontWeight: e.preview.weight }}>
                    {e.preview.tamil ? "வணக்கம் Trichy" : "Just tell it."}
                  </p>
                )}
                {e.preview.type === "caption" && (
                  <p className="mb-2 rounded-lg bg-[#2a2f3a] px-3 py-3 text-center text-lg" style={{ fontWeight: e.preview.weight, textTransform: e.preview.uppercase ? "uppercase" : "none" }}>
                    <span style={{ color: e.preview.color === "transparent" ? "#fff" : e.preview.color, WebkitTextStroke: "1px #000" }}>make it </span>
                    <span style={{ color: e.preview.activeColor, background: e.preview.box ?? undefined, borderRadius: 6, padding: e.preview.box ? "0 6px" : 0, WebkitTextStroke: "1px #000" }}>viral</span>
                  </p>
                )}
                {e.preview.type === "emoji" && <p className="mb-1 text-4xl">{e.preview.char}</p>}
                <p className="text-sm font-medium">{e.name}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{e.description}</p>
                <div className="mt-auto flex items-center gap-2 pt-3">
                  <span className="truncate text-[10px] text-faint" title={e.license}>
                    {e.license}
                  </span>
                  <button
                    onClick={() => onUse(`Use the ${e.name} ${KINDS.find((k) => k.id === e.kind)?.label.replace(/s$/, "").toLowerCase() ?? "asset"} (${e.id}) in my video.`)}
                    className="ml-auto shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted hover:border-line-strong hover:text-ink"
                  >
                    Use
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
