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
import { makeSoundEffect, SFX_DEFAULT_DURATION, SFX_TYPES } from "./audioGen";
import { activeVoiceProvider, listVoices, makeVoiceover, polishVoice, voiceProviders, VOICE_LANGUAGES } from "./voice";
import { creditsFor, emojiRuntime, findEntry, fontFaceCss, libraryInstalled, searchLibrary } from "../library";
import { buildCaptionHtml, CAPTION_STYLES, type CaptionWord } from "../library/captions";
import { MEME_FORMATS } from "../library/memes";
import { STICKERS } from "../library/stickers";
import { OVERLAY_TRANSITIONS } from "../library/transitions";
import { ASSET_KINDS } from "../library/types";
import { getKitItem, kitUsage, saveStyle, StyleSchema } from "../kit";
import { checkFfmpegArgs } from "./ffmpegGuard";
import { cropPlan, followPath, trackerBinary, trackingSupported, trackSubjects } from "./track";
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

const originalNames = new Map<string, string>();

/** Loads the conversation's original file names so labels can show them. */
async function loadDisplayNames(conversationId: string) {
  const rows = await getDb().all<{ id: string; original_name: string }>("SELECT id, original_name FROM assets WHERE conversation_id = ?", [conversationId]);
  for (const r of rows) originalNames.set(r.id, r.original_name);
}

/** Friendly name for labels: in/ast_x.mp4 → the user's original file name. */
function displayName(rel: string): string {
  const m = rel.match(/^in\/(ast_[a-f0-9]{32})/);
  return (m && originalNames.get(m[1])) || path.basename(rel);
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
    const { dir, assets } = await syncWorkspace(ctx.conversationId);
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
    await syncWorkspace(ctx.conversationId);
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
    await syncWorkspace(ctx.conversationId);
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
    await syncWorkspace(ctx.conversationId);
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
    await syncWorkspace(ctx.conversationId);
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
    await syncWorkspace(ctx.conversationId);
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
    await syncWorkspace(ctx.conversationId);
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
    recordUsedAssets(ctx.conversationId, usedInArgs(input.args));
    return { text: `Done.\n${(await describeOutputs(ctx.conversationId, plan.outputs)).join("\n")}` };
  },
});

/** Library looks and kit files an FFmpeg command reads, as asset ids. */
function usedInArgs(args: string[]): string[] {
  const ids = new Set<string>();
  for (const a of args) {
    for (const m of a.matchAll(/lib\/looks\/([a-z0-9-]+)\.cube/g)) ids.add(`look:${m[1]}`);
    for (const m of a.matchAll(/kit\/(kit_[A-Za-z0-9]+)\.[a-z0-9]+/g)) ids.add(`kit:${m[1]}`);
  }
  return [...ids];
}

/**
 * Readies a composition for rendering: inlines workspace images, embeds the
 * library fonts it names, adds the animated-emoji runtime, and records which
 * library assets were used (for licence credits on delivery).
 */
async function prepareComposition(conversationId: string, html: string): Promise<string> {
  const withImages = inlineWorkspaceImages(conversationId, html);
  const fonts = await fontFaceCss(withImages);
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
  const kitUsed: string[] = [];
  const out = html.replace(/((?:in|work|kit)\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|gif|svg))/g, (m) => {
    try {
      const abs = resolveInWorkspace(conversationId, m, { mustExist: true });
      const kitId = m.match(/^kit\/(kit_[A-Za-z0-9]+)\./)?.[1];
      if (kitId) kitUsed.push(`kit:${kitId}`);
      if (fs.statSync(abs).size > 8 * 1024 * 1024) return m;
      const ext = path.extname(abs).slice(1).toLowerCase();
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : `image/${ext}`;
      return `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
    } catch {
      return m;
    }
  });
  recordUsedAssets(conversationId, kitUsed);
  return out;
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
    await syncWorkspace(ctx.conversationId);
    const out = resolveInWorkspace(ctx.conversationId, input.output, { writable: true });
    if (input.transparent && !out.endsWith(".mov")) return { text: "Transparent animations must be saved as .mov.", isError: true };
    if (!input.transparent && !out.endsWith(".mp4")) return { text: "Opaque animations must be saved as .mp4.", isError: true };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const width = input.width - (input.width % 2);
    const height = input.height - (input.height % 2);
    try {
      await renderHtmlToVideo({
        html: await prepareComposition(ctx.conversationId, input.html),
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
    "Search the user's own imported kit (their brand fonts, LUTs, logos, overlays, sounds, saved styles; listed first, ids kit:...) and JANUXAI's asset library: 80+ fonts (Tamil, Indian scripts, display, script), 58 xfade + 14 overlay transitions, 20 caption styles, animated stickers, 59 animated emoji, 30 sound effects, 10 colour looks (LUTs) and 12 meme formats. Search before designing so edits use professional assets. Returns ids and how to use each.",
  schema: z.object({
    query: z.string().max(200).describe("e.g. 'tamil bold headline font', 'glitch transition', 'karaoke captions', 'sale sticker', 'warm cinematic look'"),
    kind: z.enum(ASSET_KINDS).optional(),
    limit: z.number().int().min(1).max(30).optional(),
  }),
  label: (i) => `Searching the library for “${i.query}”`,
  async run(input) {
    const installed = libraryInstalled();
    const hits = (await searchLibrary(input.query, input.kind, input.limit ?? 12)).filter((h) => installed || h.source === "kit");
    const note = installed ? "" : "\n(The shared asset library isn't installed on this server yet: npm run setup:library. Only the user's kit is searchable.)";
    if (!hits.length) return { text: `Nothing matched. Try broader words, or a kind filter.${note}` };
    return { text: hits.map((h) => `- ${h.id} — ${h.name}${h.source === "kit" ? " [user's kit]" : ""}: ${h.description}\n  use: ${h.usage}`).join("\n") + note };
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
    if (kind === "kit") {
      const item = await getKitItem(key);
      if (!item) return { text: "That kit item no longer exists.", isError: true };
      return { text: `${item.name} (user's ${item.kind})${item.file ? `\nfile: kit/${item.file}` : ""}${item.notes ? `\nnotes: ${item.notes}` : ""}\nuse: ${kitUsage(item)}${item.credit ? `\ncredit when used: ${item.credit}` : ""}` };
    }
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
    const entry = await findEntry(input.id);
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
    await syncWorkspace(ctx.conversationId);
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
        html: await prepareComposition(ctx.conversationId, html),
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
    await syncWorkspace(ctx.conversationId);
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
    await syncWorkspace(ctx.conversationId);
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
    await insertAsset(asset);
    const version = await insertVersion({
      conversationId: ctx.conversationId,
      jobId: ctx.runId,
      parentVersionId: null,
      assetId,
      spec: { studio: { title: input.title, source: input.path } } as unknown as EditSpec,
      duration: final.duration!,
      width: final.width!,
      height: final.height!,
    });
    await getDb().run("UPDATE messages SET version_id = ?, updated_at = ? WHERE id = ?", [version.id, now(), ctx.messageId]);
    const credits = (await creditsFor(readUsedAssets(ctx.conversationId))).map((c) => c.license.attribution!);
    await patchMeta(ctx.messageId, (m) => ({ ...m, deliveries: [...(m.deliveries ?? []), { versionId: version.id, title: input.title, ...(credits.length ? { credits } : {}) }] }));
    await touchConversation(ctx.conversationId);
    // The delivered file is now an input for later revisions.
    await syncWorkspace(ctx.conversationId);
    return {
      text: `Delivered as version ${version.number}: ${final.duration!.toFixed(2)}s, ${final.width}x${final.height}. It's now also available as ${inputName(asset)} for further edits.`,
    };
  },
});

const LANG_NAMES: Record<string, string> = { ta: "Tamil", en: "English", hi: "Hindi", te: "Telugu", ml: "Malayalam", kn: "Kannada", bn: "Bengali" };

function voiceProviderNote(): string {
  const active = activeVoiceProvider();
  const p = voiceProviders().find((x) => x.id === active);
  if (!p) return "No voice provider is configured.";
  return p.premium ? `Voice provider: ${p.label} (premium, natural).` : `Voice provider: ${p.label}. This is a synthetic draft voice: tell the user, and offer to polish their own recording (polish_voice) or to use a premium voice once ElevenLabs or Google TTS is set up.`;
}

const listVoicesTool = tool({
  name: "list_voices",
  description: "List the voiceover voices available for a language (with gender/style notes), and which voice provider is active. Pick a voice that fits the brand: warm, energetic, calm, authoritative.",
  schema: z.object({ language: z.enum(VOICE_LANGUAGES) }),
  label: (i) => `Checking ${LANG_NAMES[i.language]} voices`,
  async run(input) {
    try {
      const voices = await listVoices(input.language);
      const lines = voices.slice(0, 40).map((v) => `- ${v.id}: ${v.name}${v.note ? ` (${v.note})` : ""}`);
      return { text: `${voiceProviderNote()}\n${lines.length ? lines.join("\n") : "No voices found for this language."}` };
    } catch (err) {
      return { text: err instanceof MediaError ? err.userMessage : String(err), isError: true };
    }
  },
});

const voiceoverTool = tool({
  name: "generate_voiceover",
  description:
    "Turn a script into a spoken voiceover (.m4a), mastered for video. Languages: ta, en, hi, te, ml, kn, bn. Write Tamil and other Indian-language scripts in their own script (English brand words may stay in English); romanized Tanglish is read badly. Write for the ear: short sentences, natural pauses with commas and full stops. Premium providers also save word timings (cache/vo-words-*.json) usable as render_captions transcript. Returns the duration so you can time the edit.",
  schema: z.object({
    text: z.string().min(1).max(5000),
    language: z.enum(VOICE_LANGUAGES),
    voice: z.string().max(80).optional().describe("A voice id from list_voices"),
    speed: z.number().min(0.7).max(1.3).optional().describe("1 = natural; 1.05-1.1 for energetic reels"),
    expressiveness: z.number().min(0).max(1).optional().describe("0 calm/corporate, 0.4 natural, 0.8 hype"),
    output: RelPath.describe("work/....m4a"),
  }),
  label: (i) => `Recording voiceover (${LANG_NAMES[i.language]})`,
  async run(input, ctx) {
    await syncWorkspace(ctx.conversationId);
    if (!input.output.endsWith(".m4a")) return { text: "Voiceovers are saved as .m4a.", isError: true };
    const out = resolveInWorkspace(ctx.conversationId, input.output, { writable: true });
    let result;
    try {
      result = await makeVoiceover({
        text: input.text,
        language: input.language,
        voice: input.voice,
        speed: input.speed ?? 1,
        expressiveness: input.expressiveness,
        output: out,
        workDir: path.dirname(resolveInWorkspace(ctx.conversationId, "cache/x")),
      });
    } catch (err) {
      return { text: err instanceof MediaError ? err.userMessage : String(err), isError: true };
    }
    let timings = "";
    if (result.words?.length) {
      const rel = `cache/vo-words-${path.basename(input.output, ".m4a")}.json`;
      fs.writeFileSync(resolveInWorkspace(ctx.conversationId, rel), JSON.stringify({ language: input.language, words: result.words }));
      timings = `\nWord timings: ${rel} (${result.words.length} words; offset them by where you place the voiceover).`;
    }
    return { text: `Voiceover ready (${result.premium ? "premium" : "draft"} voice ${result.voice}).\n${voiceProviderNote()}\n${(await describeOutputs(ctx.conversationId, [input.output])).join("\n")}${timings}` };
  },
});

const polishVoiceTool = tool({
  name: "polish_voice",
  description:
    "Studio clean-up for a voice the user recorded (voice note, phone or lapel audio, or a video's own speech): noise reduction, rumble cut, de-essing, compression, presence and broadcast loudness. Use it on every user voiceover and on talking-head audio that sounds roomy or noisy. Output .m4a; mix it back in with run_ffmpeg.",
  schema: z.object({
    input: RelPath,
    output: RelPath.describe("work/....m4a"),
    denoise: z.enum(["light", "strong"]).optional(),
    warmth: z.boolean().optional().describe("Add low-mid warmth (good for thin phone recordings)"),
  }),
  label: () => "Polishing the voice",
  async run(input, ctx) {
    await syncWorkspace(ctx.conversationId);
    if (!input.output.endsWith(".m4a")) return { text: "Polished voice is saved as .m4a.", isError: true };
    try {
      const src = resolveInWorkspace(ctx.conversationId, input.input, { mustExist: true });
      const out = resolveInWorkspace(ctx.conversationId, input.output, { writable: true });
      await polishVoice({ input: src, output: out, denoise: input.denoise ?? "light", warmth: input.warmth ?? false });
    } catch (err) {
      return { text: err instanceof MediaError ? `${err.userMessage}${err.diagnostic ? `\n${err.diagnostic.slice(-400)}` : ""}` : String(err), isError: true };
    }
    return { text: `Voice polished.\n${(await describeOutputs(ctx.conversationId, [input.output])).join("\n")}` };
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
    await syncWorkspace(ctx.conversationId);
    if (!input.output.endsWith(".wav")) return { text: "Sound effects are saved as .wav.", isError: true };
    const out = resolveInWorkspace(ctx.conversationId, input.output, { writable: true });
    await makeSoundEffect(input.type, input.duration ?? SFX_DEFAULT_DURATION[input.type], out, input.volume ?? 1);
    return { text: `Sound effect ready: ${input.output} (${(input.duration ?? SFX_DEFAULT_DURATION[input.type]).toFixed(2)}s).` };
  },
});

const reframeTool = tool({
  name: "reframe_subject",
  description:
    "Reframe a clip so the camera follows the person (face, else upper body), like a cameraman: 16:9 → 9:16 for reels, or any aspect. zoom >1 makes a tighter shot of the same subject; render a second version at zoom 1.25-1.4 and cut to it on emphasis words for professional punch-ins. Writes the reframed video (audio kept) and reports how often a subject was found. macOS only.",
  schema: z.object({
    input: RelPath,
    output: RelPath.describe("work/....mp4"),
    aspect: z.enum(["9:16", "4:5", "1:1", "16:9"]).optional().describe("Default 9:16"),
    zoom: z.number().min(1).max(2.5).optional(),
    start: z.number().min(0).optional(),
    end: z.number().positive().optional(),
    smoothness: z.enum(["steady", "normal", "responsive"]).optional().describe("steady for interviews/podcasts, responsive for moving subjects"),
  }),
  label: (i) => `Following the subject in ${displayName(i.input)}${i.zoom && i.zoom > 1 ? ` (zoom ${i.zoom}x)` : ""}`,
  async run(input, ctx) {
    await syncWorkspace(ctx.conversationId);
    if (!input.output.endsWith(".mp4")) return { text: "Reframed clips are saved as .mp4.", isError: true };
    if (!trackingSupported() && !fs.existsSync(trackerBinary())) return { text: "Face tracking needs a Mac (Apple Vision) and isn't available on this server. Use a centred crop with run_ffmpeg instead.", isError: true };
    const src = resolveInWorkspace(ctx.conversationId, input.input, { mustExist: true });
    const out = resolveInWorkspace(ctx.conversationId, input.output, { writable: true });
    const info = await probe(src);
    if (!info.hasVideo || !info.duration) return { text: "That file has no video to reframe.", isError: true };
    const start = Math.min(input.start ?? 0, info.duration - 0.2);
    const end = Math.min(input.end ?? info.duration, info.duration);
    // Track the cut-out section on its own timeline so the expressions start at t=0.
    const cache = path.dirname(resolveInWorkspace(ctx.conversationId, "cache/x"));
    let source = src;
    let tmp: string | null = null;
    try {
      if (start > 0 || end < info.duration) {
        tmp = path.join(cache, `track-src-${Date.now()}.mp4`);
        await ffmpeg(["-ss", start.toFixed(3), "-to", end.toFixed(3), "-i", src, "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-c:a", "aac", "-b:a", "192k", tmp], { timeoutMs: 600_000, shouldCancel: ctx.shouldCancel });
        source = tmp;
      }
      ctx.progress?.(0.1);
      const track = await trackSubjects(source, 5, ctx.shouldCancel);
      ctx.progress?.(0.5);
      const ease = input.smoothness === "steady" ? 0.18 : input.smoothness === "responsive" ? 0.6 : 0.35;
      const keys = followPath(track, { ease, deadZone: input.smoothness === "steady" ? 0.06 : 0.04 });
      const [aw, ah] = (input.aspect ?? "9:16").split(":").map(Number);
      const plan = cropPlan(track, keys, { aspect: aw / ah, zoom: input.zoom ?? 1 });
      const outW = aw >= ah ? 1920 : Math.round((1920 * aw) / ah / 2) * 2;
      const outH = aw >= ah ? Math.round((1920 * ah) / aw / 2) * 2 : 1920;
      const scaleW = Math.min(outW, plan.w * 2);
      const scaleH = Math.round((scaleW * outH) / outW / 2) * 2;
      await ffmpeg(
        ["-progress", "pipe:1", "-nostats", "-i", source, "-vf", `crop=${plan.w}:${plan.h}:x='${plan.x}':y='${plan.y}',scale=${scaleW}:${scaleH}:flags=lanczos,setsar=1`, "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out],
        { timeoutMs: 1_200_000, shouldCancel: ctx.shouldCancel, onProgress: (sec) => ctx.progress?.(0.5 + Math.min(1, sec / Math.max(0.1, end - start)) * 0.5) },
      );
      const found = keys.filter((k) => k.found).length;
      const keyFile = `cache/follow-${path.basename(input.output, ".mp4")}.json`;
      fs.writeFileSync(resolveInWorkspace(ctx.conversationId, keyFile), JSON.stringify({ source: input.input, start, end, width: track.width, height: track.height, keys }));
      const pct = keys.length ? Math.round((found / keys.length) * 100) : 0;
      const note = pct < 40 ? " Few detections: the subject may be small, turned away or not a person; check the framing with view_frames (a centred crop may be better)." : "";
      return { text: `Reframed ${input.input} (${start.toFixed(2)}-${end.toFixed(2)}s) to ${input.aspect ?? "9:16"}${input.zoom && input.zoom > 1 ? ` at ${input.zoom}x zoom` : ""}. Subject found in ${pct}% of samples.${note}\nFollow path: ${keyFile}\n${(await describeOutputs(ctx.conversationId, [input.output])).join("\n")}` };
    } catch (err) {
      return { text: err instanceof MediaError ? `${err.userMessage}${err.diagnostic ? `\n${err.diagnostic.slice(-500)}` : ""}` : String(err), isError: true };
    } finally {
      if (tmp) fs.rmSync(tmp, { force: true });
    }
  },
});

const findShotsTool = tool({
  name: "find_shots",
  description:
    "Index a clip into shots for B-roll: detects scene cuts and returns each shot's time range plus a contact sheet with one frame per shot (numbered left-to-right, top-to-bottom). Use it on B-roll uploads, then place matching shots over the spoken words they illustrate (overlay or cutaway, 1.5-4s each, on beats).",
  schema: z.object({
    path: RelPath,
    sensitivity: z.number().min(0.1).max(0.6).optional().describe("Scene-change threshold; lower finds more cuts (default 0.3)"),
  }),
  label: (i) => `Finding shots in ${displayName(i.path)}`,
  async run(input, ctx) {
    await syncWorkspace(ctx.conversationId);
    const src = resolveInWorkspace(ctx.conversationId, input.path, { mustExist: true });
    const info = await probe(src);
    if (!info.hasVideo || !info.duration || info.duration < 0.5) return { text: "That file isn't a video clip.", isError: true };
    const cache = path.dirname(resolveInWorkspace(ctx.conversationId, "cache/x"));
    const stamp = Date.now();
    const scenesFile = path.join(cache, `scenes-${stamp}.txt`);
    try {
      await ffmpeg(["-i", src, "-an", "-vf", `scale=320:-2,select='gt(scene,${(input.sensitivity ?? 0.3).toFixed(2)})',metadata=print:file=${path.basename(scenesFile)}`, "-f", "null", "-"], {
        timeoutMs: 600_000,
        shouldCancel: ctx.shouldCancel,
        cwd: cache,
      });
      const cuts = [...fs.readFileSync(scenesFile, "utf8").matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t > 0.4 && t < info.duration! - 0.4);
      const bounds = [0, ...cuts.filter((t, i, a) => i === 0 || t - a[i - 1] > 0.5), info.duration];
      const shots = bounds.slice(0, -1).map((s, i) => ({ n: i + 1, start: r2(s), end: r2(bounds[i + 1]) }));
      const shown = shots.slice(0, 24);
      const cellW = info.width && info.height && info.height > info.width ? 180 : 280;
      const frames: string[] = [];
      for (const s of shown) {
        const f = path.join(cache, `shot-${stamp}-${String(s.n).padStart(3, "0")}.jpg`);
        await ffmpeg(["-ss", ((s.start + s.end) / 2).toFixed(3), "-i", src, "-frames:v", "1", "-update", "1", "-vf", `scale=${cellW}:-2`, "-q:v", "4", f], { timeoutMs: 30_000 });
        if (fs.existsSync(f)) frames.push(f);
      }
      const sheet = path.join(cache, `shots-${stamp}.jpg`);
      const cols = frames.length <= 9 ? 3 : 4;
      if (frames.length) {
        await ffmpeg(["-framerate", "1", "-i", path.join(cache, `shot-${stamp}-%03d.jpg`), "-vf", `tile=${cols}x${Math.ceil(frames.length / cols)}:padding=4:color=black`, "-frames:v", "1", "-update", "1", "-q:v", "4", sheet], { timeoutMs: 60_000 });
      }
      for (const f of frames) fs.rmSync(f, { force: true });
      const lines = shots.map((s) => `${s.n}. ${s.start}-${s.end}s (${r2(s.end - s.start)}s)`);
      const more = shots.length > shown.length ? `\n(Contact sheet shows the first ${shown.length} shots.)` : "";
      return { text: `${input.path}: ${shots.length} shot${shots.length === 1 ? "" : "s"}, ${cols} per row in the sheet.\n${lines.join("\n")}${more}`, images: fs.existsSync(sheet) ? [sheet] : undefined };
    } catch (err) {
      return { text: err instanceof MediaError ? err.userMessage : String(err), isError: true };
    } finally {
      fs.rmSync(scenesFile, { force: true });
    }
  },
});

const saveStyleTool = tool({
  name: "save_style",
  description:
    "Save an editing style to the user's kit so future edits can match it: the caption preset and colours, fonts, colour look, pace and cut rhythm, transitions, music/SFX approach, voice. Use when the user says things like 'save this as my style' or 'always edit like this'. Saving with an existing name updates it.",
  schema: StyleSchema,
  label: (i) => `Saving your style “${i.name}”`,
  async run(input) {
    const item = await saveStyle(input);
    return { text: `Saved style "${item.name}" to the user's kit (kit:${item.id}).` };
  },
});

const brandTool = tool({
  name: "update_brand_kit",
  description: "Save brand details the user tells you (business/channel name, tagline, phone, WhatsApp, email, website, Instagram, address, colours, logo asset id, notes) for reuse in intros, end cards and captions.",
  schema: BrandKitSchema.partial(),
  label: () => "Saving your brand details",
  async run(input) {
    const kit = await updateBrandKit(input);
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
  reframeTool,
  findShotsTool,
  searchLibraryTool,
  getAssetTool,
  listVoicesTool,
  voiceoverTool,
  polishVoiceTool,
  sfxTool,
  deliverTool,
  saveStyleTool,
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
  await loadDisplayNames(ctx.conversationId).catch(() => undefined);
  const label = t.label(parsed.data).slice(0, 120);
  const quiet = name === "list_media";
  const idx = quiet ? -1 : await addActivity(ctx.messageId, label);
  let lastProgress = 0;
  const progress = (fraction: number, detail?: string) => {
    if (quiet || Date.now() - lastProgress < 700) return;
    lastProgress = Date.now();
    void updateActivity(ctx.messageId, idx, { progress: Math.max(0, Math.min(1, fraction)), detail }).catch(() => undefined);
  };
  try {
    const out = await t.run(parsed.data, { ...ctx, progress });
    if (!quiet) {
      const root = workspaceDir(ctx.conversationId);
      const images = (out.images ?? []).map((p) => path.relative(root, p)).filter((p) => p.startsWith("cache/"));
      const firstLine = out.text.split("\n").find((l) => l.trim() && !/^Done\.?$/.test(l.trim())) ?? "";
      await finishActivity(ctx.messageId, idx, out.isError ? "failed" : "done", out.isError ? `${label} (retrying)` : label, {
        images: images.length ? images : undefined,
        detail: firstLine.slice(0, 200) || undefined,
      });
    }
    return out;
  } catch (err) {
    if (!quiet) await finishActivity(ctx.messageId, idx, "failed").catch(() => undefined);
    return { text: err instanceof Error ? err.message : String(err), isError: true };
  }
}
