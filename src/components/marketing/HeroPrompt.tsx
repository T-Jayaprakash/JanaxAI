"use client";

import { ArrowUp, Paperclip, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { setHandoff } from "@/lib/client/handoff";

const EXAMPLES = [
  "Turn my raw vlog into a 30-second reel with mass captions",
  "இந்த வீடியோவை reel-ஆ மாத்தி, தமிழ் captions போடு",
  "Cut my mistakes and pauses, keep my voice clear",
  "Make a product promo from these clips, cuts on the beat",
  "Oru 5 second intro venum, en channel name-oda",
  "Clip the best 40 seconds from my podcast",
];

const CHIPS = [
  { label: "Reel from raw footage", prompt: "Edit my raw footage into a vertical reel: cut the pauses and mistakes and keep the best parts." },
  { label: "Mass captions", prompt: "Add word-by-word animated captions with emojis to my video." },
  { label: "Product promo", prompt: "Make a 20-second product promo reel from my clips with music on the beat." },
  { label: "Podcast clip", prompt: "Find the best 40-second moment in my podcast and make it a vertical short with captions." },
  { label: "Animated intro", prompt: "Make a 4-second animated intro with my channel name." },
  { label: "Beat-sync montage", prompt: "Cut my clips to the beat of this song as a fast montage." },
];

/** The landing page's main action: type or drop footage, continue in the studio. */
export function HeroPrompt() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [example, setExample] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 3200);
    return () => clearInterval(t);
  }, []);

  const go = (prompt = text) => {
    setHandoff({ prompt: prompt.trim(), files });
    router.push("/app");
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)].slice(0, 10));
        }}
        className={`rounded-3xl border bg-card/90 p-3 text-left shadow-[0_20px_80px_-20px_rgba(255,255,255,0.12)] backdrop-blur transition-colors ${
          dragging ? "border-accent" : "border-line-strong focus-within:border-accent/60"
        }`}
      >
        <label htmlFor="hero-prompt" className="sr-only">
          Describe your video
        </label>
        <textarea
          id="hero-prompt"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              go();
            }
          }}
          placeholder={EXAMPLES[example]}
          className="w-full resize-none bg-transparent px-2 pt-1 text-base leading-relaxed text-ink placeholder:text-faint focus:outline-none focus-visible:outline-none sm:text-lg"
        />
        {files.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2 px-1">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-full border border-line bg-bg-2 py-1 pl-3 pr-1 text-xs text-muted">
                <span className="max-w-[160px] truncate">{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="rounded-full p-0.5 hover:text-ink">
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="video/*,image/*,audio/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) setFiles((f) => [...f, ...Array.from(e.target.files!)].slice(0, 10));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-muted hover:border-line-strong hover:text-ink"
          >
            <Paperclip size={15} /> Add footage
          </button>
          <span className="hidden text-xs text-faint sm:inline">or drop clips, a song, a reference</span>
          <button
            type="submit"
            aria-label="Start editing"
            className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-accent text-bg transition-colors hover:bg-accent-2"
          >
            <ArrowUp size={19} strokeWidth={2.4} />
          </button>
        </div>
      </form>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            onClick={() => go(c.prompt)}
            className="rounded-full border border-line bg-bg-2/70 px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-accent/50 hover:text-ink"
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
