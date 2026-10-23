import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config";
import { MediaError, runProcess } from "../media/ffmpeg";

/**
 * Subject tracking for reframing (16:9 → 9:16) and punch-ins. Detection runs
 * in a small Swift tool on Apple's Vision framework (macOS only), compiled on
 * first use from scripts/janux-track.swift. The follow path is smoothed like a
 * camera operator would: a dead zone so it doesn't twitch, then eased moves.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  c: number;
}

export interface TrackSample {
  t: number;
  faces: Box[];
  people: Box[];
}

export interface TrackResult {
  width: number;
  height: number;
  duration: number;
  samples: TrackSample[];
}

/** A point on the follow path: subject centre, normalised 0..1 in the source frame. */
export interface FollowKey {
  t: number;
  cx: number;
  cy: number;
  found: boolean;
}

const SOURCE = path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "janux-track.swift");

export function trackerBinary(): string {
  return path.join(/*turbopackIgnore: true*/ getConfig().dataDir, "bin", "janux-track");
}

export function trackingSupported(): boolean {
  return process.platform === "darwin" && fs.existsSync("/usr/bin/swiftc") && fs.existsSync(SOURCE);
}

let building: Promise<string> | null = null;

/** Compiles the tracker if it's missing or older than its source. */
export async function ensureTracker(): Promise<string> {
  const bin = trackerBinary();
  if (fs.existsSync(bin) && fs.statSync(bin).mtimeMs >= fs.statSync(SOURCE).mtimeMs) return bin;
  if (!trackingSupported()) throw new MediaError("Face tracking needs a Mac (Apple Vision); it isn't available on this server.", "no swiftc/vision", "tracking_unavailable");
  building ??= (async () => {
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    const tmp = `${bin}.${process.pid}.tmp`;
    try {
      await runProcess("/usr/bin/swiftc", ["-O", "-o", tmp, SOURCE], { timeoutMs: 300_000 });
      fs.renameSync(tmp, bin);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    return bin;
  })().finally(() => {
    building = null;
  });
  return building;
}

export async function trackSubjects(file: string, samplesPerSecond: number, shouldCancel?: () => boolean): Promise<TrackResult> {
  const bin = await ensureTracker();
  const { stdout } = await runProcess(bin, [file, String(samplesPerSecond)], { timeoutMs: 600_000, shouldCancel });
  try {
    return JSON.parse(stdout) as TrackResult;
  } catch {
    throw new MediaError("Subject tracking returned unreadable results.", stdout.slice(0, 300), "tracking_failed");
  }
}

const area = (b: Box) => b.w * b.h;

/**
 * Picks the subject in each sample (largest face, else upper body, sticking
 * with whoever is nearest the previous position when several people are in
 * frame) and smooths the path.
 */
export function followPath(track: TrackResult, opts: { deadZone?: number; ease?: number } = {}): FollowKey[] {
  const deadZone = opts.deadZone ?? 0.04;
  const ease = opts.ease ?? 0.35;
  const raw: FollowKey[] = [];
  let prev: { cx: number; cy: number } | null = null;
  for (const s of [...track.samples].sort((a, b) => a.t - b.t)) {
    const faces = s.faces.filter((f) => f.c >= 0.5 && area(f) > 0.0015);
    const candidates = faces.length ? faces : s.people.filter((p) => p.c >= 0.3);
    if (!candidates.length) {
      raw.push({ t: s.t, cx: prev?.cx ?? 0.5, cy: prev?.cy ?? 0.4, found: false });
      continue;
    }
    const centre = (b: Box) => ({ cx: b.x + b.w / 2, cy: faces.length ? b.y + b.h / 2 : b.y + b.h * 0.3 });
    const biggest = candidates.reduce((a, b) => (area(b) > area(a) ? b : a));
    // Keep the current subject unless someone else is clearly more prominent.
    let pick = biggest;
    if (prev && candidates.length > 1) {
      const p = prev;
      const nearest = candidates.reduce((a, b) => (Math.hypot(centre(b).cx - p.cx, centre(b).cy - p.cy) < Math.hypot(centre(a).cx - p.cx, centre(a).cy - p.cy) ? b : a));
      if (area(nearest) > area(biggest) * 0.6) pick = nearest;
    }
    prev = centre(pick);
    raw.push({ t: s.t, ...prev, found: true });
  }
  // Fill leading gaps with the first real position.
  const first = raw.find((k) => k.found);
  if (first) for (const k of raw) if (!k.found && k.t < first.t) Object.assign(k, { cx: first.cx, cy: first.cy });

  const out: FollowKey[] = [];
  let cx = raw[0]?.cx ?? 0.5;
  let cy = raw[0]?.cy ?? 0.4;
  // Like an operator: small drift is ignored, but once a move starts it
  // continues until the subject is centred again.
  let movingX = false;
  let movingY = false;
  for (const k of raw) {
    if (Math.abs(k.cx - cx) > deadZone) movingX = true;
    if (Math.abs(k.cy - cy) > deadZone) movingY = true;
    if (movingX) cx += (k.cx - cx) * ease;
    if (movingY) cy += (k.cy - cy) * ease;
    if (Math.abs(k.cx - cx) < 0.005) movingX = false;
    if (Math.abs(k.cy - cy) < 0.005) movingY = false;
    out.push({ t: k.t, cx: +cx.toFixed(4), cy: +cy.toFixed(4), found: k.found });
  }
  return out;
}

/**
 * A piecewise-linear FFmpeg expression of t through the given values:
 * v0 + Σ slope_i·clip(t - t_i, 0, Δt_i). Flat, so it stays fast per frame.
 */
export function linearExpr(points: { t: number; v: number }[]): string {
  if (!points.length) return "0";
  const terms = [points[0].v.toFixed(2)];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t;
    const dv = points[i].v - points[i - 1].v;
    if (dt <= 0 || Math.abs(dv) < 0.5) continue;
    terms.push(`${(dv / dt).toFixed(3)}*clip(t-${points[i - 1].t.toFixed(3)},0,${dt.toFixed(3)})`);
  }
  return terms.join("+").replace(/\+-/g, "-");
}

/**
 * Crop window that follows the subject: aspect is the output's width/height,
 * zoom >1 tightens the shot. Returns pixel sizes and x/y expressions for crop.
 */
export function cropPlan(track: TrackResult, keys: FollowKey[], opts: { aspect: number; zoom: number }) {
  const { width: W, height: H } = track;
  let cw = Math.min(W, H * opts.aspect) / opts.zoom;
  let ch = cw / opts.aspect;
  if (ch > H) {
    ch = H / opts.zoom;
    cw = ch * opts.aspect;
  }
  cw = Math.floor(cw / 2) * 2;
  ch = Math.floor(ch / 2) * 2;
  // Faces sit a little above centre in a well-framed shot (headroom).
  const xs = keys.map((k) => ({ t: k.t, v: Math.min(W - cw, Math.max(0, k.cx * W - cw / 2)) }));
  const ys = keys.map((k) => ({ t: k.t, v: Math.min(H - ch, Math.max(0, k.cy * H - ch * 0.4)) }));
  return { w: cw, h: ch, x: linearExpr(xs), y: linearExpr(ys) };
}
