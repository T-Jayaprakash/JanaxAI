import fs from "node:fs";
import path from "node:path";
import { ffmpeg, MediaError, runProcess } from "../media/ffmpeg";

/**
 * Voiceover and sound effects made on this machine, with no paid service:
 * - Voiceover uses the operating system's speech voices (macOS `say`). They
 *   are clear but synthetic; a cloud voice provider can replace this later.
 * - Sound effects are synthesised with FFmpeg audio generators.
 */

export const VOICES: Record<string, { voice: string; note: string }[]> = {
  ta: [{ voice: "Vani", note: "Tamil, female" }],
  en: [
    { voice: "Rishi", note: "Indian English, male" },
    { voice: "Tara", note: "Indian English, female" },
    { voice: "Aman", note: "Indian English, male" },
  ],
  hi: [{ voice: "Lekha", note: "Hindi, female" }],
  te: [{ voice: "Geeta", note: "Telugu, female" }],
  kn: [{ voice: "Soumya", note: "Kannada, female" }],
  bn: [{ voice: "Piya", note: "Bengali, female" }],
};

export function voiceoverAvailable(): boolean {
  return process.platform === "darwin" && fs.existsSync("/usr/bin/say");
}

/** Speaks `text` and writes a 48 kHz stereo AAC file, loudness-normalised for video. */
export async function makeVoiceover(opts: { text: string; language: string; voice?: string; speed: number; output: string; workDir: string }): Promise<void> {
  if (!voiceoverAvailable()) {
    throw new MediaError("Voiceover needs the built-in voices of macOS; no cloud voice provider is configured on this server.", "say missing", "tts_unavailable");
  }
  const choices = VOICES[opts.language] ?? VOICES.en;
  const voice = choices.find((v) => v.voice === opts.voice)?.voice ?? choices[0].voice;
  fs.mkdirSync(opts.workDir, { recursive: true });
  const textFile = path.join(opts.workDir, `vo-${Date.now()}.txt`);
  const aiff = path.join(opts.workDir, `vo-${Date.now()}.aiff`);
  fs.writeFileSync(textFile, opts.text);
  // ~175 words per minute is the default speaking rate.
  const rate = Math.round(175 * opts.speed);
  try {
    await runProcess("/usr/bin/say", ["-v", voice, "-r", String(rate), "-o", aiff, "-f", textFile], { timeoutMs: 120_000 });
    await ffmpeg(["-i", aiff, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000", "-ac", "2", "-c:a", "aac", "-b:a", "192k", opts.output], { timeoutMs: 120_000 });
  } finally {
    fs.rmSync(textFile, { force: true });
    fs.rmSync(aiff, { force: true });
  }
}

export const SFX_TYPES = ["whoosh", "swipe", "pop", "click", "ding", "chime", "riser", "impact", "boom", "glitch", "typing", "shutter"] as const;
export type SfxType = (typeof SFX_TYPES)[number];

/** FFmpeg audio-generator recipes; `D` is replaced with the duration. */
function recipe(type: SfxType, d: number): { input: string[]; filter: string } {
  const D = d.toFixed(3);
  const lavfi = (src: string) => ["-f", "lavfi", "-t", D, "-i", src];
  switch (type) {
    case "whoosh":
      return {
        input: lavfi(`anoisesrc=d=${D}:c=pink:a=0.6`),
        filter: `highpass=f=250,lowpass=f=3500,afade=t=in:d=${(d * 0.45).toFixed(3)}:curve=exp,afade=t=out:st=${(d * 0.45).toFixed(3)}:d=${(d * 0.55).toFixed(3)}`,
      };
    case "swipe":
      return { input: lavfi(`anoisesrc=d=${D}:c=white:a=0.5`), filter: `bandpass=f=2500:w=1800,afade=t=in:d=${(d * 0.3).toFixed(3)},afade=t=out:st=${(d * 0.3).toFixed(3)}:d=${(d * 0.7).toFixed(3)}` };
    case "pop":
      return { input: lavfi(`aevalsrc='0.9*sin(2*PI*(900-5000*t)*t)*exp(-28*t)':s=48000:d=${D}`), filter: "anull" };
    case "click":
      return { input: lavfi(`aevalsrc='0.9*(random(0)-0.5)*exp(-250*t)':s=48000:d=${D}`), filter: "highpass=f=800" };
    case "ding":
      return { input: lavfi(`aevalsrc='0.55*sin(2*PI*1320*t)*exp(-3.5*t)+0.25*sin(2*PI*2640*t)*exp(-5*t)':s=48000:d=${D}`), filter: "anull" };
    case "chime":
      return {
        input: lavfi(
          `aevalsrc='0.45*sin(2*PI*988*t)*exp(-4*t)+0.45*gte(t,0.14)*sin(2*PI*1319*(t-0.14))*exp(-3.5*(t-0.14))':s=48000:d=${D}`,
        ),
        filter: "anull",
      };
    case "riser":
      return {
        input: lavfi(`aevalsrc='0.5*sin(2*PI*(180*t+900*t*t/${D}))*(t/${D})+0.15*(random(0)-0.5)*(t/${D})':s=48000:d=${D}`),
        filter: `highpass=f=120,afade=t=out:st=${(d * 0.95).toFixed(3)}:d=${(d * 0.05).toFixed(3)}`,
      };
    case "impact":
      return { input: lavfi(`aevalsrc='0.9*sin(2*PI*(90-50*t)*t)*exp(-6*t)+0.4*(random(0)-0.5)*exp(-30*t)':s=48000:d=${D}`), filter: "lowpass=f=3000" };
    case "boom":
      return { input: lavfi(`aevalsrc='1.0*sin(2*PI*(55-30*t)*t)*exp(-2.2*t)':s=48000:d=${D}`), filter: "lowpass=f=400,volume=1.6" };
    case "glitch":
      return { input: lavfi(`aevalsrc='0.5*sgn(sin(2*PI*(200+600*floor(random(0)*4))*t))*gt(sin(2*PI*14*t),0)':s=48000:d=${D}`), filter: "lowpass=f=5000" };
    case "typing":
      return { input: lavfi(`aevalsrc='0.8*(random(0)-0.5)*exp(-300*mod(t,0.11))*gt(random(1),0.25)':s=48000:d=${D}`), filter: "highpass=f=1200" };
    case "shutter":
      return {
        input: lavfi(`aevalsrc='0.9*(random(0)-0.5)*(exp(-120*t)+gte(t,0.09)*exp(-120*(t-0.09)))':s=48000:d=${D}`),
        filter: "bandpass=f=3000:w=2500",
      };
  }
}

export const SFX_DEFAULT_DURATION: Record<SfxType, number> = {
  whoosh: 0.7, swipe: 0.3, pop: 0.15, click: 0.05, ding: 1.2, chime: 1.2, riser: 2.5, impact: 1.0, boom: 2.0, glitch: 0.5, typing: 1.5, shutter: 0.3,
};

export async function makeSoundEffect(type: SfxType, duration: number, output: string, volume = 1): Promise<void> {
  const { input, filter } = recipe(type, duration);
  await ffmpeg([...input, "-af", `${filter},volume=${volume.toFixed(2)},aresample=48000`, "-ac", "2", "-c:a", "pcm_s16le", output], { timeoutMs: 30_000 });
}
