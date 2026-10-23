import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalog, creditsFor, searchLibrary } from "../src/lib/library";
import { buildCaptionHtml, CAPTION_STYLES, groupWords } from "../src/lib/library/captions";
import { buildCube, LOOKS } from "../src/lib/library/looks";
import { STICKERS } from "../src/lib/library/stickers";
import { OVERLAY_TRANSITIONS, XFADES } from "../src/lib/library/transitions";
import { checkFfmpegArgs } from "../src/lib/studio/ffmpegGuard";

describe("asset library", () => {
  it("has every phase-1 asset type with a commercial-use licence", async () => {
    const all = await catalog();
    const count = (k: string) => all.filter((e) => e.kind === k).length;
    assert.ok(count("font") >= 80, `fonts ${count("font")}`);
    assert.ok(count("transition") >= 70);
    assert.equal(count("caption_style"), 20);
    assert.ok(count("sticker") >= 15);
    assert.ok(count("emoji") >= 55);
    assert.equal(count("sfx"), 30);
    assert.equal(count("look"), 10);
    assert.ok(count("meme_format") >= 10);
    assert.ok(all.every((e) => e.license.commercialUse));
    assert.equal(new Set(all.map((e) => e.id)).size, all.length, "ids are unique");
  });

  it("searches by meaning words and kind", async () => {
    assert.equal((await searchLibrary("tamil bold", "font"))[0].kind, "font");
    assert.ok((await searchLibrary("tamil", "font")).every((e) => e.tags.includes("tamil")));
    assert.ok((await searchLibrary("glitch")).some((e) => e.id === "transition:glitch"));
    assert.ok((await searchLibrary("karaoke")).some((e) => e.id === "caption:karaoke-gold"));
  });

  it("only credits assets whose licence asks for attribution", async () => {
    const credits = await creditsFor(["font:anek-tamil", "emoji:fire", "emoji:clap", "caption:tamil-mass"]);
    assert.equal(credits.length, 1);
    assert.match(credits[0].license.attribution!, /Noto Emoji/);
  });

  it("covers every xfade transition and builds overlay transitions", async () => {
    assert.ok(XFADES.length >= 58);
    for (const t of OVERLAY_TRANSITIONS) assert.ok(t.html(720, 1280, t.defaultDuration, "#000").length > 50, t.id);
  });

  it("builds valid 3D LUTs", async () => {
    const cube = buildCube(LOOKS[0], 9);
    const lines = cube.trim().split("\n");
    assert.match(lines[1], /LUT_3D_SIZE 9/);
    assert.equal(lines.length, 2 + 9 ** 3);
    assert.ok(lines.slice(2).every((l) => l.split(" ").every((v) => Number(v) >= 0 && Number(v) <= 1)));
  });

  it("keeps Tamil words whole in captions", async () => {
    const words = [
      { w: "இன்னைக்கு", s: 0, e: 0.5 },
      { w: "சூப்பர்", s: 0.5, e: 1 },
      { w: "offer", s: 1, e: 1.4 },
      { w: "இருக்கு", s: 2.5, e: 3 },
    ];
    const groups = groupWords(words, 3);
    assert.equal(groups.length, 2, "a long pause starts a new caption line");
    const { html, fonts } = buildCaptionHtml({ words, style: CAPTION_STYLES.find((c) => c.id === "bold-yellow-pop")!, width: 1080, height: 1920 });
    assert.ok(html.includes('"t":"இன்னைக்கு"'), "the word is stored whole, not as letters");
    assert.ok(fonts[0] === "Catamaran", "switches to a Tamil-capable font");
  });

  it("fills sticker placeholders safely", async () => {
    for (const s of STICKERS) assert.ok(s.snippet.includes("{{delay}}") || s.snippet.includes("animation"), s.id);
  });

  it("allows library LUTs but not arbitrary files", async () => {
    checkFfmpegArgs(["-i", "in/a.mp4", "-vf", "lut3d=lib/looks/teal-orange.cube", "work/o.mp4"]);
    assert.throws(() => checkFfmpegArgs(["-i", "in/a.mp4", "-vf", "lut3d=/etc/passwd", "work/o.mp4"]));
    assert.throws(() => checkFfmpegArgs(["-i", "in/a.mp4", "-vf", "lut3d=file=../x.cube", "work/o.mp4"]));
  });
});
