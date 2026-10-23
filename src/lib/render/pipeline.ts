import fs from "node:fs";
import path from "node:path";
import { getAssets, insertAsset, type Asset } from "../assets";
import { getConfig } from "../config";
import { insertVersion, setMessageVersion, touchConversation } from "../conversations";
import { getDb, newId, now } from "../db";
import { watchCancel } from "../cancel";
import { getJob, isCancelRequested, PIPELINE, updateJob, type Job, type JobError, type Stage } from "../jobs";
import { CancelledError, ffmpeg, MediaError } from "../media/ffmpeg";
import { makeThumbnail, probe } from "../media/probe";
import { validateSpec } from "../spec";
import { freeDiskBytes, getStorage } from "../storage";
import { buildTimeline, type Timeline, type TimelineAsset } from "../timeline";
import { assembleArgs, segmentArgs } from "./commands";
import { processMotionJob } from "./motion";

/**
 * Executes one render job end to end. Every stage update written here is
 * what the chat UI shows, so stages only advance after the work is done.
 */
export async function processJob(jobId: string): Promise<void> {
  const cfg = getConfig();
  const storage = getStorage();
  const initial = await getJob(jobId);
  if (!initial) return;
  if (initial.kind === "motion") return processMotionJob(jobId);
  let stages: Stage[] = initial.stages;
  const startedMs = Date.now();
  const tmpKey = `tmp/${jobId}`;
  const tmpDir = storage.ensureDir(tmpKey);
  let lastWrite = 0;
  let inputBytes = 0;

  // Saves are chained so a slow progress write can never land after a newer state.
  let writes: Promise<unknown> = Promise.resolve();
  const save = (patch: Parameters<typeof updateJob>[1] = {}) => {
    const next = { stages, heartbeatAt: now(), ...patch };
    writes = writes.then(() => updateJob(jobId, next)).catch((err) => console.error("[worker] couldn't save job progress", err));
    lastWrite = Date.now();
    return writes;
  };
  const cancel = watchCancel(() => isCancelRequested(jobId));
  const setStage = (id: string, patch: Partial<Stage>, jobPatch: Parameters<typeof updateJob>[1] = {}) => {
    stages = stages.map((s) => (s.id === id ? { ...s, ...patch } : s));
    save(jobPatch);
  };
  const start = (id: string, detail?: string) => {
    const p = PIPELINE.find((x) => x.id === id)!;
    setStage(id, { status: "active", startedAt: now(), detail, progress: undefined }, { state: p.state });
  };
  const finish = (id: string, detail?: string, log?: string[]) =>
    setStage(id, { status: "done", finishedAt: now(), progress: undefined, ...(detail ? { detail } : {}), ...(log ? { log } : {}) });
  /** Throttled so progress doesn't hammer SQLite. */
  const progress = (id: string, value: number, detail?: string) => {
    stages = stages.map((s) => (s.id === id ? { ...s, progress: Math.max(0, Math.min(1, value)), ...(detail ? { detail } : {}) } : s));
    if (Date.now() - lastWrite > 400) save();
  };
  const checkCancel = () => {
    if (cancel.shouldCancel()) throw new CancelledError();
  };
  const shouldCancel = cancel.shouldCancel;

  try {
    // 1. Inspect inputs again — files may have been removed since upload.
    start("inspect");
    const spec = validateSpec(initial.spec);
    const uniqueIds = [...new Set([...spec.clips.map((c) => c.assetId), ...(spec.music ? [spec.music.assetId] : [])])];
    const assets = await getAssets(uniqueIds);
    if (assets.length !== uniqueIds.length) {
      throw new MediaError("Some of the clips for this edit were deleted. Upload them again and retry.", "missing asset row", "missing_input");
    }
    const byId = new Map<string, Asset>(assets.map((a) => [a.id, a]));
    const log: string[] = [];
    for (const a of assets) {
      if (!storage.exists(a.storageKey)) {
        throw new MediaError(`The file "${a.originalName}" is missing from storage. Upload it again and retry.`, a.storageKey, "missing_input");
      }
      const info = await probe(storage.absolutePath(a.storageKey));
      inputBytes += a.size;
      log.push(
        a.mediaType === "audio"
          ? `${a.originalName}: music ${info.duration?.toFixed(1)}s, ${info.audioCodec}`
          : a.mediaType === "image"
          ? `${a.originalName}: image ${info.width}×${info.height}`
          : `${a.originalName}: ${info.duration?.toFixed(1)}s, ${info.width}×${info.height}, ${info.videoCodec}${info.hasAudio ? ` + ${info.audioCodec} audio` : ", no audio"}`,
      );
      checkCancel();
    }
    if ((await freeDiskBytes()) < cfg.minFreeDiskBytes) {
      throw new MediaError("The server is low on disk space, so rendering was stopped before it started.", "low disk", "disk_full");
    }
    const videos = assets.filter((a) => a.mediaType === "video");
    const footage = videos.reduce((s, a) => s + (a.duration ?? 0), 0);
    finish(
      "inspect",
      `${assets.length} file${assets.length > 1 ? "s" : ""} checked · ${footage.toFixed(1)}s of video${assets.length > videos.length ? ` · ${assets.length - videos.length} image(s)` : ""}`,
      log,
    );

    // 2. Timeline (same deterministic function used for the chat preview).
    start("plan");
    const tAssets = new Map<string, TimelineAsset>(
      assets
        .filter((a) => a.mediaType !== "audio")
        .map((a) => [a.id, { id: a.id, name: a.originalName, mediaType: a.mediaType as "video" | "image", duration: a.duration, width: a.width, height: a.height, hasAudio: a.hasAudio }]),
    );
    const timeline: Timeline = buildTimeline(spec, tAssets, cfg);
    setStage("plan", {}, { timeline });
    finish(
      "plan",
      `${timeline.segments.length} segment${timeline.segments.length > 1 ? "s" : ""} · ${timeline.width}×${timeline.height} · ~${timeline.totalDuration.toFixed(1)}s`,
      timeline.segments.map((s) => `#${s.index + 1} ${s.name}: ${s.srcStart.toFixed(2)}s → ${s.srcEnd.toFixed(2)}s (${s.duration.toFixed(2)}s)`),
    );
    checkCancel();

    // 3. Cut + reframe each segment.
    start("cut");
    const segPaths: string[] = [];
    const durations: number[] = [];
    const n = timeline.segments.length;
    for (const seg of timeline.segments) {
      const a = byId.get(seg.assetId)!;
      const out = path.join(tmpDir, `seg_${String(seg.index).padStart(2, "0")}.mp4`);
      progress("cut", seg.index / n, `Clip ${seg.index + 1} of ${n}: ${seg.name}`);
      await ffmpeg(segmentArgs({ input: storage.absolutePath(a.storageKey), output: out, seg, timeline, spec }), {
        shouldCancel,
        onProgress: (sec) => progress("cut", (seg.index + Math.min(sec / seg.duration, 1)) / n),
      });
      const measured = await probe(out);
      segPaths.push(out);
      durations.push(measured.duration ?? seg.duration);
    }
    finish("cut", `${n} clip${n > 1 ? "s" : ""} cut and reframed to ${timeline.width}×${timeline.height}`);

    // 4. Assemble with transitions, look, audio and fades.
    start("render");
    const outFile = path.join(tmpDir, "output.mp4");
    const musicAsset = spec.music ? byId.get(spec.music.assetId) : undefined;
    const { args, expectedDuration } = assembleArgs({
      inputs: segPaths,
      durations,
      output: outFile,
      spec,
      transition: timeline.transition,
      musicPath: musicAsset ? storage.absolutePath(musicAsset.storageKey) : undefined,
    });
    await ffmpeg(args, {
      shouldCancel,
      onProgress: (sec) => progress("render", sec / expectedDuration, `Encoded ${Math.min(sec, expectedDuration).toFixed(1)}s of ${expectedDuration.toFixed(1)}s`),
    });
    finish(
      "render",
      [
        timeline.transition.type !== "none" ? `${timeline.transition.type} transitions (${timeline.transition.duration}s)` : n > 1 ? "hard cuts" : null,
        spec.look !== "none" ? `${spec.look} look` : null,
        spec.audio.keepOriginal ? (spec.audio.volume !== 1 ? `audio ×${spec.audio.volume}` : "original audio") : "audio muted",
        spec.fadeInOut ? "fade in/out" : null,
        spec.music ? `music: ${byId.get(spec.music.assetId)?.originalName}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    checkCancel();

    // 5. Validate the real output before telling anyone it's ready.
    start("validate");
    if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 1024) {
      throw new MediaError("The render finished but produced no usable file.", "output missing or tiny", "bad_output");
    }
    const outInfo = await probe(outFile);
    const tolerance = Math.max(0.5, expectedDuration * 0.03);
    if (!outInfo.hasVideo || !outInfo.duration || Math.abs(outInfo.duration - expectedDuration) > tolerance) {
      throw new MediaError("The rendered video didn't pass validation.", `expected ${expectedDuration}s got ${outInfo.duration}s`, "bad_output");
    }
    if (outInfo.width !== timeline.width || outInfo.height !== timeline.height) {
      throw new MediaError("The rendered video has the wrong dimensions.", `${outInfo.width}x${outInfo.height}`, "bad_output");
    }
    finish("validate", `${outInfo.duration.toFixed(2)}s · ${outInfo.width}×${outInfo.height} · ${outInfo.videoCodec}/${outInfo.audioCodec ?? "no audio"}`);

    // 6. Store output, thumbnail and version.
    start("preview");
    storage.ensureDir("outputs");
    storage.ensureDir("thumbs");
    const assetId = newId("ast");
    const outKey = `outputs/${assetId}.mp4`;
    const thumbKey = `thumbs/${assetId}.jpg`;
    fs.renameSync(outFile, storage.absolutePath(outKey));
    await makeThumbnail(storage.absolutePath(outKey), storage.absolutePath(thumbKey), outInfo.duration);
    const job = await getJob(jobId);
    if (!job) throw new CancelledError(); // conversation deleted mid-render
    const outputSize = storage.size(outKey);
    const outputAsset: Asset = {
      id: assetId,
      conversationId: job.conversationId,
      kind: "output",
      mediaType: "video",
      originalName: `januxai-${job.id.slice(4, 12)}.mp4`,
      storageKey: outKey,
      thumbKey,
      mime: "video/mp4",
      size: outputSize,
      duration: outInfo.duration,
      width: outInfo.width,
      height: outInfo.height,
      hasAudio: outInfo.hasAudio,
      metadata: outInfo,
      createdAt: now(),
    };
    await insertAsset(outputAsset);
    const version = await insertVersion({
      conversationId: job.conversationId,
      jobId: job.id,
      parentVersionId: job.parentVersionId,
      assetId,
      spec,
      duration: outInfo.duration,
      width: outInfo.width!,
      height: outInfo.height!,
    });
    await setMessageVersion(job.id, version.id);
    finish("preview", `Version ${version.number} saved`);
    await save({ state: "completed", outputVersionId: version.id, finishedAt: now(), stages });
    await touchConversation(job.conversationId);
    await recordUsage(job, { renderMs: Date.now() - startedMs, inputBytes, outputBytes: outputSize, outputSeconds: outInfo.duration, succeeded: true });
  } catch (err) {
    const job = await getJob(jobId);
    if (!job) return;
    const active = stages.find((s) => s.status === "active");
    if (err instanceof CancelledError) {
      stages = stages.map((s) => (s.status === "active" || s.status === "pending" ? { ...s, status: "skipped", progress: undefined } : s));
      await save({ state: "cancelled", stages, finishedAt: now() });
      return;
    }
    const error: JobError =
      err instanceof MediaError
        ? { message: err.userMessage, code: err.code, retryable: err.code !== "missing_input", diagnostic: err.diagnostic?.slice(-4000) }
        : { message: "Something went wrong while rendering.", code: "internal", retryable: true, diagnostic: err instanceof Error ? err.stack : String(err) };
    stages = stages.map((s) =>
      s === active ? { ...s, status: "failed", detail: error.message, progress: undefined, finishedAt: now() } : s.status === "pending" ? { ...s, status: "skipped" } : s,
    );
    await save({ state: "failed", stages, error, finishedAt: now() });
    console.error(`[worker] job ${jobId} failed: ${error.code}`, error.diagnostic ?? "");
    await recordUsage(job, { renderMs: Date.now() - startedMs, inputBytes, outputBytes: 0, outputSeconds: 0, succeeded: false });
  } finally {
    cancel.stop();
    await writes;
    storage.remove(tmpKey);
  }
}

export async function recordUsage(job: Job, u: { renderMs: number; inputBytes: number; outputBytes: number; outputSeconds: number; succeeded: boolean }) {
  try {
    await getDb().run(
      `INSERT INTO usage_records (id, job_id, conversation_id, render_ms, input_bytes, output_bytes, output_seconds, external_ai_calls, succeeded, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [newId("use"), job.id, job.conversationId, u.renderMs, u.inputBytes, u.outputBytes, u.outputSeconds, u.succeeded ? 1 : 0, now()],
    );
  } catch {
    // Conversation may have been deleted mid-render; usage is best-effort.
  }
}
