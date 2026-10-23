import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { before, describe, it } from "node:test";
import { ingestUpload } from "../src/lib/assets";
import { addMessage, createConversation } from "../src/lib/conversations";
import { probe } from "../src/lib/media/probe";
import { runStudioTool, type StudioContext } from "../src/lib/studio/tools";
import { cropPlan, followPath, linearExpr, trackingSupported, type TrackResult } from "../src/lib/studio/track";
import { inputName, resolveInWorkspace } from "../src/lib/studio/workspace";
import { fileChunks, fixtures, useTempDataDir } from "./helpers";

/** Evaluates our crop expressions the way FFmpeg does, for checking. */
function evalExpr(expr: string, t: number): number {
  const clip = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  return Function("t", "clip", `return ${expr};`)(t, clip) as number;
}

const face = (x: number, y = 0.3, w = 0.1, c = 0.9) => ({ x, y, w, h: w * 1.4, c });

describe("subject following", () => {
  it("ignores small jitter, follows real moves and holds through missed frames", () => {
    const track: TrackResult = {
      width: 1920,
      height: 1080,
      duration: 6.5,
      samples: [
        { t: 0, faces: [face(0.2)], people: [] },
        { t: 0.5, faces: [face(0.21)], people: [] },
        { t: 1, faces: [], people: [] },
        { t: 1.5, faces: [face(0.6)], people: [] },
        { t: 2, faces: [face(0.6)], people: [] },
        { t: 2.5, faces: [face(0.6)], people: [] },
        { t: 3, faces: [face(0.6)], people: [] },
        ...[3.5, 4, 4.5, 5, 5.5, 6].map((t) => ({ t, faces: [face(0.6)], people: [] })),
      ],
    };
    const keys = followPath(track);
    assert.equal(keys[0].cx, keys[1].cx, "a 1% wobble is inside the dead zone");
    assert.equal(keys[2].found, false);
    assert.equal(keys[2].cx, keys[1].cx, "holds position when the face is lost");
    assert.ok(keys[3].cx > keys[2].cx && keys[3].cx < 0.65, "eases toward the new position");
    assert.ok(Math.abs(keys.at(-1)!.cx - 0.65) < 0.01, "keeps moving until the subject is centred");
  });

  it("sticks with the current speaker when a second person appears", () => {
    const track: TrackResult = {
      width: 1920,
      height: 1080,
      duration: 2,
      samples: [
        { t: 0, faces: [face(0.2)], people: [] },
        { t: 0.5, faces: [face(0.2), face(0.7, 0.3, 0.11)], people: [] },
        { t: 1, faces: [face(0.2), face(0.7, 0.3, 0.11)], people: [] },
      ],
    };
    const keys = followPath(track);
    assert.ok(keys.every((k) => k.cx < 0.3));
  });

  it("builds a crop window that stays inside the frame and passes through the keys", () => {
    const track: TrackResult = { width: 1920, height: 1080, duration: 3, samples: [] };
    const keys = [
      { t: 0, cx: 0.05, cy: 0.4, found: true },
      { t: 1, cx: 0.5, cy: 0.4, found: true },
      { t: 2, cx: 0.98, cy: 0.4, found: true },
    ];
    const plan = cropPlan(track, keys, { aspect: 9 / 16, zoom: 1 });
    assert.equal(plan.h, 1080);
    assert.equal(plan.w, 606);
    assert.equal(evalExpr(plan.x, 0), 0, "clamped at the left edge");
    assert.ok(Math.abs(evalExpr(plan.x, 1) - (960 - 303)) < 1);
    assert.equal(evalExpr(plan.x, 2.5), 1920 - 606, "clamped at the right edge and holds after the last key");
    const tight = cropPlan(track, keys, { aspect: 9 / 16, zoom: 1.5 });
    assert.equal(tight.h, 720);
    assert.ok(evalExpr(tight.y, 1) >= 0 && evalExpr(tight.y, 1) <= 1080 - 720);
  });

  it("writes flat expressions FFmpeg can parse quickly", () => {
    const e = linearExpr([
      { t: 0, v: 10 },
      { t: 1, v: 10.2 },
      { t: 2, v: 50 },
    ]);
    assert.ok(!e.includes("if("));
    assert.equal(evalExpr(e, 2), 49.8);
  });
});

describe("phase 2 studio tools", () => {
  let ctx: StudioContext;
  let clip = "";
  let broll = "";

  before(async () => {
    useTempDataDir();
    const conversationId = createConversation().id;
    const msg = addMessage({ conversationId, role: "assistant", text: "", attachments: [], jobId: null, versionId: null });
    ctx = { conversationId, messageId: msg.id, runId: "run_test", shouldCancel: () => false };
    const fx = fixtures();
    const a = await ingestUpload({ body: fileChunks(fx.landscapeWithAudio), originalName: "talk.mp4", mime: "video/mp4", conversationId });
    clip = inputName(a);
    // Three visibly different shots, back to back.
    const shotsFile = fx.landscapeWithAudio.replace("landscape.mp4", "three-shots.mp4");
    if (!fs.existsSync(shotsFile)) {
      execFileSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=red:s=640x360:d=1.5:r=25",
        "-f", "lavfi", "-i", "testsrc2=s=640x360:d=1.5:r=25",
        "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=1.5:r=25",
        "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0",
        "-pix_fmt", "yuv420p", shotsFile,
      ]);
    }
    const b = await ingestUpload({ body: fileChunks(shotsFile), originalName: "broll.mp4", mime: "video/mp4", conversationId });
    broll = inputName(b);
  });

  it("finds the shots in a B-roll clip and shows them on a sheet", async () => {
    const out = await runStudioTool("find_shots", { path: broll }, ctx);
    assert.ok(!out.isError, out.text);
    assert.match(out.text, /3 shots/);
    assert.match(out.text, /1\. 0-1\.5\d?s/);
    assert.equal(out.images?.length, 1);
  });

  it("reframes to 9:16 and says honestly when no person was found", { skip: !trackingSupported() }, async () => {
    const out = await runStudioTool("reframe_subject", { input: clip, output: "work/vertical.mp4", start: 1, end: 3 }, ctx);
    assert.ok(!out.isError, out.text);
    assert.match(out.text, /Subject found in 0%/);
    assert.match(out.text, /Few detections/);
    const info = await probe(resolveInWorkspace(ctx.conversationId, "work/vertical.mp4"));
    assert.ok(info.height! > info.width!, "portrait output");
    assert.ok(Math.abs(info.duration! - 2) < 0.15);
    assert.ok(info.hasAudio);
  });
});
