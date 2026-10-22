import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";
import { getAsset, ingestUpload, UploadError } from "../src/lib/assets";
import { handleUserMessage } from "../src/lib/chat";
import { createConversation, getSnapshot, getVersion, listVersions } from "../src/lib/conversations";
import { getDb } from "../src/lib/db";
import { claimNextJob, createJob, getJob, recoverInterruptedJobs, retryJob } from "../src/lib/jobs";
import { probe } from "../src/lib/media/probe";
import { processJob } from "../src/lib/render/pipeline";
import { getStorage } from "../src/lib/storage";
import { fileChunks, fixtures, useTempDataDir } from "./helpers";

let fx: ReturnType<typeof fixtures>;

async function upload(p: string, mime: string, conversationId: string | null = null) {
  return ingestUpload({ body: fileChunks(p), originalName: path.basename(p), mime, conversationId });
}

async function runQueued() {
  const job = claimNextJob();
  assert.ok(job, "expected a queued job");
  await processJob(job.id);
  return getJob(job.id)!;
}

describe("uploads", () => {
  before(() => {
    useTempDataDir();
    fx = fixtures();
  });

  it("accepts a valid video and reads metadata", async () => {
    const a = await upload(fx.landscapeWithAudio, "video/mp4");
    assert.equal(a.mediaType, "video");
    assert.equal(a.width, 1280);
    assert.equal(a.height, 720);
    assert.ok(a.hasAudio);
    assert.ok(Math.abs((a.duration ?? 0) - 4) < 0.2);
    assert.ok(getStorage().exists(a.thumbKey!));
  });

  it("accepts images", async () => {
    const a = await upload(fx.image, "image/png");
    assert.equal(a.mediaType, "image");
  });

  it("rejects unsupported extensions", async () => {
    await assert.rejects(
      ingestUpload({ body: fileChunks(fx.image), originalName: "evil.exe", mime: "application/octet-stream", conversationId: null }),
      (e: unknown) => e instanceof UploadError && e.status === 415,
    );
  });

  it("rejects mismatched MIME types", async () => {
    await assert.rejects(upload(fx.landscapeWithAudio, "image/png"), (e: unknown) => e instanceof UploadError && e.status === 415);
  });

  it("rejects corrupted media and leaves no file behind", async () => {
    const before = fs.readdirSync(path.join(process.env.JANUX_DATA_DIR!, "uploads")).length;
    await assert.rejects(upload(fx.corrupt, "video/mp4"), (e: unknown) => e instanceof UploadError && e.status === 422);
    const after = fs.readdirSync(path.join(process.env.JANUX_DATA_DIR!, "uploads")).length;
    assert.equal(after, before);
  });

  it("enforces the size limit on the server", async () => {
    process.env.JANUX_MAX_UPLOAD_MB = "0.01";
    try {
      await assert.rejects(upload(fx.landscapeWithAudio, "video/mp4"), (e: unknown) => e instanceof UploadError && e.status === 413);
    } finally {
      delete process.env.JANUX_MAX_UPLOAD_MB;
    }
  });
});

describe("end-to-end editing journey", () => {
  let conversationId: string;

  before(() => {
    useTempDataDir();
    fx = fixtures();
    conversationId = createConversation().id;
  });

  it("renders a 6-second vertical reel from two clips", async () => {
    const a = await upload(fx.landscapeWithAudio, "video/mp4");
    const b = await upload(fx.smallNoAudio, "video/mp4");
    const res = await handleUserMessage(conversationId, "Combine these clips into a 6-second vertical reel", [a.id, b.id]);
    assert.ok(res.job, "a job should be created");
    assert.equal(res.job.state, "queued");
    assert.equal(res.job.spec.aspect, "9:16");
    assert.equal(res.job.spec.targetDuration, 6);

    const job = await runQueued();
    assert.equal(job.state, "completed", JSON.stringify(job.error));
    assert.ok(job.stages.filter((s) => ["inspect", "plan", "cut", "render", "validate", "preview"].includes(s.id)).every((s) => s.status === "done"));

    const version = getVersion(job.outputVersionId!)!;
    assert.equal(version.number, 1);
    const out = getAsset(version.assetId)!;
    const info = await probe(getStorage().absolutePath(out.storageKey));
    assert.equal(info.width, 720);
    assert.equal(info.height, 1280);
    assert.ok(Math.abs((info.duration ?? 0) - 6) < 0.5, `duration ${info.duration}`);
    assert.ok(info.hasAudio);
  });

  it("revises the previous version (shorter + 16:9)", async () => {
    const res = await handleUserMessage(conversationId, "Make it 4 seconds and change to 16:9", []);
    assert.ok(res.job);
    const v1 = listVersions(conversationId)[0];
    assert.equal(res.job.parentVersionId, v1.id);
    assert.deepEqual(res.job.spec.clips, v1.spec.clips, "revision keeps the same inputs");

    const job = await runQueued();
    assert.equal(job.state, "completed", JSON.stringify(job.error));
    const v2 = getVersion(job.outputVersionId!)!;
    assert.equal(v2.number, 2);
    assert.equal(v2.parentVersionId, v1.id);
    assert.equal(v2.width, 1280);
    assert.equal(v2.height, 720);
    assert.ok(Math.abs(v2.duration - 4) < 0.5);
    // The original version is preserved.
    assert.ok(getStorage().exists(getAsset(v1.assetId)!.storageKey));
  });

  it("renders a cinematic look with an image and a removed clip", async () => {
    const img = await upload(fx.image, "image/png", conversationId);
    let res = await handleUserMessage(conversationId, "add this photo and make it cinematic and black and white", [img.id]);
    assert.ok(res.job);
    assert.equal(res.job.spec.clips.length, 3);
    let job = await runQueued();
    assert.equal(job.state, "completed", JSON.stringify(job.error));

    res = await handleUserMessage(conversationId, "remove the second clip and mute the audio", []);
    assert.ok(res.job);
    assert.equal(res.job.spec.clips.length, 2);
    assert.equal(res.job.spec.audio.keepOriginal, false);
    job = await runQueued();
    assert.equal(job.state, "completed", JSON.stringify(job.error));
  });

  it("shows a previous version without rendering, and revises from it", async () => {
    const res = await handleUserMessage(conversationId, "show me version 1", []);
    assert.equal(res.job, null);
    const v1 = listVersions(conversationId)[0];
    assert.equal(res.messages[1].versionId, v1.id);
    const next = await handleUserMessage(conversationId, "make it square", []);
    assert.equal(next.job?.parentVersionId, v1.id);
    assert.equal(next.job?.spec.targetDuration, 6, "revision starts from version 1's spec");
    const job = await runQueued();
    assert.equal(job.state, "completed");
  });

  it("restores everything from a snapshot (page refresh)", () => {
    const snap = getSnapshot(conversationId)!;
    assert.ok(snap.messages.length >= 10);
    assert.equal(snap.versions.length, 5);
    assert.ok(snap.jobs.every((j) => j.state === "completed"));
    assert.ok(snap.versions.every((v) => v.asset?.url));
    assert.ok(!JSON.stringify(snap).includes(process.env.JANUX_DATA_DIR!), "no server paths leak to the client");
  });
});

describe("failures, retry and recovery", () => {
  let conversationId: string;
  before(() => {
    useTempDataDir();
    fx = fixtures();
    conversationId = createConversation().id;
  });

  it("reports a missing input file as a clear failure and can be retried once fixed", async () => {
    const a = await upload(fx.portrait, "video/quicktime");
    const res = await handleUserMessage(conversationId, "make a 3 second square video", [a.id]);
    const storage = getStorage();
    const real = storage.absolutePath(a.storageKey);
    fs.renameSync(real, real + ".bak");
    const failed = await runQueued();
    assert.equal(failed.state, "failed");
    assert.equal(failed.error?.code, "missing_input");
    assert.ok(failed.stages.some((s) => s.status === "failed"));
    assert.ok(!failed.error!.message.includes(process.env.JANUX_DATA_DIR!));

    fs.renameSync(real + ".bak", real);
    const retried = retryJob(res.job!.id)!;
    assert.equal(retried.state, "queued");
    const ok = await runQueued();
    assert.equal(ok.state, "completed", JSON.stringify(ok.error));
  });

  it("reports FFmpeg errors with a safe message", async () => {
    const a = await upload(fx.landscapeWithAudio, "video/mp4", conversationId);
    // Overwrite the stored file with garbage after upload validation passed.
    fs.writeFileSync(getStorage().absolutePath(a.storageKey), Buffer.alloc(2048, 1));
    await handleUserMessage(conversationId, "make it vertical", [a.id]);
    const job = await runQueued();
    assert.equal(job.state, "failed");
    assert.ok(job.error!.message.length > 0);
    assert.ok(job.error!.diagnostic, "diagnostic kept internally");
  });

  it("re-queues jobs interrupted by a worker crash", () => {
    const job = createJob({
      conversationId,
      parentVersionId: null,
      spec: getJob(listVersions(conversationId)[0].jobId)!.spec,
      planInfo: { planner: "test", usesAI: false, changes: [], unsupported: [], notes: [] },
      timeline: getJob(listVersions(conversationId)[0].jobId)!.timeline!,
    });
    getDb().prepare("UPDATE jobs SET state = 'rendering', attempts = 1 WHERE id = ?").run(job.id);
    const r = recoverInterruptedJobs();
    assert.equal(r.requeued, 1);
    assert.equal(getJob(job.id)!.state, "queued");
  });
});
