"use client";

import { AudioLines, Check, Film, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { LogoMark } from "../Logo";

const STEPS = [
  "Watching your footage",
  "Listening · Tamil detected",
  "Cutting 6 pauses and 1 retake",
  "Finding the beat · 118 BPM",
  "Animating captions",
  "Checking the edit",
];

const WORDS = [
  { w: "இன்னைக்கு", e: "" },
  { w: "Trichy-ல", e: "📍" },
  { w: "best", e: "" },
  { w: "sweet", e: "🍬" },
  { w: "shop", e: "" },
  { w: "காட்டப்போறேன்", e: "🔥" },
];

/** An illustration of the studio flow (not a recording), looping gently. */
export function StudioDemo() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const t = setTimeout(() => setTick(40), 0);
      return () => clearTimeout(t);
    }
    const t = setInterval(() => setTick((x) => (x + 1) % 44), 450);
    return () => clearInterval(t);
  }, []);
  const stepDone = Math.min(STEPS.length, Math.max(0, Math.floor((tick - 3) / 3)));
  const showVideo = tick >= 3 + STEPS.length * 3;
  const word = showVideo ? Math.floor((tick - (3 + STEPS.length * 3)) / 2) % WORDS.length : -1;

  return (
    <div className="relative mx-auto grid max-w-5xl items-center gap-6 md:grid-cols-[1.2fr_1fr]" aria-label="Illustration of editing in the JANUXAI studio">
      <div className="rounded-3xl border border-line bg-card/80 p-5 shadow-2xl shadow-black/40">
        <div className="flex justify-end">
          <div className="max-w-[85%] space-y-2">
            <div className="flex justify-end gap-2">
              <span className="flex items-center gap-1.5 rounded-xl border border-line bg-bg-2 px-3 py-2 text-xs text-muted">
                <Film size={13} className="text-accent" /> shop_vlog_raw.mp4 · 2:41
              </span>
            </div>
            <div className="rounded-2xl rounded-br-md bg-card-2 px-4 py-3 text-sm">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
                <AudioLines size={12} className="text-accent" /> Voice note · Tamil
              </p>
              “இதை ஒரு reel-ஆ பண்ணு, தப்பெல்லாம் வெட்டிடு, mass captions போடு”
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <LogoMark size={24} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">சரி! உங்க footage-ஐ பார்த்து reel ரெடி பண்றேன்.</p>
            <ul className="mt-3 space-y-1.5">
              {STEPS.map((s, i) => {
                const state = i < stepDone ? "done" : i === stepDone && !showVideo ? "active" : "pending";
                return (
                  <li key={s} className={`flex items-center gap-2 text-sm transition-opacity ${state === "pending" ? "opacity-35" : "opacity-100"}`}>
                    {state === "done" ? (
                      <Check size={14} className="text-accent" />
                    ) : state === "active" ? (
                      <Loader2 size={14} className="animate-spin text-accent" />
                    ) : (
                      <span className="ml-1 mr-1 h-1.5 w-1.5 rounded-full bg-faint" />
                    )}
                    <span className={state === "done" ? "text-muted" : "text-ink"}>{s}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      <div className="mx-auto w-[220px] sm:w-[250px]">
        <div className="relative aspect-[9/16] overflow-hidden rounded-[28px] border-4 border-card-2 bg-black shadow-2xl shadow-black/60">
          <div
            className={`absolute inset-0 transition-opacity duration-700 ${showVideo ? "opacity-100" : "opacity-30"}`}
            style={{
              background:
                "radial-gradient(80% 60% at 30% 25%, #f7c27a 0%, transparent 60%), radial-gradient(70% 60% at 75% 70%, #b8452c 0%, transparent 65%), linear-gradient(160deg, #3a1f12, #1a0f0a)",
            }}
          />
          <div className="absolute inset-x-6 top-[22%] h-24 rounded-2xl bg-white/10 blur-[1px]" />
          <div className="absolute bottom-[26%] left-1/2 h-20 w-20 -translate-x-1/2 rounded-full bg-[#f2a33a]/30 blur-xl" />
          {showVideo && word >= 0 && (
            <div className="absolute inset-x-3 bottom-[18%] text-center">
              <span className="block text-2xl drop-shadow">{WORDS[word].e}</span>
              <span
                key={word}
                className="inline-block animate-rise font-sans text-[22px] font-extrabold uppercase tracking-tight text-[#ffc46b]"
                style={{ textShadow: "0 3px 0 #000, 0 0 12px rgba(0,0,0,.6)", WebkitTextStroke: "1px #000" }}
              >
                {WORDS[word].w}
              </span>
            </div>
          )}
          {!showVideo && (
            <div className="absolute inset-0 grid place-items-center">
              <span className="rounded-full bg-black/50 px-3 py-1 text-xs text-ink/80">Editing…</span>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
            <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${showVideo ? ((word + 1) / WORDS.length) * 100 : (stepDone / STEPS.length) * 100}%` }} />
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-faint">Illustration · 1080×1920 reel</p>
      </div>
    </div>
  );
}
