import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config";
import { SFX_TYPES } from "../studio/audioGen";
import { CAPTION_STYLES } from "./captions";
import { EMOJIS, emojiFile } from "./emoji";
import { fontFile, fontId, FONTS } from "./fonts";
import { LOOKS } from "./looks";
import { MEME_FORMATS } from "./memes";
import { STICKERS } from "./stickers";
import { OVERLAY_TRANSITIONS, XFADES } from "./transitions";
import { LICENSES, type AssetKind, type LibraryEntry, type License } from "./types";

export function libraryDir(): string {
  return path.join(/*turbopackIgnore: true*/ getConfig().dataDir, "library");
}

export function libraryInstalled(): boolean {
  return fs.existsSync(path.join(libraryDir(), "installed.json"));
}

/** The full searchable catalog, built from the asset modules. */
export function catalog(): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  for (const f of FONTS) {
    out.push({
      id: `font:${fontId(f.family)}`,
      kind: "font",
      name: f.family,
      tags: [f.style, ...f.scripts, ...f.tags],
      description: `${f.style} font, weights ${f.weights.join("/")}; scripts: ${f.scripts.join(", ")}.`,
      license: LICENSES.ofl,
      usage: `In render_animation HTML use font-family:'${f.family}' with font-weight ${f.weights.join("|")} (embedded automatically, works offline).`,
    });
  }
  for (const x of XFADES) {
    out.push({
      id: `transition:${x.name}`,
      kind: "transition",
      name: `xfade ${x.name}`,
      tags: ["xfade", ...x.tags],
      description: x.description,
      license: LICENSES.ffmpeg,
      usage: `run_ffmpeg filter: [a][b]xfade=transition=${x.name}:duration=0.4:offset=<seconds>`,
    });
  }
  for (const t of OVERLAY_TRANSITIONS) {
    out.push({
      id: `transition:${t.id}`,
      kind: "transition",
      name: t.name,
      tags: ["overlay", ...t.tags],
      description: `${t.description} (covers the screen at its midpoint; default ${t.defaultDuration}s).`,
      license: LICENSES.janux,
      usage: `render_transition style="${t.id}" → transparent .mov; overlay it starting ${"duration/2"} before a hard cut (overlay=enable='between(t,cut-d/2,cut+d/2)' with -itsoffset).`,
    });
  }
  for (const c of CAPTION_STYLES) {
    out.push({
      id: `caption:${c.id}`,
      kind: "caption_style",
      name: c.name,
      tags: c.tags,
      description: c.description,
      license: LICENSES.janux,
      usage: `render_captions preset="${c.id}" with the transcript words → transparent .mov overlay.`,
    });
  }
  for (const s of STICKERS) {
    out.push({
      id: `sticker:${s.id}`,
      kind: "sticker",
      name: s.name,
      tags: s.tags,
      description: s.description,
      license: LICENSES.janux,
      usage: `get_asset id="sticker:${s.id}" returns an HTML snippet to place in render_animation (replace {{text}}, {{color}}, {{delay}}).`,
    });
  }
  for (const e of EMOJIS) {
    out.push({
      id: `emoji:${e.name}`,
      kind: "emoji",
      name: `${e.char} ${e.name}`,
      tags: e.tags,
      description: `Animated ${e.char} emoji (Lottie).`,
      license: LICENSES.notoEmoji,
      usage: `In render_animation: <div data-janux-emoji="${e.name}" data-start="<seconds>" style="position:absolute;width:220px;height:220px;left:..;top:.."></div>. In render_captions: put "emoji":"${e.name}" on a word.`,
    });
  }
  for (const t of SFX_TYPES) {
    out.push({
      id: `sfx:${t}`,
      kind: "sfx",
      name: t,
      tags: ["sound effect", t.split("-")[0]],
      description: `Synthesised ${t} sound effect.`,
      license: LICENSES.janux,
      usage: `generate_sound_effect type="${t}" → .wav, then mix with adelay + amix.`,
    });
  }
  for (const m of MEME_FORMATS) {
    out.push({ id: `meme:${m.id}`, kind: "meme_format", name: m.name, tags: ["meme", ...m.tags], description: m.description, license: LICENSES.janux, usage: m.recipe });
  }
  for (const l of LOOKS) {
    out.push({
      id: `look:${l.id}`,
      kind: "look",
      name: l.name,
      tags: ["color grade", "lut", ...l.tags],
      description: l.description,
      license: LICENSES.janux,
      usage: `run_ffmpeg filter: lut3d=lib/looks/${l.id}.cube (mix with the original using blend for a lighter look).`,
    });
  }
  return out;
}

/** Simple keyword search over names, tags and descriptions. */
export function searchLibrary(query: string, kind?: AssetKind, limit = 12): LibraryEntry[] {
  const terms = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const scored = catalog()
    .filter((e) => !kind || e.kind === kind)
    .map((e) => {
      const hay = `${e.name} ${e.tags.join(" ")} ${e.description}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (e.name.toLowerCase().includes(t)) score += 4;
        if (e.tags.some((tag) => tag.includes(t))) score += 3;
        if (hay.includes(t)) score += 1;
      }
      return { e, score: terms.length ? score : 1 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.e);
}

export function findEntry(id: string): LibraryEntry | undefined {
  return catalog().find((e) => e.id === id);
}

// ---- Rendering helpers -------------------------------------------------

/** @font-face rules (data URIs) for every library family mentioned in the HTML. */
export function fontFaceCss(html: string): { css: string; used: string[] } {
  const used: string[] = [];
  const rules: string[] = [];
  for (const f of FONTS) {
    if (!html.includes(f.family)) continue;
    let any = false;
    for (const w of f.weights) {
      const file = path.join(libraryDir(), fontFile(f.family, w));
      if (!fs.existsSync(file)) continue;
      any = true;
      rules.push(`@font-face{font-family:'${f.family}';font-weight:${w};font-display:block;src:url(data:font/ttf;base64,${fs.readFileSync(file).toString("base64")}) format('truetype')}`);
    }
    if (any) used.push(`font:${fontId(f.family)}`);
  }
  return { css: rules.join("\n"), used };
}

let lottieJs: string | null = null;

/**
 * Runtime that turns <div data-janux-emoji="name" data-start="s"> into
 * animated Noto emoji and seeks them with the frame clock.
 */
export function emojiRuntime(html: string): { script: string; used: string[] } {
  const names = [...new Set([...html.matchAll(/data-janux-emoji=["']([a-z0-9-]+)["']/g)].map((m) => m[1]))];
  // Caption overlays add emoji at render time; scan their data too.
  for (const m of html.matchAll(/"emoji":"([a-z0-9-]+)"/g)) if (!names.includes(m[1])) names.push(m[1]);
  if (!names.length) return { script: "", used: [] };
  const data: Record<string, unknown> = {};
  const used: string[] = [];
  for (const n of names) {
    const e = EMOJIS.find((x) => x.name === n);
    if (!e) continue;
    const file = path.join(libraryDir(), emojiFile(e.code));
    if (!fs.existsSync(file)) continue;
    data[n] = JSON.parse(fs.readFileSync(file, "utf8"));
    used.push(`emoji:${n}`);
  }
  if (!used.length) return { script: "", used: [] };
  if (!lottieJs) {
    const p = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "lottie-web", "build", "player", "lottie.min.js");
    lottieJs = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  }
  if (!lottieJs) return { script: "", used: [] };
  const script = `<script>${lottieJs}</script><script>
(function(){const D=${JSON.stringify(data)};const live=[];
function scan(){document.querySelectorAll('[data-janux-emoji]').forEach(el=>{if(el.__jx)return;const d=D[el.getAttribute('data-janux-emoji')];if(!d)return;
el.__jx=lottie.loadAnimation({container:el,renderer:'svg',loop:false,autoplay:false,animationData:d});el.__start=parseFloat(el.getAttribute('data-start')||'0');live.push(el)})}
window.__januxEmojiScan=scan;scan();
window.__januxLibSeek=function(t){scan();live.forEach(el=>{if(!el.isConnected)return;const a=el.__jx;const fr=a.frameRate||60;const total=a.totalFrames;const local=Math.max(0,t-el.__start);
el.style.opacity=t<el.__start?'0':'1';a.goToAndStop(Math.min(total-1,(local*fr)%(total)),true)})};})();</script>`;
  return { script, used };
}

/** Licence credits for a list of used asset ids (deduplicated). */
export function creditsFor(ids: string[]): { id: string; license: License }[] {
  const seen = new Set<string>();
  const out: { id: string; license: License }[] = [];
  for (const id of ids) {
    const entry = findEntry(id);
    if (!entry?.license.attribution || seen.has(entry.license.attribution)) continue;
    seen.add(entry.license.attribution);
    out.push({ id, license: entry.license });
  }
  return out;
}
