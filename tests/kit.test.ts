import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { turnContext } from "../src/lib/agent/context";
import { UploadError } from "../src/lib/assets";
import { addMessage, createConversation } from "../src/lib/conversations";
import { deleteKitItem, getKitItem, ingestKitFile, listKit, saveStyle, validateCube } from "../src/lib/kit";
import { creditsFor, fontFaceCss, searchLibrary } from "../src/lib/library";
import { checkFfmpegArgs } from "../src/lib/studio/ffmpegGuard";
import { runStudioTool, type StudioContext } from "../src/lib/studio/tools";
import { resolveInWorkspace } from "../src/lib/studio/workspace";
import { useTempDataDir } from "./helpers";

async function* bytes(b: Buffer | string): AsyncIterable<Uint8Array> {
  yield Buffer.from(b);
}

function cube(size: number, rows = size ** 3): string {
  const lines = [`TITLE "test"`, `LUT_3D_SIZE ${size}`];
  for (let i = 0; i < rows; i++) lines.push("0.5 0.25 0.125");
  return lines.join("\n");
}

describe("My Kit", () => {
  let ctx: StudioContext;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "janux-kit-"));

  before(async () => {
    useTempDataDir();
    const conversationId = (await createConversation()).id;
    const msg = await addMessage({ conversationId, role: "assistant", text: "", attachments: [], jobId: null, versionId: null });
    ctx = { conversationId, messageId: msg.id, runId: "run_test", shouldCancel: () => false };
  });

  it("validates .cube LUTs by content", async () => {
    assert.equal(validateCube(cube(2)).size, 2);
    assert.throws(() => validateCube(cube(2, 7)), UploadError);
    assert.throws(() => validateCube("just text"), UploadError);
    assert.throws(() => validateCube(cube(2).replace("0.5 0.25 0.125", "red green blue")), UploadError);
  });

  it("rejects files that aren't what they claim to be", async () => {
    await assert.rejects(ingestKitFile({ body: bytes("not a font"), kind: "font", originalName: "brand.ttf" }), /doesn't look like a font/);
    await assert.rejects(ingestKitFile({ body: bytes(cube(2, 3)), kind: "lut", originalName: "look.cube" }), /colour rows/);
    await assert.rejects(ingestKitFile({ body: bytes("x"), kind: "logo", originalName: "logo.exe" }), /For logo upload/);
    await assert.rejects(ingestKitFile({ body: bytes("not an image"), kind: "logo", originalName: "logo.png" }));
    assert.equal((await listKit("local")).length, 0);
    assert.deepEqual(fs.readdirSync(path.join(process.env.JANUX_DATA_DIR!, "kits", "local")), []);
  });

  it("imports a font, LUT, logo and sound, and the editor can use them", async () => {
    const font = await ingestKitFile({ body: bytes(Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(64)])), kind: "font", originalName: "Brand-Bold.ttf", name: "Brand Sans 'Bold'" });
    assert.equal(font.meta.family, "Brand Sans Bold");
    const lut = await ingestKitFile({ body: bytes(cube(2)), kind: "lut", originalName: "warm.cube", name: "Shop warm", credit: "LUT by Example Studio" });
    const logoFile = path.join(tmp, "logo.png");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=120x60", "-frames:v", "1", logoFile]);
    const logo = await ingestKitFile({ body: bytes(fs.readFileSync(logoFile)), kind: "logo", originalName: "logo.png", name: "Shop logo" });
    assert.equal(logo.meta.width, 120);
    const sfxFile = path.join(tmp, "ding.wav");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=0.5", sfxFile]);
    const sfx = await ingestKitFile({ body: bytes(fs.readFileSync(sfxFile)), kind: "sfx", originalName: "ding.wav", notes: "our shop bell" });
    assert.ok(Number(sfx.meta.duration) > 0.4);

    // The workspace sees the kit read-only at kit/.
    await runStudioTool("list_media", {}, ctx);
    assert.ok(fs.existsSync(resolveInWorkspace(ctx.conversationId, `kit/${lut.file}`)));

    // Search puts the user's own resources first; credits come from the kit.
    const hits = await searchLibrary("warm", "local", undefined, 5);
    assert.equal(hits[0].id, `kit:${lut.id}`);
    assert.deepEqual((await creditsFor([`kit:${lut.id}`], "local")).map((c) => c.license.attribution), ["LUT by Example Studio"]);
    assert.match((await fontFaceCss(`<div style="font-family:'Brand Sans Bold'">Hi</div>`, "local")).css, /font-family:'Brand Sans Bold'/);

    // The guard lets FFmpeg read kit files (inputs and LUTs) but never write there.
    assert.doesNotThrow(() => checkFfmpegArgs(["-i", `kit/${sfx.file}`, "-vf", `lut3d=kit/${lut.file}`, "work/o.mp4"]));
    assert.throws(() => checkFfmpegArgs(["-i", "in/a.mp4", `kit/${lut.file}`]), /under work/);
    assert.throws(() => checkFfmpegArgs(["-i", "in/a.mp4", "-vf", "lut3d=kit/../../x.cube", "work/o.mp4"]));

    // Using the LUT in an edit records it, so delivery credits it.
    const run = await runStudioTool(
      "run_ffmpeg",
      { purpose: "Grade", args: ["-f", "lavfi", "-i", "color=c=gray:s=64x64:d=0.5", "-vf", `lut3d=kit/${lut.file}`, "-pix_fmt", "yuv420p", "work/graded.mp4"] },
      ctx,
    );
    assert.ok(!run.isError, run.text);
    const used = JSON.parse(fs.readFileSync(resolveInWorkspace(ctx.conversationId, "cache/used-assets.json"), "utf8"));
    assert.ok(used.includes(`kit:${lut.id}`));

    const got = await runStudioTool("get_asset", { id: `kit:${sfx.id}` }, ctx);
    assert.match(got.text, /our shop bell/);
    assert.match(got.text, new RegExp(`kit/${sfx.file}`));
  });

  it("saves styles (by name) and shows the kit to the editor", async () => {
    const saved = await runStudioTool("save_style", { name: "Shop reels", notes: "Clean white captions, warm grade, no emoji." }, ctx);
    assert.ok(!saved.isError, saved.text);
    await saveStyle({ name: "shop reels", notes: "Clean white captions, warm grade, no emoji, logo at the end." }, "local");
    const styles = await listKit("local", "style");
    assert.equal(styles.length, 1);
    const context = await turnContext(ctx.conversationId);
    assert.match(context, /Style "Shop reels".*logo at the end/);
    assert.match(context, /font 'Brand Sans Bold'/);
  });

  it("deletes items and their files", async () => {
    const logo = (await listKit("local", "logo"))[0];
    const file = path.join(process.env.JANUX_DATA_DIR!, "kits", "local", logo.file!);
    assert.ok(fs.existsSync(file));
    assert.equal(await deleteKitItem(logo.id, "local"), true);
    assert.equal(fs.existsSync(file), false);
    assert.equal(await getKitItem(logo.id, "local"), null);
  });
});
