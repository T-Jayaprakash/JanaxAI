import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAspect, parseDuration, parseRemoveClip, planWithRules } from "../src/lib/planner/rules";
import type { PlannerInput } from "../src/lib/planner/types";
import { assembleArgs, segmentArgs } from "../src/lib/render/commands";
import { validateSpec, type EditSpec } from "../src/lib/spec";
import { buildTimeline, type TimelineAsset } from "../src/lib/timeline";

const id = (n: number) => `ast_${String(n).padStart(32, "0")}`;
const clip = (n: number, duration = 10) => ({ id: id(n), name: `clip${n}.mp4`, mediaType: "video" as const, duration });

function input(p: Partial<PlannerInput>): PlannerInput {
  return { text: "", attachments: [], baseSpec: null, baseVersion: null, baseDuration: null, versions: [], ...p };
}

function render(p: Partial<PlannerInput>) {
  const r = planWithRules(input(p));
  assert.equal(r.kind, "render", JSON.stringify(r));
  return r as Extract<typeof r, { kind: "render" }>;
}

describe("planner parsing", () => {
  it("reads durations", () => {
    assert.equal(parseDuration("a 15-second reel"), 15);
    assert.equal(parseDuration("make it 30 seconds"), 30);
    assert.equal(parseDuration("12s please"), 12);
    assert.equal(parseDuration("1 minute video"), 60);
    assert.equal(parseDuration("half a minute"), 30);
    assert.equal(parseDuration("make it vertical"), null);
  });

  it("reads aspect ratios", () => {
    assert.equal(parseAspect("instagram reel"), "9:16");
    assert.equal(parseAspect("youtube shorts"), "9:16");
    assert.equal(parseAspect("change to 16:9"), "16:9");
    assert.equal(parseAspect("make it square"), "1:1");
    assert.equal(parseAspect("4:5 portrait post"), "4:5");
    assert.equal(parseAspect("make it short"), null);
  });

  it("reads clip removal", () => {
    assert.equal(parseRemoveClip("remove the second clip"), 1);
    assert.equal(parseRemoveClip("delete clip 3"), 2);
    assert.equal(parseRemoveClip("drop the last clip"), -1);
    assert.equal(parseRemoveClip("remove the boring parts"), null);
  });
});

describe("planner decisions", () => {
  it("asks for footage when nothing is attached", () => {
    const r = planWithRules(input({ text: "make a reel" }));
    assert.equal(r.kind, "reply");
  });

  it("plans the MVP request", () => {
    const r = render({ text: "Combine these clips into a 15-second vertical reel.", attachments: [clip(1), clip(2)] });
    assert.equal(r.fresh, true);
    assert.equal(r.spec.aspect, "9:16");
    assert.equal(r.spec.targetDuration, 15);
    assert.equal(r.spec.clips.length, 2);
    assert.match(r.summary, /15-second vertical/);
  });

  it("revises the base spec and keeps everything else", () => {
    const base = render({ text: "make a cinematic reel", attachments: [clip(1), clip(2), clip(3)] }).spec;
    const r = render({ text: "remove the second clip and make it black and white", baseSpec: base, baseDuration: 20 });
    assert.equal(r.fresh, false);
    assert.deepEqual(r.spec.clips.map((c) => c.assetId), [id(1), id(3)]);
    assert.equal(r.spec.look, "bw");
    assert.equal(r.spec.aspect, base.aspect);
  });

  it("'shorter' uses the rendered duration of the base version", () => {
    const base = render({ text: "edit", attachments: [clip(1)] }).spec;
    const r = render({ text: "make it shorter", baseSpec: base, baseDuration: 20 });
    assert.equal(r.spec.targetDuration, 14);
  });

  it("understands a little Tanglish", () => {
    const base = render({ text: "edit", attachments: [clip(1), clip(2)] }).spec;
    const r = render({ text: "sound venam, vertical ah maathu", baseSpec: base, baseDuration: 10 });
    assert.equal(r.spec.audio.keepOriginal, false);
    assert.equal(r.spec.aspect, "9:16");
  });

  it("is honest about unsupported requests", () => {
    const base = render({ text: "edit", attachments: [clip(1)] }).spec;
    const r = planWithRules(input({ text: "add tamil subtitles and background music", baseSpec: base, baseDuration: 10 }));
    assert.equal(r.kind, "reply");
    assert.match((r as { text: string }).text, /speech-to-text/);
    const mixed = render({ text: "make it 9:16 with captions", baseSpec: base, baseDuration: 10 });
    assert.equal(mixed.unsupported.length, 1);
    assert.match(mixed.summary, /Heads up/);
  });

  it("navigates versions without rendering", () => {
    const versions = [
      { id: "v1", number: 1 },
      { id: "v2", number: 2 },
      { id: "v3", number: 3 },
    ];
    const base = render({ text: "edit", attachments: [clip(1)] }).spec;
    const prev = planWithRules(input({ text: "show me the previous version", baseSpec: base, baseVersion: versions[2], versions }));
    assert.deepEqual(prev, { kind: "reply", text: prev.kind === "reply" ? prev.text : "", showVersionId: "v2" });
    const n = planWithRules(input({ text: "go back to version 1", baseSpec: base, baseVersion: versions[2], versions }));
    assert.equal(n.kind === "reply" && n.showVersionId, "v1");
  });

  it("appends clips when asked to add new footage", () => {
    const base = render({ text: "edit", attachments: [clip(1)] }).spec;
    const r = render({ text: "add this clip at the end", attachments: [clip(9)], baseSpec: base, baseDuration: 10 });
    assert.equal(r.fresh, false);
    assert.equal(r.spec.clips.length, 2);
  });
});

describe("timeline", () => {
  const assets = new Map<string, TimelineAsset>([
    [id(1), { id: id(1), name: "a", mediaType: "video", duration: 10, width: 1920, height: 1080, hasAudio: true }],
    [id(2), { id: id(2), name: "b", mediaType: "video", duration: 6, width: 1280, height: 720, hasAudio: false }],
    [id(3), { id: id(3), name: "c", mediaType: "image", duration: null, width: 800, height: 600, hasAudio: false }],
  ]);
  const limits = { outputLongEdge: 1280, imageStillSeconds: 3, maxOutputSeconds: 180 };
  const spec = (p: Partial<EditSpec>): EditSpec =>
    validateSpec({
      version: 1,
      clips: [id(1), id(2), id(3)].map((assetId) => ({ assetId, in: null, out: null })),
      aspect: "9:16",
      fit: "blur",
      targetDuration: 12,
      transition: { type: "fade", duration: 0.5 },
      look: "none",
      audio: { keepOriginal: true, volume: 1 },
      fadeInOut: false,
      ...p,
    });

  it("hits the target duration including transition overlap", () => {
    const tl = buildTimeline(spec({}), assets, limits);
    assert.equal(tl.width, 720);
    assert.equal(tl.height, 1280);
    assert.ok(Math.abs(tl.totalDuration - 12) < 0.01, String(tl.totalDuration));
    assert.equal(tl.segments[1].transitionIn, "fade");
    // Centered windows stay inside the source.
    for (const s of tl.segments) assert.ok(s.srcStart >= 0 && s.srcEnd <= (s.mediaType === "image" ? 3 : 10) + 1e-6);
  });

  it("uses all footage and explains when the target is too long", () => {
    const tl = buildTimeline(spec({ targetDuration: 60 }), assets, limits);
    assert.ok(tl.totalDuration < 19);
    assert.ok(tl.notes.some((n) => n.includes("only have")));
  });

  it("caps output length", () => {
    const tl = buildTimeline(spec({ targetDuration: null }), assets, { ...limits, maxOutputSeconds: 5 });
    assert.ok(tl.totalDuration <= 5.01);
  });

  it("builds FFmpeg argument arrays without shell strings", () => {
    const s = spec({ look: "cinematic", fadeInOut: true });
    const tl = buildTimeline(s, assets, limits);
    const seg = segmentArgs({ input: "/in/a b;rm -rf.mp4", output: "/out/x.mp4", seg: tl.segments[1], timeline: tl, spec: s });
    assert.ok(seg.includes("/in/a b;rm -rf.mp4"), "paths are passed as a single argument");
    assert.ok(seg.includes("anullsrc=r=48000:cl=stereo"), "silent track added for clips without audio");
    const { args, expectedDuration } = assembleArgs({ inputs: ["a", "b", "c"], durations: [4, 4, 4], output: "o.mp4", spec: s, transition: tl.transition });
    assert.equal(expectedDuration, 11);
    const graph = args[args.indexOf("-filter_complex") + 1];
    assert.match(graph, /xfade=transition=fade:duration=0\.5:offset=3\.5/);
    assert.match(graph, /offset=7(?![.\d])/);
    assert.match(graph, /vignette/);
  });
});
