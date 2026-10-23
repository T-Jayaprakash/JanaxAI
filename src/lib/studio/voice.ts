import fs from "node:fs";
import path from "node:path";
import { ffmpeg, MediaError, runProcess } from "../media/ffmpeg";

/**
 * Voiceover providers, best first:
 * - ElevenLabs (ELEVENLABS_API_KEY): the most natural voices; eleven_v4 speaks
 *   Tamil, Telugu, Malayalam, Kannada, Bengali, Hindi and English, and returns
 *   character timings we turn into caption word timings.
 * - Google Cloud Text-to-Speech Chirp 3 HD (GOOGLE_TTS_API_KEY): natural
 *   voices for the same Indian languages at a lower price.
 * - macOS `say`: free but synthetic. Labelled a draft voice everywhere.
 * Keys stay on the server; they're never sent to the browser or the model.
 */

export type VoiceProviderId = "elevenlabs" | "google" | "system";

export interface VoiceInfo {
  id: string;
  name: string;
  note: string;
}

export interface VoiceResult {
  provider: VoiceProviderId;
  premium: boolean;
  voice: string;
  /** Word timings on the voiceover's own timeline, when the provider gives them. */
  words?: { w: string; s: number; e: number }[];
}

export const VOICE_LANGUAGES = ["ta", "en", "hi", "te", "ml", "kn", "bn"] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

const GOOGLE_LOCALE: Record<VoiceLanguage, string> = { ta: "ta-IN", en: "en-IN", hi: "hi-IN", te: "te-IN", ml: "ml-IN", kn: "kn-IN", bn: "bn-IN" };

const SYSTEM_VOICES: Partial<Record<VoiceLanguage, VoiceInfo[]>> = {
  ta: [{ id: "Vani", name: "Vani", note: "Tamil, female" }],
  en: [
    { id: "Rishi", name: "Rishi", note: "Indian English, male" },
    { id: "Tara", name: "Tara", note: "Indian English, female" },
    { id: "Aman", name: "Aman", note: "Indian English, male" },
  ],
  hi: [{ id: "Lekha", name: "Lekha", note: "Hindi, female" }],
  te: [{ id: "Geeta", name: "Geeta", note: "Telugu, female" }],
  kn: [{ id: "Soumya", name: "Soumya", note: "Kannada, female" }],
  bn: [{ id: "Piya", name: "Piya", note: "Bengali, female" }],
};

const elevenKey = () => process.env.ELEVENLABS_API_KEY?.trim() || "";
const googleKey = () => process.env.GOOGLE_TTS_API_KEY?.trim() || "";
const systemAvailable = () => process.platform === "darwin" && fs.existsSync("/usr/bin/say");
const ELEVEN_BASE = () => process.env.ELEVENLABS_BASE_URL?.replace(/\/$/, "") || "https://api.elevenlabs.io";
const GOOGLE_BASE = () => process.env.GOOGLE_TTS_BASE_URL?.replace(/\/$/, "") || "https://texttospeech.googleapis.com";

export function voiceProviders(): { id: VoiceProviderId; label: string; premium: boolean; available: boolean }[] {
  return [
    { id: "elevenlabs", label: "ElevenLabs", premium: true, available: !!elevenKey() },
    { id: "google", label: "Google Chirp 3 HD", premium: true, available: !!googleKey() },
    { id: "system", label: "Draft voice (macOS)", premium: false, available: systemAvailable() },
  ];
}

/** JANUX_VOICE=auto|elevenlabs|google|system; auto picks the best configured one. */
export function activeVoiceProvider(): VoiceProviderId | null {
  const pref = (process.env.JANUX_VOICE || "auto").trim();
  const providers = voiceProviders();
  const wanted = providers.find((p) => p.id === pref);
  if (wanted?.available) return wanted.id;
  return providers.find((p) => p.available)?.id ?? null;
}

export function premiumVoiceAvailable(): boolean {
  return voiceProviders().some((p) => p.premium && p.available);
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw providerError(res.status, await res.text().catch(() => ""));
  return res.json();
}

function providerError(status: number, body: string): MediaError {
  const msg =
    status === 401 || status === 403
      ? "The voice provider rejected the API key. Check it in the server's environment settings."
      : status === 429
        ? "The voice provider's quota or rate limit was reached. Try again shortly, or check the plan."
        : "The voice provider couldn't generate this voiceover.";
  return new MediaError(msg, `HTTP ${status}: ${body.slice(0, 400)}`, "tts_provider");
}

const voiceCache = new Map<string, { at: number; voices: VoiceInfo[] }>();

export async function listVoices(language: VoiceLanguage, provider = activeVoiceProvider()): Promise<VoiceInfo[]> {
  if (!provider) return [];
  const key = `${provider}:${language}`;
  const hit = voiceCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.voices;
  let voices: VoiceInfo[] = [];
  if (provider === "elevenlabs") {
    const data = (await getJson(`${ELEVEN_BASE()}/v1/voices`, { "xi-api-key": elevenKey() })) as {
      voices?: { voice_id: string; name: string; category?: string; labels?: Record<string, string> }[];
    };
    // ElevenLabs voices are multilingual: any voice can speak any supported language.
    voices = (data.voices ?? []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      note: [v.labels?.gender, v.labels?.age, v.labels?.accent, v.labels?.description ?? v.labels?.descriptive, v.labels?.use_case, v.category === "cloned" ? "your cloned voice" : ""]
        .filter(Boolean)
        .join(", "),
    }));
  } else if (provider === "google") {
    const locale = GOOGLE_LOCALE[language];
    const data = (await getJson(`${GOOGLE_BASE()}/v1/voices?languageCode=${locale}&key=${encodeURIComponent(googleKey())}`, {})) as {
      voices?: { name: string; ssmlGender?: string }[];
    };
    voices = (data.voices ?? [])
      .filter((v) => v.name.includes("Chirp3-HD"))
      .map((v) => ({ id: v.name, name: v.name.split("-").pop() ?? v.name, note: `${locale}, ${(v.ssmlGender ?? "").toLowerCase()}` }));
  } else {
    voices = SYSTEM_VOICES[language] ?? [];
  }
  voiceCache.set(key, { at: Date.now(), voices });
  return voices;
}

/** Turn per-character timings into word timings. */
export function wordsFromAlignment(a: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }) {
  const words: { w: string; s: number; e: number }[] = [];
  let cur = "";
  let s = 0;
  let e = 0;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) words.push({ w: cur, s: +s.toFixed(3), e: +e.toFixed(3) });
      cur = "";
      return;
    }
    if (!cur) s = a.character_start_times_seconds[i];
    cur += ch;
    e = a.character_end_times_seconds[i];
  });
  if (cur) words.push({ w: cur, s: +s.toFixed(3), e: +e.toFixed(3) });
  return words;
}

/** Mastering for synthetic voices: they're already clean, so just tame lows and set loudness. */
const PREMIUM_CHAIN = "highpass=f=60,loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000";
/** The macOS voices are thin; a little warmth, compression and presence helps them sit in a mix. */
const SYSTEM_CHAIN =
  "highpass=f=80,equalizer=f=180:t=q:w=1:g=2,acompressor=threshold=-22dB:ratio=3:attack=5:release=90:makeup=2,equalizer=f=3500:t=q:w=1.4:g=2,deesser=i=0.3,loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000";

export async function makeVoiceover(opts: {
  text: string;
  language: VoiceLanguage;
  voice?: string;
  speed: number;
  /** ElevenLabs only: 0 = calm and steady, 1 = expressive. */
  expressiveness?: number;
  output: string;
  workDir: string;
}): Promise<VoiceResult> {
  const provider = activeVoiceProvider();
  if (!provider) throw new MediaError("No voice is available on this server. Add an ElevenLabs or Google Text-to-Speech API key.", "no tts provider", "tts_unavailable");
  fs.mkdirSync(opts.workDir, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const raw = path.join(opts.workDir, `vo-${stamp}.raw`);
  let result: VoiceResult;
  try {
    if (provider === "elevenlabs") {
      const voices = opts.voice ? [] : await listVoices(opts.language, provider);
      const voiceId = opts.voice || process.env.ELEVENLABS_VOICE_ID || voices[0]?.id;
      if (!voiceId) throw new MediaError("No ElevenLabs voice is available on this account.", "empty voice list", "tts_provider");
      const model = process.env.ELEVENLABS_MODEL || "eleven_v4";
      const multilingualV2 = model.startsWith("eleven_multilingual_v2") || model.startsWith("eleven_flash");
      const res = await fetch(`${ELEVEN_BASE()}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_192`, {
        method: "POST",
        headers: { "xi-api-key": elevenKey(), "Content-Type": "application/json" },
        body: JSON.stringify({
          text: opts.text,
          model_id: model,
          ...(multilingualV2 ? {} : { language_code: opts.language }),
          voice_settings: { stability: 0.5 - 0.3 * (opts.expressiveness ?? 0.4), similarity_boost: 0.8, style: opts.expressiveness ?? 0.4, use_speaker_boost: true, speed: Math.min(1.2, Math.max(0.7, opts.speed)) },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw providerError(res.status, await res.text().catch(() => ""));
      const data = (await res.json()) as { audio_base64?: string; alignment?: Parameters<typeof wordsFromAlignment>[0] };
      if (!data.audio_base64) throw new MediaError("The voice provider returned no audio.", "missing audio_base64", "tts_provider");
      fs.writeFileSync(raw, Buffer.from(data.audio_base64, "base64"));
      result = { provider, premium: true, voice: voiceId, words: data.alignment ? wordsFromAlignment(data.alignment) : undefined };
    } else if (provider === "google") {
      const locale = GOOGLE_LOCALE[opts.language];
      const voices = opts.voice ? [] : await listVoices(opts.language, provider);
      const name = opts.voice || voices[0]?.id;
      if (!name) throw new MediaError(`No Chirp 3 HD voice was found for ${locale}.`, "empty voice list", "tts_provider");
      const res = await fetch(`${GOOGLE_BASE()}/v1/text:synthesize?key=${encodeURIComponent(googleKey())}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { text: opts.text }, voice: { languageCode: locale, name }, audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 48000, speakingRate: opts.speed } }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw providerError(res.status, await res.text().catch(() => ""));
      const data = (await res.json()) as { audioContent?: string };
      if (!data.audioContent) throw new MediaError("The voice provider returned no audio.", "missing audioContent", "tts_provider");
      fs.writeFileSync(raw, Buffer.from(data.audioContent, "base64"));
      result = { provider, premium: true, voice: name };
    } else {
      const choices = SYSTEM_VOICES[opts.language] ?? SYSTEM_VOICES.en!;
      const voice = choices.find((v) => v.id === opts.voice)?.id ?? choices[0].id;
      const textFile = path.join(opts.workDir, `vo-${stamp}.txt`);
      fs.writeFileSync(textFile, opts.text);
      try {
        // ~175 words per minute is the default speaking rate.
        await runProcess("/usr/bin/say", ["-v", voice, "-r", String(Math.round(175 * opts.speed)), "--file-format=AIFF", "-o", raw, "-f", textFile], { timeoutMs: 120_000 });
      } finally {
        fs.rmSync(textFile, { force: true });
      }
      result = { provider, premium: false, voice };
    }
    await ffmpeg(["-i", raw, "-af", result.premium ? PREMIUM_CHAIN : SYSTEM_CHAIN, "-ac", "2", "-c:a", "aac", "-b:a", "192k", opts.output], { timeoutMs: 120_000 });
    return result;
  } catch (err) {
    if (err instanceof MediaError) throw err;
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) throw new MediaError("The voice provider took too long to respond.", err.message, "tts_provider");
    throw new MediaError("Couldn't reach the voice provider.", String(err), "tts_provider");
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

/**
 * Studio clean-up for a voice the user recorded themselves (phone, lapel, laptop):
 * noise reduction, rumble cut, de-essing, gentle compression, presence and
 * broadcast loudness. Often the most premium voiceover is the creator's own.
 */
export async function polishVoice(opts: { input: string; output: string; denoise: "light" | "strong"; warmth: boolean }): Promise<void> {
  const chain = [
    "highpass=f=75",
    `afftdn=nr=${opts.denoise === "strong" ? 20 : 10}:nf=-40:tn=1`,
    opts.warmth ? "equalizer=f=160:t=q:w=1:g=2" : "",
    "equalizer=f=350:t=q:w=1.2:g=-2",
    "acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=2",
    "equalizer=f=4000:t=q:w=1.4:g=2",
    "deesser=i=0.4",
    "loudnorm=I=-16:TP=-1.5:LRA=9",
    "aresample=48000",
  ]
    .filter(Boolean)
    .join(",");
  await ffmpeg(["-i", opts.input, "-vn", "-af", chain, "-ac", "2", "-c:a", "aac", "-b:a", "192k", opts.output], { timeoutMs: 300_000 });
}
