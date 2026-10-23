"use client";

import { Loader2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes, formatDuration, kitApi, type KitItemView, type KitKind } from "@/lib/client/api";

const UPLOAD_KINDS: { id: Exclude<KitKind, "style">; label: string; accept: string; hint: string }[] = [
  { id: "font", label: "Font", accept: ".ttf,.otf,.woff,.woff2", hint: "Your brand typeface (TTF, OTF, WOFF)" },
  { id: "lut", label: "Colour LUT", accept: ".cube", hint: "A .cube 3D LUT for your signature grade" },
  { id: "logo", label: "Logo", accept: ".png,.jpg,.jpeg,.webp", hint: "Transparent PNG works best" },
  { id: "image", label: "Image / graphic", accept: ".png,.jpg,.jpeg,.webp", hint: "Backgrounds, frames, product shots" },
  { id: "overlay", label: "Video element", accept: ".mov,.webm,.mp4,.gif", hint: "Light leaks, overlays, animated graphics" },
  { id: "sfx", label: "Sound effect", accept: ".wav,.mp3,.m4a,.aac,.ogg,.flac", hint: "Your signature whoosh, jingle or sting" },
  { id: "music", label: "Music", accept: ".mp3,.wav,.m4a,.aac,.ogg,.flac", hint: "Tracks you have the rights to use" },
];

const KIND_LABEL: Record<KitKind, string> = { font: "Font", lut: "Colour look", logo: "Logo", image: "Image", overlay: "Video element", sfx: "Sound effect", music: "Music", style: "Style" };

/** My Kit: the user's own fonts, looks, logos, elements, sounds and saved styles. */
export function KitTab({ onUse }: { onUse: (text: string) => void }) {
  const [items, setItems] = useState<KitItemView[] | null>(null);
  const [kind, setKind] = useState<Exclude<KitKind, "style">>("font");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [credit, setCredit] = useState("");
  const [rights, setRights] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [styleName, setStyleName] = useState("");
  const [styleNotes, setStyleNotes] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    kitApi.list().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  useEffect(refresh, [refresh]);

  const current = UPLOAD_KINDS.find((k) => k.id === kind)!;

  async function upload(file: File) {
    setError(null);
    setProgress(0);
    try {
      await kitApi.upload(file, { kind, name, notes, credit }, setProgress);
      setName("");
      setNotes("");
      setCredit("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function addStyle() {
    setError(null);
    try {
      await kitApi.saveStyle(styleName, styleNotes);
      setStyleName("");
      setStyleNotes("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the style.");
    }
  }

  async function remove(id: string) {
    await kitApi.remove(id).catch(() => undefined);
    refresh();
  }

  const fonts = (items ?? []).filter((i) => i.kind === "font" && i.family);
  const field = "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm focus:border-line-strong focus:outline-none";

  return (
    <div className="space-y-6">
      <style>{fonts.map((f) => `@font-face{font-family:'kit-${f.id}';src:url(/api/kit/${f.id}/file)}`).join("")}</style>

      <section className="rounded-xl border border-line bg-card p-4">
        <h3 className="text-sm font-semibold">Add to your kit</h3>
        <p className="mt-0.5 text-xs text-muted">The editor uses your own fonts, looks, logo and elements first, in every edit.</p>
        <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Resource type">
          {UPLOAD_KINDS.map((k) => (
            <button
              key={k.id}
              role="radio"
              aria-checked={kind === k.id}
              onClick={() => setKind(k.id)}
              className={`rounded-full px-3 py-1 text-xs ${kind === k.id ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-faint">{current.hint}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={kind === "font" ? "Font name, e.g. Brand Sans" : "Name"} aria-label="Name" />
          <input className={field} value={credit} onChange={(e) => setCredit(e.target.value)} maxLength={200} placeholder="Credit line (optional)" aria-label="Credit line" />
          <input className={`${field} sm:col-span-2`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="When to use it (optional), e.g. headlines only" aria-label="Notes" />
        </div>
        <label className="mt-3 flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5" />
          I own this or have a licence that lets me use it in my videos.
        </label>
        <input ref={fileRef} type="file" accept={current.accept} className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <button
          disabled={!rights || progress !== null}
          onClick={() => fileRef.current?.click()}
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-xs font-medium text-bg disabled:opacity-40"
        >
          {progress !== null ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : `Choose ${current.label.toLowerCase()} file`}
        </button>
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-card p-4">
        <h3 className="text-sm font-semibold">Save a style</h3>
        <p className="mt-0.5 text-xs text-muted">Describe how you like your videos edited. You can also say “save this as my style” in the chat.</p>
        <input className={`${field} mt-3`} value={styleName} onChange={(e) => setStyleName(e.target.value)} maxLength={80} placeholder="Style name, e.g. Shop reels" aria-label="Style name" />
        <textarea
          className={`${field} mt-2 min-h-24`}
          value={styleNotes}
          onChange={(e) => setStyleNotes(e.target.value)}
          maxLength={4000}
          placeholder="e.g. Clean white captions in Brand Sans, warm grade, cuts on the beat, no emoji, soft whoosh only on section changes, logo bottom-right at the end."
          aria-label="Style description"
        />
        <button disabled={!styleName.trim() || !styleNotes.trim()} onClick={addStyle} className="mt-2 rounded-full border border-line px-4 py-2 text-xs text-ink hover:border-line-strong disabled:opacity-40">
          Save style
        </button>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Your kit{items ? ` (${items.length})` : ""}</h3>
        {items === null ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted">Nothing here yet. Add your brand font, logo or a saved style above.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((i) => (
              <li key={i.id} className="flex flex-col rounded-xl border border-line bg-card p-4">
                {i.kind === "font" && (
                  <p className="mb-2 truncate text-2xl" style={{ fontFamily: `'kit-${i.id}'` }}>
                    வணக்கம் Trichy
                  </p>
                )}
                {(i.kind === "logo" || i.kind === "image") && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/kit/${i.id}/file`} alt="" className="mb-2 h-24 w-full rounded-lg bg-[repeating-conic-gradient(#2a2a2a_0%_25%,#1f1f1f_0%_50%)] bg-[length:16px_16px] object-contain" />
                )}
                {i.kind === "overlay" && <video src={`/api/kit/${i.id}/file`} muted loop playsInline autoPlay className="mb-2 h-24 w-full rounded-lg bg-black object-contain" />}
                {(i.kind === "sfx" || i.kind === "music") && <audio src={`/api/kit/${i.id}/file`} controls preload="none" className="mb-2 w-full" />}
                <p className="text-sm font-medium">{i.kind === "font" ? i.family : i.name}</p>
                <p className="text-[11px] text-faint">
                  {KIND_LABEL[i.kind]}
                  {i.meta.duration ? ` · ${formatDuration(i.meta.duration)}` : ""}
                  {i.meta.width ? ` · ${i.meta.width}×${i.meta.height}` : ""}
                  {i.meta.lutSize ? ` · ${i.meta.lutSize}³ LUT` : ""}
                  {i.meta.alpha ? " · transparent" : ""}
                  {i.size ? ` · ${formatBytes(i.size)}` : ""}
                </p>
                {i.notes && <p className={`mt-1 text-xs text-muted ${i.kind === "style" ? "line-clamp-4" : "line-clamp-2"}`}>{i.notes}</p>}
                {i.credit && <p className="mt-1 text-[11px] text-faint">Credit: {i.credit}</p>}
                <div className="mt-auto flex items-center gap-2 pt-3">
                  <button onClick={() => remove(i.id)} aria-label={`Delete ${i.name}`} className="grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-bg-2 hover:text-danger">
                    <Trash2 size={13} />
                  </button>
                  <button
                    onClick={() => onUse(i.kind === "style" ? `Edit this in my "${i.name}" style (kit:${i.id}).` : `Use my ${KIND_LABEL[i.kind].toLowerCase()} "${i.kind === "font" ? i.family : i.name}" (kit:${i.id}) in this video.`)}
                    className="ml-auto rounded-full border border-line px-2.5 py-1 text-[11px] text-muted hover:border-line-strong hover:text-ink"
                  >
                    Use
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
