import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { getAsset } from "../src/lib/assets";
import { createConversation, getVersion } from "../src/lib/conversations";
import { chromePath, closeBrowser, renderHtmlToPng } from "../src/lib/graphics/render";
import { claimNextJob, createMotionJob, getJob } from "../src/lib/jobs";
import { probe } from "../src/lib/media/probe";
import { processJob } from "../src/lib/render/pipeline";
import { getStorage } from "../src/lib/storage";
import { useTempDataDir } from "./helpers";

const hasChrome = !!chromePath();

describe("graphics rendering", { skip: hasChrome ? false : "Chrome not installed" }, () => {
  let dir: string;
  before(async () => {
    dir = useTempDataDir();
  });
  after(closeBrowser);

  it("renders a poster to an exact-size PNG", async () => {
    const out = path.join(dir, "poster.png");
    await renderHtmlToPng(
      `<div style="width:1080px;height:1350px;background:#0B1210;color:#21F36A;font:700 96px sans-serif;display:flex;align-items:center;justify-content:center">வணக்கம் Sale</div>`,
      1080,
      1350,
      out,
    );
    const info = await probe(out);
    assert.equal(info.width, 1080);
    assert.equal(info.height, 1350);
  });

  it("renders an animated composition to MP4 through the worker pipeline", async () => {
    const conversationId = (await createConversation()).id;
    const job = await createMotionJob({
      conversationId,
      motion: {
        title: "Intro",
        format: "16:9",
        duration: 2,
        fps: 15,
        html: `<style>@keyframes in{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:none}}
          h1{animation:in 1s ease-out both;color:#fff;font:700 80px sans-serif;margin:0}
          body{background:#050807;display:flex;align-items:center;justify-content:center}</style><h1>JANUXAI</h1>`,
      },
      planInfo: { planner: "test", usesAI: false, changes: [], unsupported: [], notes: [] },
    });
    const claimed = await claimNextJob();
    assert.equal(claimed?.id, job.id);
    await processJob(job.id);
    const done = (await getJob(job.id))!;
    assert.equal(done.state, "completed", JSON.stringify(done.error));
    const v = (await getVersion(done.outputVersionId!))!;
    const a = (await getAsset(v.assetId))!;
    const info = await probe(getStorage().absolutePath(a.storageKey));
    assert.equal(info.width, 1280);
    assert.equal(info.height, 720);
    assert.ok(Math.abs((info.duration ?? 0) - 2) < 0.3);
    assert.ok(fs.existsSync(getStorage().absolutePath(a.thumbKey!)));
  });
});
