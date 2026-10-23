import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config";
import { ffmpeg, MediaError, runProcess } from "../media/ffmpeg";

export interface Transcript {
  text: string;
  /** ISO 639-1 code detected by the model, e.g. "ta", "ml", "te", "hi", "en". */
  language: string;
  provider: string;
}

/**
 * Speech-to-text runs locally with whisper.cpp, so voice notes never leave
 * this computer. Whisper detects the language itself (Tamil, Malayalam,
 * Telugu, Hindi, English and ~90 more). Another provider can implement the
 * same function signature later.
 */
export function speechConfig() {
  const dataDir = getConfig().dataDir;
  return {
    cli: process.env.WHISPER_CLI || "whisper-cli",
    model: process.env.WHISPER_MODEL || path.join(/*turbopackIgnore: true*/ dataDir, "models", "ggml-small.bin"),
  };
}

export function isSpeechAvailable(): boolean {
  return fs.existsSync(speechConfig().model);
}

export const LANGUAGE_NAMES: Record<string, string> = {
  ta: "Tamil", ml: "Malayalam", te: "Telugu", kn: "Kannada", hi: "Hindi", en: "English", mr: "Marathi",
  bn: "Bengali", gu: "Gujarati", pa: "Punjabi", ur: "Urdu", ar: "Arabic", fr: "French", es: "Spanish", de: "German",
};

/** Steers Whisper to write Tamil speech in English letters (Tanglish). */
const TANGLISH_HINT =
  "Tanglish, Tamil written in English letters: Intha video-va reel-a maathu. Enna panra? Seri, adhu nalla irukku. " +
  "Konjam fast-a pannu. Music kammi pannu. Caption podu. Venam. Kadaisila en number podu.";

export type TranscribeStyle = "auto" | "tanglish";

export async function transcribe(audioPath: string, workDir: string, style: TranscribeStyle = "auto"): Promise<Transcript> {
  const cfg = speechConfig();
  if (!fs.existsSync(cfg.model)) {
    throw new MediaError("Voice notes need the speech model. Run: npm run setup:speech", "whisper model missing", "speech_unavailable");
  }
  fs.mkdirSync(workDir, { recursive: true });
  const wav = path.join(workDir, "voice.wav");
  const base = path.join(workDir, "voice");
  // whisper.cpp expects 16 kHz mono PCM.
  await ffmpeg(["-i", audioPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-t", "600", wav], { timeoutMs: 60_000 });
  try {
    const lang = style === "tanglish" ? ["-l", "en", "--prompt", TANGLISH_HINT] : ["-l", "auto"];
    await runProcess(cfg.cli, ["-m", cfg.model, ...lang, "-f", wav, "-oj", "-of", base, "-np", "-t", "4"], { timeoutMs: 180_000 });
  } catch (err) {
    if (err instanceof MediaError && err.code === "ffmpeg_missing") {
      throw new MediaError("Speech recognition (whisper.cpp) is not installed. Run: npm run setup:speech", err.diagnostic, "speech_unavailable");
    }
    throw new MediaError("Couldn't understand that voice note. Try recording again a little closer to the mic.", err instanceof Error ? err.message : String(err), "speech_failed");
  }
  const raw = JSON.parse(fs.readFileSync(`${base}.json`, "utf8")) as {
    result?: { language?: string };
    transcription?: { text?: string }[];
  };
  const text = (raw.transcription ?? []).map((s) => s.text ?? "").join("").replace(/\s+/g, " ").trim();
  return { text, language: style === "tanglish" ? "ta-Latn" : (raw.result?.language ?? "unknown"), provider: "whisper.cpp (local)" };
}
