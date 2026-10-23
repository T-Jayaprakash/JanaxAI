import fs from "node:fs";
import path from "node:path";
import { newId } from "@/lib/db";
import { jsonError, rateLimit } from "@/lib/http";
import { MediaError } from "@/lib/media/ffmpeg";
import { isSpeechAvailable, transcribe } from "@/lib/speech/transcribe";
import { getStorage } from "@/lib/storage";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Dictation: turns a short recording into text for the message box. The
 * audio is transcribed locally and deleted straight away; nothing is stored.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "transcribe", 30);
  if (limited) return limited;
  if (!isSpeechAvailable()) return jsonError(503, "Speech recognition isn't set up. Run: npm run setup:speech");
  if (!req.body) return jsonError(400, "No audio received.");
  const mime = (req.headers.get("content-type") ?? "").split(";")[0];
  if (!/^audio\//.test(mime)) return jsonError(415, "Send audio only.");
  const id = newId("dict");
  const dir = getStorage().ensureDir(`tmp/${id}`);
  const file = path.join(dir, "speech.audio");
  try {
    let size = 0;
    const out = fs.createWriteStream(file);
    for await (const chunk of req.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > MAX_BYTES) {
        out.destroy();
        return jsonError(413, "That recording is too long. Keep dictation under a few minutes.");
      }
      out.write(chunk);
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    const style = new URL(req.url).searchParams.get("style") === "tanglish" ? "tanglish" : "auto";
    const t = await transcribe(file, path.join(dir, "work"), style);
    return Response.json({ text: t.text, language: t.language });
  } catch (err) {
    if (err instanceof MediaError) return jsonError(422, err.userMessage);
    console.error("[api] transcribe failed", err);
    return jsonError(500, "Couldn't transcribe that. Please try again.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
