import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { addMessage, createConversation } from "../src/lib/conversations";
import { runStudioTool, type StudioContext } from "../src/lib/studio/tools";
import { activeVoiceProvider, wordsFromAlignment } from "../src/lib/studio/voice";
import { resolveInWorkspace } from "../src/lib/studio/workspace";
import { useTempDataDir } from "./helpers";

/** A fake ElevenLabs + Google TTS server that records what it was sent. */
function mockProviders() {
  const wav = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=1.2", "-ac", "1", "-f", "wav", "-"]);
  const seen: { url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", headers: req.headers, body });
      const json = (code: number, data: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (req.headers["xi-api-key"] === "bad") return json(401, { detail: "invalid key" });
      if (req.url === "/v1/voices") return json(200, { voices: [{ voice_id: "v_warm", name: "Meera", labels: { gender: "female", use_case: "narration" } }] });
      if (req.url?.startsWith("/v1/text-to-speech/")) {
        const chars = [..."Vanakkam Trichy"];
        return json(200, {
          audio_base64: wav.toString("base64"),
          alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.05), character_end_times_seconds: chars.map((_, i) => i * 0.05 + 0.05) },
        });
      }
      if (req.url?.startsWith("/v1/voices?languageCode=ta-IN")) return json(200, { voices: [{ name: "ta-IN-Standard-A" }, { name: "ta-IN-Chirp3-HD-Kore", ssmlGender: "FEMALE" }] });
      if (req.url?.startsWith("/v1/text:synthesize")) return json(200, { audioContent: wav.toString("base64") });
      json(404, {});
    });
  });
  return { server, seen, wav };
}

describe("voiceover providers", () => {
  let ctx: StudioContext;
  const mock = mockProviders();
  const saved = { ...process.env };

  before(async () => {
    useTempDataDir();
    const conversationId = (await createConversation()).id;
    const msg = await addMessage({ conversationId, role: "assistant", text: "", attachments: [], jobId: null, versionId: null });
    ctx = { conversationId, messageId: msg.id, runId: "run_test", shouldCancel: () => false };
    await new Promise<void>((r) => mock.server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
    process.env.ELEVENLABS_BASE_URL = base;
    process.env.GOOGLE_TTS_BASE_URL = base;
  });

  after(async () => {
    mock.server.close();
    for (const k of ["ELEVENLABS_API_KEY", "GOOGLE_TTS_API_KEY", "ELEVENLABS_BASE_URL", "GOOGLE_TTS_BASE_URL", "JANUX_VOICE"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("turns character timings into word timings", async () => {
    const chars = [..."hi  there"];
    const words = wordsFromAlignment({ characters: chars, character_start_times_seconds: chars.map((_, i) => i), character_end_times_seconds: chars.map((_, i) => i + 1) });
    assert.deepEqual(words, [
      { w: "hi", s: 0, e: 2 },
      { w: "there", s: 4, e: 9 },
    ]);
  });

  it("prefers ElevenLabs, sends the key only in a header, and saves word timings", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    process.env.GOOGLE_TTS_API_KEY = "g-key";
    delete process.env.JANUX_VOICE;
    assert.equal(activeVoiceProvider(), "elevenlabs");
    const list = await runStudioTool("list_voices", { language: "ta" }, ctx);
    assert.match(list.text, /v_warm: Meera/);
    assert.match(list.text, /premium/);
    const vo = await runStudioTool("generate_voiceover", { text: "வணக்கம் Trichy", language: "ta", output: "work/vo-ta.m4a" }, ctx);
    assert.ok(!vo.isError, vo.text);
    assert.match(vo.text, /premium voice v_warm/);
    const call = mock.seen.find((s) => s.url.includes("/with-timestamps"))!;
    assert.equal(call.headers["xi-api-key"], "test-key");
    assert.ok(!call.url.includes("test-key"));
    const body = JSON.parse(call.body);
    assert.equal(body.model_id, "eleven_v4");
    assert.equal(body.language_code, "ta");
    const words = JSON.parse(fs.readFileSync(resolveInWorkspace(ctx.conversationId, "cache/vo-words-vo-ta.json"), "utf8")).words;
    assert.deepEqual(words.map((w: { w: string }) => w.w), ["Vanakkam", "Trichy"]);
    assert.ok(fs.statSync(resolveInWorkspace(ctx.conversationId, "work/vo-ta.m4a")).size > 1000);
  });

  it("uses a Chirp 3 HD voice with Google", async () => {
    process.env.JANUX_VOICE = "google";
    const vo = await runStudioTool("generate_voiceover", { text: "வணக்கம்", language: "ta", speed: 1.1, output: "work/vo-g.m4a" }, ctx);
    assert.ok(!vo.isError, vo.text);
    const call = mock.seen.find((s) => s.url.startsWith("/v1/text:synthesize"))!;
    const body = JSON.parse(call.body);
    assert.equal(body.voice.name, "ta-IN-Chirp3-HD-Kore");
    assert.equal(body.audioConfig.speakingRate, 1.1);
  });

  it("explains a rejected key without leaking it", async () => {
    process.env.JANUX_VOICE = "elevenlabs";
    process.env.ELEVENLABS_API_KEY = "bad";
    const vo = await runStudioTool("generate_voiceover", { text: "Hello", language: "en", voice: "v_warm", output: "work/vo-bad.m4a" }, ctx);
    assert.equal(vo.isError, true);
    assert.match(vo.text, /rejected the API key/);
    assert.ok(!vo.text.includes("bad"));
  });

  it("falls back to the draft voice and says so", { skip: process.platform !== "darwin" }, async () => {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.GOOGLE_TTS_API_KEY;
    delete process.env.JANUX_VOICE;
    const vo = await runStudioTool("generate_voiceover", { text: "Welcome to the shop.", language: "en", output: "work/vo-sys.m4a" }, ctx);
    assert.ok(!vo.isError, vo.text);
    assert.match(vo.text, /draft voice/);
  });

  it("polishes a user's own recording", async () => {
    const src = resolveInWorkspace(ctx.conversationId, "work/raw-voice.wav", { writable: true });
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=2", "-f", "lavfi", "-i", "anoisesrc=d=2:a=0.05", "-filter_complex", "amix=inputs=2", src]);
    const out = await runStudioTool("polish_voice", { input: "work/raw-voice.wav", output: "work/voice-clean.m4a", denoise: "strong", warmth: true }, ctx);
    assert.ok(!out.isError, out.text);
    assert.match(out.text, /Voice polished/);
  });
});
