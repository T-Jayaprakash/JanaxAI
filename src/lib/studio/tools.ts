import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { insertAsset, type Asset } from "../assets";
import { BrandKitSchema, updateBrandKit } from "../brand";
import { getConfig } from "../config";
import { insertVersion, touchConversation } from "../conversations";
import { getDb, newId, now } from "../db";
import { renderHtmlToVideo } from "../graphics/render";
import { ffmpeg, MediaError } from "../media/ffmpeg";
import { makeThumbnail, probe } from "../media/probe";
import { LANGUAGE_NAMES, speechConfig } from "../speech/transcribe";
import type { EditSpec } from "../spec";
import { freeDiskBytes, getStorage } from "../storage";
import { addActivity, finishActivity, patchMeta, updateActivity } from "../agent/meta";
import { analyzeAudio } from "./audio";
import { makeSoundEffect, makeVoiceover, SFX_DEFAULT_DURATION, SFX_TYPES } from "./audioGen";
import { creditsFor, emojiRuntime, findEntry, fontFaceCss, libraryInstalled, searchLibrary } from "../library";
import { buildCaptionHtml, CAPTION_STYLES, type CaptionWord } from "../library/captions";
import { MEME_FORMATS } from "../library/memes";
import { STICKERS } from "../library/stickers";
import { OVERLAY_TRANSITIONS } from "../library/transitions";
import { checkFfmpegArgs } from "./ffmpegGuard";
import { inputName, resolveInWorkspace, syncWorkspace, workspaceDir } from "./workspace";
import { runProcess } from "../media/ffmpeg";

/**
 * The video studio toolkit. Claude edits like a human editor would: look at
 * the footage, listen to it, cut with FFmpeg, build motion graphics and
 * captions as HTML animations, check the result, then deliver. The same
 * tools are served to the Claude API (native tools) and to the local Claude
 * Code CLI (over MCP).
 */

export interface StudioContext {
  conversationId: string;
  messageId: string;
  runId: string;
  shouldCancel: () => boolean;
  /** Reports measured progress of the running step to the chat (0..1). */
  progress?: (fraction: number, detail?: string) => void;
}

export interface ToolOutput {
  text: string;
  /** Absolute paths of JPEG/PNG images to show Claude. */
  images?: string[];
  isError?: boolean;
}

interface StudioTool<S extends z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  /** Short label shown to the user while the tool runs. */
  label: (input: z.infer<S>) => string;
  run: (input: z.infer<S>, ctx: StudioContext) => Promise<ToolOutput>;
}

function tool<S extends z.ZodTypeAny>(t: StudioTool<S>): StudioTool<S> {
  return t;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Titles sometimes arrive HTML-escaped ("B&amp;W"); show them as typed. */
function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** Friendly name for labels: in/ast_x.mp4 → the user's original file name. */
function displayName(rel: string): string {
  const m = rel.match(/^in\/(ast_[a-f0-9]{32})/);
  if (m) {
    const row = getDb().prepare("SELECT original_name FROM assets WHERE id = ?").get(m[1]) as { original_name: string } | undefined;
    if (row) return row.original_name;
  }
  return path.basename(rel);
}
const RelPath = z.string().min(3).max(200).describe("Workspace path, e.g. in/ast_....mp4 or work/cut.mp4");

function describeAsset(a: Asset): string {
  const bits = [inputName(a), a.kind === "output" ? "made by JANUXAI" : "uploaded", a.mediaType, `"${a.originalName}"`];
  if (a.duration) bits.push(`${a.duration.toFixed(2)}s`);
  if (a.width && a.height) bits.push(`${a.width}x${a.height}`);
  if (a.metadata.fps) bits.push(`${a.metadata.fps}fps`);
  if (a.mediaType === "video") bits.push(a.hasAudio ? "has audio" : "no audio");
  if (a.metadata.voiceNote) bits.push(`VOICE NOTE (${LANGUAGE_NAMES[a.metadata.language ?? ""] ?? a.metadata.language}): "${a.metadata.transcript}"`);
  return `- ${bits.join(" · ")}`;
}

function listWork(dir: string): string[] {
  const work = path.join(dir, "work");
  if (!fs.existsSync(work)) return [];
  return fs.readdirSync(work).filter((f) => !f.startsWith(".")).map((f) => `work/${f}`);
}

const listMedia = tool({
  name: "list_media",
  description: "List every file you can use: the user's uploads, earlier JANUXAI outputs (in/...) and files you created (work/...).",
  schema: z.object({}),
  label: () => "Looking at your files",
  async run(_input, ctx) {
    const { dir, assets } = syncWorkspace(ctx.conversationId);
    const work = listWork(dir);
    return {
      text: [`Inputs:`, assets.length ? assets.map(describeAsset).join("\n") : "(none uploaded yet)", ``, `Work files:`, work.length ? work.join("\n") : "(none)"].join("\n"),
    };
  },
});

const inspectMedia = tool({
  name: "inspect_media",
  description:
    "See a video, image or audio file. Returns technical details and, for video, a contact sheet of evenly spaced frames (left-to-right, top-to-bottom) with their timestamps. Use start/end to zoom into a section. For images, returns the image itself (use this for reference images).",
  schema: z.object({
    path: RelPath,
    frames: z.number().int().min(4).max(48).optional().describe("How many frames to sample (default 16)"),
    start: z.number().min(0).optional(),
    end: z.number().positive().optional(),
  }),
  label: (i) => `Watching ${displayName(i.path)}`,
  async run(input, ctx) {
    syncWorkspace(ctx.conversationId);
    const file = resolveInWorkspace(ctx.conversationId, input.path, { mustExist: true });
    const info = await probe(file);
    const lines = [
      `${input.path}: ${info.format}, ${info.duration ? `${info.duration.toFixed(2)}s` : "still"}, ${info.width ?? "-"}x${info.height ?? "-"}, ${info.fps ?? "-"}fps, video ${info.videoCodec ?? "none"}, audio ${info.audioCodec ?? "none"}`,
    ];
    if (!info.hasVideo) return { text: lines.join("\n") + "\n(audio only: use transcribe or analyze_audio)" };
    const isStill = !info.duration || info.duration < 0.2 || /image|png|jpe?g|webp/.test(info.format);
    const out = path.join(path.dirname(resolveInWorkspace(ctx.conversationId, "cache/x")), `sheet-${Date.now()}.jpg`);
    if (isStill) {
      await ffmpeg(["-i", file, "-frames:v", "1", "-update", "1", "-vf", "scale='min(1024,iw)':-2", "-q:v", "3", out], { timeoutMs: 30_000 });
      return { text: lines.join("\n"), images: [out] };
    }
    const start = Math.min(input.start ?? 0, info.duration! - 0.1);
    const end = Math.min(input.end ?? info.duration!, info.duration!);
    const n = input.frames ?? 16;
    const span = Math.max(0.2, end - start);
    const cols = n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const cellW = info.width && info.height && info.height > info.width ? 220 : 320;
    await ffmpeg(
      ["-ss", start.toFixed(3), "-t", span.toFixed(3), "-i", file, "-vf", `fps=${(n / span).toFixed(5)},scale=${cellW}:-2,tile=${cols}x${rows}:padding=4:color=black`, "-frames:v", "1", "-update", "1", "-q:v", "4", out],
      { timeoutMs: 120_000, shouldCancel: ctx.shouldCancel },
    );
    const times = Array.from({ length: n }, (_, k) => r2(start + (k + 0.5) * (span / n)));
    lines.push(`Contact sheet: ${n} frames, ${cols} per row. Timestamps: ${times.join(", ")}`);
    return { text: lines.join("\n"), images: [out] };
  },
});

const viewFrames = tool({
  name: "view_frames",
  description: "Look closely at specific moments of a video (up to 8 timestamps). Use it to pick shots and to check your own renders before delivering.",
  schema: z.object({ path: RelPath, times: z.array(z.number().min(0)).min(1).max(8) }),
  label: (i) => i.path.startsWith("work/") ? "Checking the edit" : `Looking closely at ${displayName(i.path)}`,
  async run(input, ctx) {
    syncWorkspace(ctx.conversationId);
    const file = resolveInWorkspace(ctx.conversationId, input.path, { mustExist: true });
    const images: string[] = [];
    const cache = path.dirname(resolveInWorkspace(ctx.conversationId, "cache/x"));
    for (const [i, t] of input.times.entries()) {
      const out = path.join(cache, `frame-${Date.now()}-${i}.jpg`);
      await ffmpeg(["-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-update", "1", "-vf", "scale='min(640,iw)':-2", "-q:v", "3", out], { timeoutMs: 30_000 });
      if (fs.existsSync(out)) images.push(out);
    }
    return { text: `Frames at ${input.times.join(", ")}s of ${input.path}.`, images };
  },
});

const transcribeTool = tool({
  name: "transcribe",
  description:
    "Speech-to-text with word-level timestamps for a video or audio file (auto-detects Tamil, English, Hindi, Malayalam, Telugu and more). Use it to find good takes, remove mistakes/fillers/silences, and time captions to each word.",
  schema: z.object({ path: RelPath }),
  label: (i) => `Listening to ${displayName(i.path)}`,
  async run(input, ctx) {
    syncWorkspace(ctx.conversationId);
    const file = resolveInWorkspace(ctx.conversationId, input.path, { mustExist: true });
    const cfg = speechConfig();
    if (!fs.existsSync(cfg.model)) return { text: "Speech recognition isn't installed (npm run setup:speech).", isError: true };
    const cacheDir = path.dirname(resolveInWorkspace(ctx.conversationId, "cache/x"));
    const key = `${path.basename(input.path)}-${fs.statSync(file).size}`;
    const cached = path.join(cacheDir, `words-${key}.json`);
    if (!fs.existsSync(cached)) {
      const wav = path.join(cacheDir, `${key}.wav`);
      await ffmpeg(["-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-t", "1800", wav], { timeoutMs: 300_000 });
      const base = path.join(cacheDir, `w-${key}`);
      await runProcess(cfg.cli, ["-m", cfg.model, "-l", "auto", "-f", wav, "-oj", "-of", base, "-np", "-ml", "1", "-sow", "-t", "4"], {
        timeoutMs: 900_000,
        shouldCancel: ctx.shouldCancel,
      });
      fs.rmSync(wav, { force: true });
      const raw = JSON.parse(fs.readFileSync(`${base}.json`, "utf8")) as { result?: { language?: string }; transcription?: { offsets: { from: number; to: number }; text: string }[] };
      const words = (raw.transcription ?? [])
        .map((w) => ({ s: r2(w.offsets.from / 1000), e: r2(w.offsets.to / 1000), w: w.text.trim() }))
        .filter((w) => w.w && !/^\[.*\]$/.test(w.w));
      fs.writeFileSync(cached, JSON.stringify({ language: raw.result?.language ?? "unknown", words }));
    }
    const data = JSON.parse(fs.readFileSync(cached, "utf8")) as { language: string; words: { s: number; e: number; w: string }[] };
    if (!data.words.length) return { text: "No speech found." };
    // Compact: one line per phrase (split on pauses > 0.6s), words with start times.
    const lines: string[] = [];
    let cur: string[] = [];
    let lineStart = data.words[0].s;
    for (let i = 0; i < data.words.length; i++) {
      const w = data.words[i];
      cur.push(`${w.w}@${w.s}`);
      const next = data.words[i + 1];
      if (!next || next.s - w.e > 0.6 || cur.length >= 14) {
        lines.push(`[${lineStart}-${w.e}] ${cur.join(" ")}`);
        cur = [];
        if (next) lineStart = next.s;
      }
    }
    return {
      text: `Language: ${LANGUAGE_NAMES[data.language] ?? data.language}. ${data.words.length} words. Format: [phrase start-end] word@start ...\nFull word list with end times is saved at ${path.relative(path.dirname(cacheDir), cached)} (JSON: {s,e,w}).\n${lines.join("\n")}`,
    };
  },
});

const analyzeAudioTool = tool({
  name: "analyze_audio",
  description: "Find the tempo (BPM), beat grid, strong accents/drops, silences and loudness curve of a song or any audio/video file, so cuts and effects can land on the beat.",
  schema: z.object({ path: RelPath }),
  label: (i) => `Finding the beat in ${displayName(i.path)}`,
  async run(input, ctx) {
    syncWorkspace(ctx.conversationId);
    const file = resolveInWorkspace(ctx.conversationId, input.path, { mustExist: true });
    const a = await analyzeAudio(file, path.dirname(resolveInWorkspace(ctx.conversationId, "cache/x")));
    return {
      text: [
        `Duration ${a.duration}s, tempo ≈ ${a.bpm ?? "unclear"} BPM.`,
        `Beats (${a.beats.length}): ${a.beats.slice(0, 160).join(", ")}${a.beats.length > 160 ? " …" : ""}`,
        `Accents: ${a.accents.slice(0, 80).join(", ")}`,
        `Silences: ${a.silences.map(([s, e]) => `${s}-${e}`).join(", ") || "none"}`,
        `Loudness per second (0-1): ${a.energyPerSecond.slice(0, 180).join(" ")}`,
      ].join("\n"),
    };
  },
});

const writeFileTool = tool({
  name: "write_file",
  description: "Write a small text file under work/ (an FFmpeg concat list, an .srt, a .cube LUT, JSON data for an animation).",
  schema: z.object({ path: RelPath, content: z.string().max(500_000) }),
  label: () => "Preparing edit data",
  async run(input, ctx) {
    syncWorkspace(ctx.conversationId);
    if (!/\.(txt|srt|cube|json|csv)$/i.test(input.path)) return { text: "Only .txt, .srt, .cube, .json or .csv files can be written.", isError: true };
    const file = resolveInWorkspace(ctx.conversationId, input.path, { writable: true });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, input.content);
    return { text: `Wrote ${input.path} (${input.content.length} chars).` };
  },
});

async function describeOutputs(conversationId: string, outputs: string[]): Promise<string[]> {
  const lines: string[] = [];
  for (const o of outputs) {
    const abs = resolveInWorkspace(conversationId, o);
    if (!fs.existsSync(abs)) {
      lines.push(`${o}: not created`);
      continue;
    }
    try {
      const i = await probe(abs);
      lines.push(`${o}: ${i.duration ? `${i.duration.toFixed(2)}s` : "image"}, ${i.width}x${i.height}, ${i.videoCodec ?? "no video"}${i.audioCodec ? ` + ${i.audioCodec}` : ", no audio"}, ${(fs.statSync(abs).size / 1048576).toFixed(1)} MB`);
    } catch {
      lines.push(`${o}: written (${fs.statSync(abs).size} bytes)`);
    }
  }
  return lines;
}

const runFfmpegTool = tool({
  name: "run_ffmpeg",
  description:
    "Run FFmpeg with an argument list (no 'ffmpeg' prefix, no shell quoting) from the workspace folder. Inputs: in/... or work/...; outputs must go to work/. Use for trimming, joining, scaling/cropping to 9:16, speed changes, zooms (zoompan/scale+crop), colour grading (eq, curves, colorbalance, lut3d), overlays (overlay of transparent .mov animations), audio mixing (amix, sidechaincompress for ducking, afade, loudnorm). Returns FFmpeg errors so you can fix and retry.",
  schema: z.object({
    args: z.array(z.string()).min(2).max(400),
    purpose: z.string().max(120).describe("What this step does, shown to the user (e.g. 'Cutting out the pauses')"),
  }),
  label: (i) => i.purpose,
  async run(input, ctx) {
    syncWorkspace(ctx.conversationId);
    if ((await freeDiskBytes()) < getConfig().minFreeDiskBytes) return { text: "The server is low on disk space.", isError: true };
    let plan;
    try {
      plan = checkFfmpegArgs(input.args);
    } catch (err) {
      return { text: err instanceof Error ? err.message : String(err), isError: true };
    }
    const cwd = path.dirname(resolveInWorkspace(ctx.conversationId, "work/x"));
    for (const o of plan.outputs) fs.mkdirSync(path.dirname(path.join(path.dirname(cwd), o)), { recursive: true });
    try {
      await runProcess(getConfig().ffmpegPath, ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", ...plan.args], {
        timeoutMs: getConfig().ffmpegTimeoutMs,
        shouldCancel: ctx.shouldCancel,
        cwd: path.dirname(cwd),
      });
    } catch (err) {
      const detail = err instanceof MediaError ? (err.diagnostic ?? err.userMessage) : String(err);
      return { text: `FFmpeg failed:\n${detail.slice(-3000)}`, isError: true };
    }
    return { text: `Done.\n${(await describeOutputs(ctx.conversationId, plan.outputs)).join("\n")}` };
  },
});

/**
 * Readies a composition for rendering: inlines workspace images, embeds the
 * library fonts it names, adds the animated-emoji runtime, and records which
 * library assets were used (for licence credits on delivery).
 */
function prepareComposition(conversationId: string, html: string): string {
  const withImages = inlineWorkspaceImages(conversationId, html);
  const fonts = fontFaceCss(withImages);
  const emoji = emojiRuntime(withImages);
  recordUsedAssets(conversationId, [...fonts.used, ...emoji.used]);
  const head = `${fonts.css ? `<style>${fonts.css}</style>` : ""}`;
  return `${head}${withImages}${emoji.script}`;
}

function usedAssetsFile(conversationId: string) {
  return resolveInWorkspace(conversationId, "cache/used-assets.json");
}

function recordUsedAssets(conversationId: string, ids: string[]) {
  if (!ids.length) return;
  const file = usedAssetsFile(conversationId);
  let current: string[] = [];
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  fs.writeFileSync(file, JSON.stringify([...new Set([...current, ...ids])]));
}

function readUsedAssets(conversationId: string): string[] {
  try {
    return JSON.parse(fs.readFileSync(usedAssetsFile(conversationId), "utf8"));
  } catch {
    return [];
  }
}

/** Inline workspace images referenced from HTML (src="in/..." or url(work/...)). */
function inlineWorkspaceImages(conversationId: string, html: string): string {
  return html.replace(/((?:in|work)\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|gif|svg))/g, (m) => {
    try {
      const abs = resolveInWorkspace(conversationId, m, { mustExist: true });
      if (fs.statSync(abs).size > 8 * 1024 * 1024) return m;
      const ext = path.extname(abs).slice(1).toLowerCase();
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : `image/${ext}`;
      return `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
    } catch {
      return m;
    }
  });
}

const renderAnimationTool = tool({
  name: "render_animation",
  description:
    "Render an HTML/CSS/JS composition to video, frame by frame. Use for motion graphics, animated titles, intros/outros, lower thirds, emoji pops, animated word-by-word captions and kinetic text. Animate with CSS @keyframes, or define window.__januxSeek = (seconds) => {...} to draw each frame from the time (best for captions synced to word timestamps). transparent=true gives a .mov with alpha to overlay on footage with run_ffmpeg; otherwise an .mp4. Images: reference in/... or work/... image paths directly in src or url().",
  schema: z.object({
    html: z.string().min(20).max(400_000),
    width: z.number().int().min(64).max(2160),
    height: z.number().int().min(64).max(3840),
    duration: z.number().min(0.5).max(180),
    fps: z.number().int().min(10).max(60).optional(),
    transparent: z.boolean().optional(),
    output: RelPath,
  }),
  label: (i) => (i.transparent ? "Animating captions and graphics" : "Animating motion graphics"),
  async run(input, ctx) {
    syncWorkspace(ctx.conversationId);
    const out = resolveInWorkspace(ctx.conversationId, input.output, { writable: true });
    if (input.transparent && !out.endsWith(".mov")) return { text: "Transparent animations must be saved as .mov.", isError: true };
    if (!input.transparent && !out.endsWith(".mp4")) return { text: "Opaque animations must be saved as .mp4.", isError: true };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const width = input.width - (input.width % 2);
    const height = input.height - (input.height % 2);
    try {
      await renderHtmlToVideo({
        html: prepareComposition(ctx.conversationId, input.html),
        width,
        height,
        duration: input.duration,
        fps: input.fps ?? 30,
        transparent: input.transparent,
        outPath: out,
        shouldCancel: ctx.shouldCancel,
        onProgress: (f) => ctx.progress?.(f, `Frame ${Math.round(f * input.duration * (input.fps ?? 30))} of ${Math.round(input.duration * (input.fps ?? 30))}`),
      });
    } catch (err) {
      return { text: `Render failed: ${err instanceof MediaError ? (err.diagnostic ?? err.userMessage).slice(-1500) : String(err)}`, isError: true };
    }
    return { text: `Rendered.\n${(await describeOutputs(ctx.conversationId, [input.output])).join("\n")}` };
  },
});

const searchLibraryTool = tool({
  name: "search_library",
  description:
    "Search JANUXAI's asset library: 80+ fonts (Tamil, Indian scripts, display, script), 58 xfade + 14 overlay transitions, 20 caption styles, animated stickers, 59 animated emoji, 30 sound effects, 10 colour looks (LUTs) and 12 meme formats. Search before designing so edits use professional assets. Returns ids and how to use each.",
  schema: z.object({
    query: z.string().max(200).describe("e.g. 'tamil bold headline font', 'glitch transition', 'karaoke captions', 'sale sticker', 'warm cinematic look'"),
    kind: z.enum(["font", "transition", "caption_style", "sticker", "emoji", "sfx", "meme_format", "look"]).optional(),
    limit: z.number().int().min(1).max(30).optional(),
  }),
  label: (i) => `Searching the library for “${i.query}”`,
  async run(input) {
    if (!libraryInstalled()) return { text: "The asset library isn't installed yet (npm run setup:library). Fonts from Google Fonts links still work.", isError: true };
    const hits = searchLibrary(input.query, input.kind, input.limit ?? 12);
    if (!hits.length) return { text: "Nothing matched. Try broader words, or a kind filter." };
    return { text: hits.map((h) => `- ${h.id} — ${h.name}: ${h.description}\n  use: ${h.usage}`).join("\n") };
  },
});

const getAssetTool = tool({
  name: "get_asset",
  description: "Get a library asset ready to use: a sticker's HTML snippet (with your text/colour/delay filled in), a meme format's full recipe, a caption style's settings, or a look/transition's details.",
  schema: z.object({
    id: z.string().max(80).describe("An id from search_library, e.g. sticker:price-tag"),
    text: z.string().max(200).optional(),
    color: z.string().max(40).optional(),
    delay: z.number().min(0).max(120).optional().describe("Seconds into the composition when it appears"),
  }),
  label: (i) => `Getting ${i.id.split(":")[1] ?? i.id} from the library`,
  async run(input) {
    const [kind, key] = input.id.split(":");
    if (kind === "sticker") {
      const st = STICKERS.find((x) => x.id === key);
      if (!st) return { text: "Unknown sticker.", isError: true };
      const snippet = st.snippet
        .replaceAll("{{text}}", (input.text ?? "TEXT").replace(/[<>]/g, ""))
        .replaceAll("{{color}}", input.color ?? "#ff3b30")
        .replaceAll("{{accent}}", input.color ?? "#ffd60a")
        .replaceAll("{{delay}}", String(input.delay ?? 0));
      return { text: `HTML snippet for render_animation (adjust position as needed):\n${snippet}` };
    }
    if (kind === "meme") {
      const m = MEME_FORMATS.find((x) => x.id === key);
      return m ? { text: `${m.name}: ${m.description}\nRecipe: ${m.recipe}` } : { text: "Unknown meme format.", isError: true };
    }
    if (kind === "caption") {
      const c = CAPTION_STYLES.find((x) => x.id === key);
      return c ? { text: `Caption style ${c.id}: ${JSON.stringify(c)}` } : { text: "Unknown caption style.", isError: true };
    }
    const entry = findEntry(input.id);
    return entry ? { text: `${entry.name}: ${entry.description}\nuse: ${entry.usage}\nlicence: ${entry.license.name}` } : { text: "Unknown asset id.", isError: true };
  },
});

const CaptionWordSchema = z.object({ w: z.string().max(80), s: z.number().min(0), e: z.number().min(0), emoji: z.string().max(40).optional() });

const renderCaptionsTool = tool({
  name: "render_captions",
  description:
    "Render animated captions from word timings with a professional preset (search_library kind caption_style). Words are kept whole, so Tamil renders correctly. Give either words, or transcript (the cache/words-*.json path from transcribe) plus segments (the source time ranges you kept, in output order) so timings follow your cut. Add emoji to words for animated emoji pops. Output: transparent .mov to overlay on the edit.",
  schema: z.object({
    preset: z.string().max(60),
    words: z.array(CaptionWordSchema).max(3000).optional(),
    transcript: RelPath.optional(),
    segments: z.array(z.object({ start: z.number().min(0), end: z.number().min(0) })).max(400).optional(),
    emojis: z.array(z.object({ word: z.string().max(80), emoji: z.string().max(40) })).max(60).optional().describe("Attach an animated emoji to the first caption word matching each text"),
    width: z.number().int().min(64).max(2160),
    height: z.number().int().min(64).max(3840),
    duration: z.number().min(0.5).max(600),
    fps: z.number().int().min(10).max(60).optional(),
    color: z.string().max(30).optional(),
    activeColor: z.string().max(30).optional(),
    output: RelPath,
  }),
  label: () => "Animating captions",
  async run(input, ctx) {
    syncWorkspace(ctx.conversationId);
    const style = CAPTION_STYLES.find((c) => c.id === input.preset);
    if (!style) return { text: `Unknown caption preset "${input.preset}". Use search_library kind caption_style.`, isError: true };
    if (!input.output.endsWith(".mov")) return { text: "Captions render to a transparent .mov.", isError: true };
    let words: CaptionWord[] = input.words ?? [];
    if (!words.length && input.transcript) {
      const file = resolveInWorkspace(ctx.conversationId, input.transcript, { mustExist: true });
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as { words: CaptionWord[] };
      words = data.words;
      if (input.segments?.length) {
        // Map source times onto the edited timeline.
        const mapped: CaptionWord[] = [];
        let offset = 0;
        for (const seg of input.segments) {
          for (const w of words) if (w.s >= seg.start - 0.02 && w.e <= seg.end + 0.08) mapped.push({ ...w, s: offset + (w.s - seg.start), e: offset + (Math.min(w.e, seg.end) - seg.start) });
          offset += seg.end - seg.start;
        }
        words = mapped;
      }
    }
    if (!words.length) return { text: "No words to caption. Pass words, or transcript (+ segments).", isError: true };
    for (const em of input.emojis ?? []) {
      const target = words.find((w) => !w.emoji && w.w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").includes(em.word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")));
      if (target) target.emoji = em.emoji;
    }
    const { html } = buildCaptionHtml({ words, style, width: input.width, height: input.height, color: input.color, activeColor: input.activeColor });
    const out = resolveInWorkspace(ctx.conversationId, input.output, { writable: true });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    try {
      await renderHtmlToVideo({
        html: prepareComposition(ctx.conversationId, html),
        width: input.width - (input.width % 2),
        height: input.height - (input.height % 2),
        duration: input.duration,
        fps: input.fps ?? 30,
        transparent: true,
        outPath: out,
        shouldCancel: ctx.shouldCancel,
        onProgress: (f) => ctx.progress?.(f),
      });
    } catch (err) {
      return { text: `Caption render failed: ${err instanceof MediaError ? (err.diagnostic ?? err.userMessage).slice(-800) : String(err)}`, isError: true };
    }
    recordUsedAssets(ctx.conversationId, [`caption:${style.id}`]);
    return { text: `Captions rendered (${words.length} words, ${style.name}).\n${(await describeOutputs(ctx.conversationId, [input.output])).join("\n")}\nOverlay with: [0:v][1:v]overlay=0:0:format=auto` };
  },
});

const renderTransitionTool = tool({
  name: "render_transition",
  description:
    "Render an overlay transition (light-leak, film-burn, flash-white, dip-color, glitch, circle/diamond/star/heart-wipe, brush-wipe, split-slats, grid-squares, whip-streak, spotlight-iris) as a transparent .mov. It covers the screen at its midpoint: overlay it centred on a hard cut (shift with -itsoffset cut-duration/2 and overlay=eof_action=pass). Pair with a whoosh/swipe sound effect.",
  schema: z.object({
    style: z.string().max(40),
    width: z.number().int().min(64).max(2160),
    height: z.number().int().min(64).max(3840),
    duration: z.number().min(0.2).max(4).optional(),
    color: z.string().max(30).optional().describe("For wipes/dips; brand colour"),
    fps: z.number().int().min(10).max(60).optional(),
    output: RelPath,
  }),
  label: (i) => `Making a ${i.style} transition`,
  async run(input, ctx) {
    syncWorkspace(ctx.conversationId);
    const def = OVERLAY_TRANSITIONS.find((t) => t.id === input.style);
    if (!def) return { text: `Unknown transition "${input.style}". Options: ${OVERLAY_TRANSITIONS.map((t) => t.id).join(", ")}. For blends between two clips use xfade in run_ffmpeg.`, isError: true };
    if (!input.output.endsWith(".mov")) return { text: "Overlay transitions render to a transparent .mov.", isError: true };
    const d = input.duration ?? def.defaultDuration;
    const w = input.width - (input.width % 2);
    const h = input.height - (input.height % 2);
    const out = resolveInWorkspace(ctx.conversationId, input.output, { writable: true });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await renderHtmlToVideo({ html: def.html(w, h, d, input.color ?? "#111111"), width: w, height: h, duration: d, fps: input.fps ?? 30, transparent: true, outPath: out, shouldCancel: ctx.shouldCancel });
    recordUsedAssets(ctx.conversationId, [`transition:${def.id}`]);
    return { text: `Transition ready: ${input.output} (${d}s, fully covering at ${(d / 2).toFixed(2)}s).` };
  },
});

const deliverTool = tool({
  name: "deliver",
  description:
    "Hand the finished video to the user. Call only after checking it with view_frames. It is validated, converted to an H.264/AAC MP4 if needed, saved as a new version with download, and shown in the chat. Deliver each final video once.",
  schema: z.object({ path: RelPath, title: z.string().min(1).max(80) }),
  label: (i) => `Delivering “${decodeEntities(i.title)}”`,
  async run(rawInput, ctx) {
    const input = { ...rawInput, title: decodeEntities(rawInput.title) };
    syncWorkspace(ctx.conversationId);
    const src = resolveInWorkspace(ctx.conversationId, input.path, { mustExist: true });
    const info = await probe(src);
    if (!info.hasVideo || !info.duration || info.duration < 0.5) return { text: "That file has no playable video.", isError: true };
    if (info.duration > 600) return { text: "Deliveries are limited to 10 minutes.", isError: true };
    const storage = getStorage();
    storage.ensureDir("outputs");
    storage.ensureDir("thumbs");
    const assetId = newId("ast");
    const outKey = `outputs/${assetId}.mp4`;
    const outAbs = storage.absolutePath(outKey);
    const compatible = /mp4/.test(info.format) && info.videoCodec === "h264" && (!info.audioCodec || info.audioCodec === "aac");
    if (compatible) {
      fs.copyFileSync(src, outAbs);
    } else {
      await ffmpeg(["-i", src, "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outAbs], {
        timeoutMs: getConfig().ffmpegTimeoutMs,
        shouldCancel: ctx.shouldCancel,
      });
    }
    // Make sure it's streamable in the browser.
    if (compatible) {
      const tmp = `${outAbs}.fs.mp4`;
      await ffmpeg(["-i", outAbs, "-c", "copy", "-movflags", "+faststart", tmp], { timeoutMs: 120_000 });
      fs.renameSync(tmp, outAbs);
    }
    const final = await probe(outAbs);
    await makeThumbnail(outAbs, storage.absolutePath(`thumbs/${assetId}.jpg`), final.duration);
    const asset: Asset = {
      id: assetId,
      conversationId: ctx.conversationId,
      kind: "output",
      mediaType: "video",
      originalName: `${input.title.replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 50) || "januxai-video"}.mp4`,
      storageKey: outKey,
      thumbKey: `thumbs/${assetId}.jpg`,
      mime: "video/mp4",
      size: fs.statSync(outAbs).size,
      duration: final.duration,
      width: final.width,
      height: final.height,
      hasAudio: final.hasAudio,
      metadata: final,
      createdAt: now(),
    };
    insertAsset(asset);
    const version = insertVersion({
      conversationId: ctx.conversationId,
      jobId: ctx.runId,
      parentVersionId: null,
      assetId,
      spec: { studio: { title: input.title, source: input.path } } as unknown as EditSpec,
      duration: final.duration!,
      width: final.width!,
      height: final.height!,
    });
    getDb().prepare("UPDATE messages SET version_id = ?, updated_at = ? WHERE id = ?").run(version.id, now(), ctx.messageId);
    const credits = creditsFor(readUsedAssets(ctx.conversationId)).map((c) => c.license.attribution!);
    patchMeta(ctx.messageId, (m) => ({ ...m, deliveries: [...(m.deliveries ?? []), { versionId: version.id, title: input.title, ...(credits.length ? { credits } : {}) }] }));
    touchConversation(ctx.conversationId);
    // The delivered file is now an input for later revisions.
    syncWorkspace(ctx.conversationId);
    return {
      text: `Delivered as version ${version.number}: ${final.duration!.toFixed(2)}s, ${final.width}x${final.height}. It's now also available as ${inputName(asset)} for further edits.`,
    };
  },
});

const voiceoverTool = tool({
  name: "generate_voiceover",
  description:
    "Turn a script into a spoken voiceover audio file (.m4a) with this computer's voices: Tamil (Vani), Indian English (Rishi, Tara, Aman), Hindi (Lekha), Telugu (Geeta), Kannada (Soumya), Bengali (Piya). Write Tamil scripts in Tamil script (English words may stay in English); romanized Tanglish is read badly. Returns the duration so you can time the edit. Voices are clear but synthetic: offer the user the option to record their own voice instead.",
  schema: z.object({
    text: z.string().min(1).max(5000),
    language: z.enum(["ta", "en", "hi", "te", "kn", "bn"]),
    voice: z.string().max(20).optional(),
    speed: z.number().min(0.6).max(1.6).optional().describe("1 = normal; 1.1 for energetic reels"),
    output: RelPath.describe("work/....m4a"),
  }),
  label: (i) => `Recording voiceover (${i.language === "ta" ? "Tamil" : i.language === "en" ? "English" : i.language})`,
  async run(input, ctx) {
    syncWorkspace(ctx.conversationId);
    if (!input.output.endsWith(".m4a")) return { text: "Voiceovers are saved as .m4a.", isError: true };
    const out = resolveInWorkspace(ctx.conversationId, input.output, { writable: true });
    try {
      await makeVoiceover({
        text: input.text,
        language: input.language,
        voice: input.voice,
        speed: input.speed ?? 1,
        output: out,
        workDir: path.dirname(resolveInWorkspace(ctx.conversationId, "cache/x")),
      });
    } catch (err) {
      return { text: err instanceof MediaError ? err.userMessage : String(err), isError: true };
    }
    return { text: `Voiceover ready.\n${(await describeOutputs(ctx.conversationId, [input.output])).join("\n")}` };
  },
});

const sfxTool = tool({
  name: "generate_sound_effect",
  description: `Make a sound effect (.wav) to place on a cut, a text pop or a reveal: ${SFX_TYPES.join(", ")}. Mix it in with run_ffmpeg (adelay to position it, amix normalize=0). Keep effects subtle under speech.`,
  schema: z.object({
    type: z.enum(SFX_TYPES),
    duration: z.number().min(0.03).max(8).optional(),
    volume: z.number().min(0.05).max(2).optional(),
    output: RelPath.describe("work/....wav"),
  }),
  label: (i) => `Making a ${i.type} sound effect`,
  async run(input, ctx) {
    syncWorkspace(ctx.conversationId);
    if (!input.output.endsWith(".wav")) return { text: "Sound effects are saved as .wav.", isError: true };
    const out = resolveInWorkspace(ctx.conversationId, input.output, { writable: true });
    await makeSoundEffect(input.type, input.duration ?? SFX_DEFAULT_DURATION[input.type], out, input.volume ?? 1);
    return { text: `Sound effect ready: ${input.output} (${(input.duration ?? SFX_DEFAULT_DURATION[input.type]).toFixed(2)}s).` };
  },
});

const brandTool = tool({
  name: "update_brand_kit",
  description: "Save brand details the user tells you (business/channel name, tagline, phone, WhatsApp, email, website, Instagram, address, colours, logo asset id, notes) for reuse in intros, end cards and captions.",
  schema: BrandKitSchema.partial(),
  label: () => "Saving your brand details",
  async run(input) {
    const kit = updateBrandKit(input);
    return { text: `Saved. Name: ${kit.businessName || "(not set)"}.` };
  },
});

export const STUDIO_TOOLS = [
  listMedia,
  inspectMedia,
  viewFrames,
  transcribeTool,
  analyzeAudioTool,
  writeFileTool,
  runFfmpegTool,
  renderAnimationTool,
  renderCaptionsTool,
  renderTransitionTool,
  searchLibraryTool,
  getAssetTool,
  voiceoverTool,
  sfxTool,
  deliverTool,
  brandTool,
] as StudioTool<z.ZodTypeAny>[];

export function studioToolSchemas() {
  return STUDIO_TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.schema, { target: "draft-7" }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: schema };
  });
}

/** Validates input, records a visible step, runs the tool, never throws. */
export async function runStudioTool(name: string, input: unknown, ctx: StudioContext): Promise<ToolOutput> {
  const t = STUDIO_TOOLS.find((x) => x.name === name);
  if (!t) return { text: `Unknown tool ${name}.`, isError: true };
  const parsed = t.schema.safeParse(input ?? {});
  if (!parsed.success) return { text: `Invalid input: ${z.prettifyError(parsed.error).slice(0, 1500)}`, isError: true };
  if (ctx.shouldCancel()) return { text: "Stopped by the user.", isError: true };
  const label = t.label(parsed.data).slice(0, 120);
  const quiet = name === "list_media";
  const idx = quiet ? -1 : addActivity(ctx.messageId, label);
  let lastProgress = 0;
  const progress = (fraction: number, detail?: string) => {
    if (quiet || Date.now() - lastProgress < 700) return;
    lastProgress = Date.now();
    updateActivity(ctx.messageId, idx, { progress: Math.max(0, Math.min(1, fraction)), detail });
  };
  try {
    const out = await t.run(parsed.data, { ...ctx, progress });
    if (!quiet) {
      const root = workspaceDir(ctx.conversationId);
      const images = (out.images ?? []).map((p) => path.relative(root, p)).filter((p) => p.startsWith("cache/"));
      const firstLine = out.text.split("\n").find((l) => l.trim() && !/^Done\.?$/.test(l.trim())) ?? "";
      finishActivity(ctx.messageId, idx, out.isError ? "failed" : "done", out.isError ? `${label} (retrying)` : label, {
        images: images.length ? images : undefined,
        detail: firstLine.slice(0, 200) || undefined,
      });
    }
    return out;
  } catch (err) {
    if (!quiet) finishActivity(ctx.messageId, idx, "failed");
    return { text: err instanceof Error ? err.message : String(err), isError: true };
  }
}
