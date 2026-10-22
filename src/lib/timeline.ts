import type { EditSpec } from "./spec";

/** Minimal asset facts the timeline needs (works for DB assets and tests). */
export interface TimelineAsset {
  id: string;
  name: string;
  mediaType: "video" | "image";
  duration: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
}

export interface TimelineSegment {
  index: number;
  assetId: string;
  name: string;
  mediaType: "video" | "image";
  hasAudio: boolean;
  /** Source window in seconds (images: 0..duration). */
  srcStart: number;
  srcEnd: number;
  duration: number;
  /** Where the segment starts in the output. */
  outStart: number;
  transitionIn: EditSpec["transition"]["type"];
}

export interface Timeline {
  width: number;
  height: number;
  fps: number;
  segments: TimelineSegment[];
  transition: { type: EditSpec["transition"]["type"]; duration: number };
  totalDuration: number;
  notes: string[];
}

export interface TimelineLimits {
  outputLongEdge: number;
  imageStillSeconds: number;
  maxOutputSeconds: number;
}

const MIN_SEGMENT = 0.6;
const round = (n: number, p = 3) => Math.round(n * 10 ** p) / 10 ** p;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function outputSize(spec: EditSpec, first: TimelineAsset | undefined, longEdge: number): { width: number; height: number } {
  const short = even(longEdge * 0.5625);
  switch (spec.aspect) {
    case "9:16":
      return { width: short, height: even(longEdge) };
    case "16:9":
      return { width: even(longEdge), height: short };
    case "1:1":
      return { width: short, height: short };
    case "4:5":
      return { width: short, height: even((short * 5) / 4) };
    case "original": {
      const w = first?.width ?? 1280;
      const h = first?.height ?? 720;
      const scale = Math.min(1, longEdge / Math.max(w, h));
      return { width: even(w * scale), height: even(h * scale) };
    }
  }
}

/**
 * Deterministically decides which part of each clip is used and how long the
 * result will be. The same function drives the preview shown in chat and
 * the actual render, so what users see is what gets rendered.
 */
export function buildTimeline(spec: EditSpec, assets: Map<string, TimelineAsset>, limits: TimelineLimits): Timeline {
  const notes: string[] = [];
  const clips = spec.clips.map((c) => {
    const a = assets.get(c.assetId);
    if (!a) throw new Error(`Missing asset ${c.assetId}`);
    const full = a.mediaType === "image" ? limits.imageStillSeconds : (a.duration ?? 0);
    const start = Math.min(Math.max(c.in ?? 0, 0), Math.max(full - MIN_SEGMENT, 0));
    const end = Math.min(c.out ?? full, full);
    return { a, start, available: Math.max(end - start, MIN_SEGMENT) };
  });

  const n = clips.length;
  let T = n > 1 && spec.transition.type !== "none" ? spec.transition.duration : 0;
  const totalAvailable = clips.reduce((s, c) => s + c.available, 0);

  let target = spec.targetDuration;
  if (target && target > limits.maxOutputSeconds) {
    notes.push(`Output is capped at ${limits.maxOutputSeconds}s in this prototype.`);
    target = limits.maxOutputSeconds;
  }
  if (!target && totalAvailable - (n - 1) * T > limits.maxOutputSeconds) {
    notes.push(`Your clips run longer than the ${limits.maxOutputSeconds}s output limit, so each one was shortened proportionally.`);
    target = limits.maxOutputSeconds;
  }

  const allocate = (t: number): number[] => {
    if (!target) return clips.map((c) => c.available);
    const needed = target + (n - 1) * t;
    if (totalAvailable <= needed) return clips.map((c) => c.available);
    const ratio = needed / totalAvailable;
    return clips.map((c) => Math.max(MIN_SEGMENT, c.available * ratio));
  };

  let lengths = allocate(T);
  // A transition can't be longer than ~40% of the shortest segment; if it
  // has to shrink, re-allocate so the total still matches the target.
  if (T > 0) {
    const maxT = Math.min(...lengths) * 0.4;
    if (T > maxT) {
      T = round(Math.max(0.1, maxT), 2);
      if (T < 0.15) T = 0;
      lengths = allocate(T);
    }
  }
  if (target) {
    if (totalAvailable <= target + (n - 1) * T) {
      if (totalAvailable - (n - 1) * T < target - 0.5) {
        notes.push(`Your clips only have about ${Math.round(totalAvailable - (n - 1) * T)}s of footage, so the video is shorter than ${target}s.`);
      }
    } else {
      notes.push("Used the middle part of each clip to fit the length (no AI scene detection yet).");
    }
  }

  let cursor = 0;
  const segments: TimelineSegment[] = clips.map((c, i) => {
    const len = Math.min(lengths[i], c.available);
    const offset = (c.available - len) / 2;
    const seg: TimelineSegment = {
      index: i,
      assetId: c.a.id,
      name: c.a.name,
      mediaType: c.a.mediaType,
      hasAudio: c.a.hasAudio,
      srcStart: round(c.start + offset),
      srcEnd: round(c.start + offset + len),
      duration: round(len),
      outStart: round(cursor),
      transitionIn: i === 0 || T === 0 ? "none" : spec.transition.type,
    };
    cursor += len - (i < n - 1 ? T : 0);
    return seg;
  });

  const { width, height } = outputSize(spec, clips[0]?.a, limits.outputLongEdge);
  return {
    width,
    height,
    fps: 30,
    segments,
    transition: { type: T > 0 ? spec.transition.type : "none", duration: T },
    totalDuration: round(cursor),
    notes,
  };
}
