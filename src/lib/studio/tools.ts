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
        html: inlineWorkspaceImages(ctx.conversationId, input.html),
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
    patchMeta(ctx.messageId, (m) => ({ ...m, deliveries: [...(m.deliveries ?? []), { versionId: version.id, title: input.title }] }));
    touchConversation(ctx.conversationId);
    // The delivered file is now an input for later revisions.
    syncWorkspace(ctx.conversationId);
    return {
      text: `Delivered as version ${version.number}: ${final.duration!.toFixed(2)}s, ${final.width}x${final.height}. It's now also available as ${inputName(asset)} for further edits.`,
    };
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
