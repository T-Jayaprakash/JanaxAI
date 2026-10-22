import fs from "node:fs";
import path from "node:path";
import { insertAsset, type Asset } from "../assets";
import { insertVersion, setMessageVersion, touchConversation } from "../conversations";
import { newId, now } from "../db";
import { resolveAssetRefs } from "../graphics/assetRefs";
import { motionSize, renderHtmlToVideo } from "../graphics/render";
import { getJob, isCancelRequested, MOTION_PIPELINE, updateJob, type JobError, type Stage } from "../jobs";
import { CancelledError, MediaError } from "../media/ffmpeg";
import { makeThumbnail, probe } from "../media/probe";
import type { EditSpec } from "../spec";
import { getStorage } from "../storage";
import { recordUsage } from "./pipeline";

/** Renders a motion-graphic job (animated HTML → MP4) and saves it as a version. */
export async function processMotionJob(jobId: string): Promise<void> {
  const storage = getStorage();
  const initial = getJob(jobId);
  if (!initial?.motion) return;
  const motion = initial.motion;
  let stages: Stage[] = initial.stages;
  const startedMs = Date.now();
  const tmpKey = `tmp/${jobId}`;
  const tmpDir = storage.ensureDir(tmpKey);
  let lastWrite = 0;

  const save = (patch: Parameters<typeof updateJob>[1] = {}) => {
    updateJob(jobId, { stages, heartbeatAt: now(), ...patch });
    lastWrite = Date.now();
  };
  const set = (id: string, patch: Partial<Stage>, jobPatch: Parameters<typeof updateJob>[1] = {}) => {
    stages = stages.map((s) => (s.id === id ? { ...s, ...patch } : s));
    save(jobPatch);
  };
  const start = (id: string, detail?: string) =>
    set(id, { status: "active", startedAt: now(), detail }, { state: MOTION_PIPELINE.find((p) => p.id === id)!.state });
  const finish = (id: string, detail?: string) => set(id, { status: "done", finishedAt: now(), progress: undefined, ...(detail ? { detail } : {}) });
  const shouldCancel = () => isCancelRequested(jobId);

  try {
    start("prepare");
    const { width, height } = motionSize(motion.format);
    const html = resolveAssetRefs(motion.html);
    finish("prepare", `${motion.title} · ${width}×${height} · ${motion.duration}s at ${motion.fps}fps`);

    start("frames");
    const outFile = path.join(tmpDir, "motion.mp4");
    const total = Math.round(motion.duration * motion.fps);
    await renderHtmlToVideo({
      html,
      width,
      height,
      duration: motion.duration,
      fps: motion.fps,
      outPath: outFile,
      shouldCancel,
      onProgress: (f) => {
        stages = stages.map((s) => (s.id === "frames" ? { ...s, progress: f, detail: `Frame ${Math.round(f * total)} of ${total}` } : s));
        if (Date.now() - lastWrite > 400) save();
      },
    });
    finish("frames", `${total} frames encoded to H.264`);

    start("validate");
    const info = await probe(outFile);
    if (!info.hasVideo || !info.duration || Math.abs(info.duration - motion.duration) > Math.max(0.5, motion.duration * 0.05)) {
      throw new MediaError("The animation rendered but didn't pass validation.", `duration ${info.duration}`, "bad_output");
    }
    finish("validate", `${info.duration.toFixed(2)}s · ${info.width}×${info.height}`);

    start("preview");
    storage.ensureDir("outputs");
    storage.ensureDir("thumbs");
    const assetId = newId("ast");
    const outKey = `outputs/${assetId}.mp4`;
    const thumbKey = `thumbs/${assetId}.jpg`;
    fs.renameSync(outFile, storage.absolutePath(outKey));
    await makeThumbnail(storage.absolutePath(outKey), storage.absolutePath(thumbKey), info.duration);
    const job = getJob(jobId);
    if (!job) throw new CancelledError();
    const asset: Asset = {
      id: assetId,
      conversationId: job.conversationId,
      kind: "output",
      mediaType: "video",
      originalName: `${motion.title.replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 40) || "motion"}.mp4`,
      storageKey: outKey,
      thumbKey,
      mime: "video/mp4",
      size: storage.size(outKey),
      duration: info.duration,
      width: info.width,
      height: info.height,
      hasAudio: info.hasAudio,
      metadata: info,
      createdAt: now(),
    };
    insertAsset(asset);
    const version = insertVersion({
      conversationId: job.conversationId,
      jobId: job.id,
      parentVersionId: null,
      assetId,
      spec: { motion: { title: motion.title, format: motion.format, duration: motion.duration } } as unknown as EditSpec,
      duration: info.duration,
      width: info.width!,
      height: info.height!,
    });
    setMessageVersion(job.id, version.id);
    finish("preview", `Version ${version.number} saved`);
    updateJob(jobId, { state: "completed", outputVersionId: version.id, finishedAt: now(), stages });
    touchConversation(job.conversationId);
    recordUsage(job, { renderMs: Date.now() - startedMs, inputBytes: 0, outputBytes: asset.size, outputSeconds: info.duration, succeeded: true });
  } catch (err) {
    const job = getJob(jobId);
    if (!job) return;
    if (err instanceof CancelledError) {
      stages = stages.map((s) => (s.status === "active" || s.status === "pending" ? { ...s, status: "skipped", progress: undefined } : s));
      updateJob(jobId, { state: "cancelled", stages, finishedAt: now() });
      return;
    }
    const error: JobError =
      err instanceof MediaError
        ? { message: err.userMessage, code: err.code, retryable: true, diagnostic: err.diagnostic?.slice(-4000) }
        : { message: "Something went wrong while rendering the animation.", code: "internal", retryable: true, diagnostic: err instanceof Error ? err.stack : String(err) };
    stages = stages.map((s) =>
      s.status === "active" ? { ...s, status: "failed", detail: error.message, progress: undefined } : s.status === "pending" ? { ...s, status: "skipped" } : s,
    );
    updateJob(jobId, { state: "failed", stages, error, finishedAt: now() });
    console.error(`[worker] motion job ${jobId} failed: ${error.code}`, error.diagnostic ?? "");
    recordUsage(job, { renderMs: Date.now() - startedMs, inputBytes: 0, outputBytes: 0, outputSeconds: 0, succeeded: false });
  } finally {
    storage.remove(tmpKey);
  }
}
