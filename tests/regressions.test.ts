import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";
import { ingestUpload } from "../src/lib/assets";
import { claimNextAgentRun, queueAgentRun } from "../src/lib/agent/run";
import { addMessage, createConversation } from "../src/lib/conversations";
import { measureDuration } from "../src/lib/media/probe";
import { fixtures, useTempDataDir } from "./helpers";

const repoModel = path.resolve("data/models/ggml-small.bin");

/** A WebM written to a pipe has no duration in its header, like a browser recording. */
function browserStyleWebm(dir: string, src: string): string {
  const out = path.join(dir, "browser-like.webm");
  const buf = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", src, "-t", "3", "-vn", "-c:a", "libopus", "-f", "webm", "pipe:1"], { maxBuffer: 16 * 1024 * 1024 });
  fs.writeFileSync(out, buf);
  return out;
}

describe("browser recordings without a stored duration", () => {
  let dir: string;
  let webm: string;
  before(async () => {
    dir = useTempDataDir();
    webm = browserStyleWebm(dir, fixtures().landscapeWithAudio);
  });

  it("measures the duration by decoding", async () => {
    const d = await measureDuration(webm, "audio");
    assert.ok(d && Math.abs(d - 3) < 0.3, String(d));
  });

  it("accepts the file as music", async () => {
    const a = await ingestUpload({ body: fs.createReadStream(webm) as never, originalName: "song.webm", mime: "audio/webm", conversationId: null });
    assert.equal(a.mediaType, "audio");
    assert.ok(a.duration && a.duration > 2.5);
  });

  it("accepts and transcribes it as a voice note", { skip: fs.existsSync(repoModel) ? false : "speech model not installed" }, async () => {
    process.env.WHISPER_MODEL = repoModel;
    try {
      const a = await ingestUpload({ body: fs.createReadStream(webm) as never, originalName: "voice-note.webm", mime: "audio/webm", conversationId: null, purpose: "voice" });
      assert.equal(a.metadata.voiceNote, true);
    } catch (err) {
      // The fixture is a sine tone, so "no words" is the expected outcome; anything else is a bug.
      assert.match((err as Error).message, /couldn't hear any words/);
    } finally {
      delete process.env.WHISPER_MODEL;
    }
  });
});

describe("assistant replies", () => {
  before(() => useTempDataDir());

  it("runs one reply at a time per conversation", async () => {
    const a = (await createConversation()).id;
    const b = (await createConversation()).id;
    const m = async (c: string) => (await addMessage({ conversationId: c, role: "assistant", text: "", attachments: [], jobId: null, versionId: null })).id;
    const first = await queueAgentRun(a, await m(a), "test");
    const followUp = await queueAgentRun(a, await m(a), "test");
    const other = await queueAgentRun(b, await m(b), "test");
    assert.equal((await claimNextAgentRun())?.id, first.id);
    // The follow-up in the same conversation waits; another conversation can run.
    assert.equal((await claimNextAgentRun())?.id, other.id);
    assert.equal(await claimNextAgentRun(), null);
    assert.ok(followUp.id);
  });
});
