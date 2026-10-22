import fs from "node:fs";
import path from "node:path";
import { ffmpeg } from "../media/ffmpeg";

export interface AudioAnalysis {
  duration: number;
  bpm: number | null;
  /** Estimated beat grid in seconds. */
  beats: number[];
  /** Strong hits (drops, snares, accents) in seconds. */
  accents: number[];
  /** Quiet stretches longer than 0.4s: [start, end]. */
  silences: [number, number][];
  /** Loudness per second (0..1), for finding drops and calm parts. */
  energyPerSecond: number[];
}

const SR = 22050;
const HOP = 512;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Simple, dependency-free beat and accent detection: an onset envelope from
 * frame-to-frame energy rises, tempo from its autocorrelation (60-180 BPM),
 * and the beat phase that lines up best with the onsets.
 */
export async function analyzeAudio(input: string, cacheDir: string): Promise<AudioAnalysis> {
  fs.mkdirSync(cacheDir, { recursive: true });
  const raw = path.join(cacheDir, `pcm-${Date.now()}.f32`);
  await ffmpeg(["-i", input, "-vn", "-ac", "1", "-ar", String(SR), "-t", "900", "-f", "f32le", raw], { timeoutMs: 120_000 });
  const buf = fs.readFileSync(raw);
  fs.rmSync(raw, { force: true });
  const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const frames = Math.floor(samples.length / HOP);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * HOP; i < (f + 1) * HOP; i++) {
      // First difference emphasises transients over sustained tones.
      const d = samples[i] - (i > 0 ? samples[i - 1] : 0);
      sum += d * d;
    }
    rms[f] = Math.sqrt(sum / HOP);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, rms[f] - rms[f - 1]);
  const fps = SR / HOP;
  const duration = samples.length / SR;

  // Tempo by autocorrelation of the onset envelope.
  let bestLag = 0;
  let bestScore = 0;
  const minLag = Math.round((60 / 180) * fps);
  const maxLag = Math.round((60 / 60) * fps);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag];
    // Mild preference for 90-130 BPM, typical for reels.
    const bpm = (60 * fps) / lag;
    const weight = 1 - Math.min(Math.abs(bpm - 110) / 200, 0.4);
    if (s * weight > bestScore) {
      bestScore = s * weight;
      bestLag = lag;
    }
  }
  // Accents: local peaks well above the typical onset strength.
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= Math.max(frames, 1);
  let variance = 0;
  for (const v of onset) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / Math.max(frames, 1));
  const ac = (lag: number) => {
    let s = 0;
    for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag];
    return s;
  };
  // Octave check: autocorrelation also peaks at double the period, so
  // prefer half the lag when it is nearly as strong and stays under 180 BPM.
  while (bestLag > 0) {
    const half = Math.round(bestLag / 2);
    if ((60 * fps) / half <= 180 && ac(half) >= 0.5 * ac(bestLag)) bestLag = half;
    else break;
  }
  const beats: number[] = [];
  let bpm: number | null = null;
  if (bestLag > 0 && bestScore > 0) {
    bpm = Math.round((60 * fps) / bestLag);
    let bestPhase = 0;
    let phaseScore = -1;
    for (let p = 0; p < bestLag; p++) {
      let s = 0;
      for (let f = p; f < frames; f += bestLag) s += onset[f];
      if (s > phaseScore) {
        phaseScore = s;
        bestPhase = p;
      }
    }
    // Walk the grid, snapping each beat to the strongest onset nearby so
    // rounding in the period doesn't drift the beats off the music.
    const win = Math.max(2, Math.round(bestLag * 0.25));
    let f = bestPhase;
    while (f < frames && beats.length < 600) {
      let best = f;
      for (let k = Math.max(0, f - win); k <= Math.min(frames - 1, f + win); k++) if (onset[k] > onset[best]) best = k;
      const snapped = onset[best] > mean ? best : f;
      beats.push(r2(snapped / fps));
      f = snapped + bestLag;
    }
  }

  const accents: number[] = [];
  const minGap = Math.round(0.25 * fps);
  let last = -minGap;
  for (let f = 1; f < frames - 1; f++) {
    if (onset[f] > mean + 2.5 * std && onset[f] >= onset[f - 1] && onset[f] >= onset[f + 1] && f - last >= minGap) {
      accents.push(r2(f / fps));
      last = f;
      if (accents.length >= 200) break;
    }
  }

  // Loudness (plain RMS of the signal) for silences and energy curve.
  const level = new Float32Array(frames);
  let peak = 1e-9;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * HOP; i < (f + 1) * HOP; i++) s += samples[i] * samples[i];
    level[f] = Math.sqrt(s / HOP);
    peak = Math.max(peak, level[f]);
  }
  const silences: [number, number][] = [];
  const quiet = peak * 0.03;
  let start = -1;
  for (let f = 0; f <= frames; f++) {
    const isQuiet = f < frames && level[f] < quiet;
    if (isQuiet && start < 0) start = f;
    if (!isQuiet && start >= 0) {
      if ((f - start) / fps >= 0.4) silences.push([r2(start / fps), r2(f / fps)]);
      start = -1;
    }
  }
  const energyPerSecond: number[] = [];
  for (let s = 0; s < Math.ceil(duration) && s < 900; s++) {
    let m = 0;
    const a = Math.floor(s * fps);
    const b = Math.min(frames, Math.floor((s + 1) * fps));
    for (let f = a; f < b; f++) m = Math.max(m, level[f]);
    energyPerSecond.push(r2(m / peak));
  }
  return { duration: r2(duration), bpm, beats, accents, silences: silences.slice(0, 200), energyPerSecond };
}
