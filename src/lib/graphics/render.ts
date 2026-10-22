import { spawn } from "node:child_process";
import fs from "node:fs";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { getConfig } from "../config";
import { CancelledError, MediaError } from "../media/ffmpeg";

/**
 * Renders self-contained HTML/CSS (posters, carousel slides, animated
 * motion graphics) with the locally installed Chrome. Pages get no network
 * access except Google Fonts, and every run has a time limit.
 */

const DEFAULT_CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function chromePath(): string | null {
  const configured = process.env.CHROME_PATH;
  if (configured) return fs.existsSync(configured) ? configured : null;
  return DEFAULT_CHROME.find((p) => fs.existsSync(p)) ?? null;
}

const ALLOWED_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

type GlobalWithBrowser = typeof globalThis & { __januxBrowser?: Promise<Browser>; __januxBrowserIdle?: ReturnType<typeof setTimeout> };

async function getBrowser(): Promise<Browser> {
  const g = globalThis as GlobalWithBrowser;
  if (g.__januxBrowser) {
    const b = await g.__januxBrowser.catch(() => null);
    if (b?.connected) return b;
  }
  const executablePath = chromePath();
  if (!executablePath) {
    throw new MediaError("Design rendering needs Google Chrome or Chromium installed (or CHROME_PATH set).", "chrome missing", "chrome_missing");
  }
  g.__januxBrowser = puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--disable-gpu", "--hide-scrollbars", "--mute-audio", "--font-render-hinting=none", "--disable-dev-shm-usage"],
  });
  return g.__januxBrowser;
}

export async function closeBrowser() {
  const g = globalThis as GlobalWithBrowser;
  const b = await g.__januxBrowser?.catch(() => null);
  g.__januxBrowser = undefined;
  await b?.close().catch(() => undefined);
}

/** Closes Chrome after a quiet minute so it doesn't hold memory. */
function scheduleIdleClose() {
  const g = globalThis as GlobalWithBrowser;
  if (g.__januxBrowserIdle) clearTimeout(g.__januxBrowserIdle);
  g.__januxBrowserIdle = setTimeout(async () => {
    const b = await g.__januxBrowser?.catch(() => null);
    g.__januxBrowser = undefined;
    await b?.close().catch(() => undefined);
  }, 60_000);
  g.__januxBrowserIdle.unref?.();
}

async function openPage(html: string, width: number, height: number, transparent = false): Promise<Page> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith("data:") || url.startsWith("about:")) return req.continue();
    try {
      if (ALLOWED_HOSTS.has(new URL(url).hostname)) return req.continue();
    } catch {}
    req.abort("blockedbyclient");
  });
  page.setDefaultTimeout(20_000);
  await page.setContent(wrapHtml(html, width, height, transparent), { waitUntil: "load", timeout: 20_000 }).catch(async () => {
    // Fonts may be slow; render with whatever loaded.
  });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/** Fixes the canvas size so designs can rely on exact pixel dimensions. */
function wrapHtml(html: string, width: number, height: number, transparent = false): string {
  const bg = transparent ? "transparent" : "#000";
  const base = `<style>html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:${bg}}*{box-sizing:border-box}</style>`;
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${base}`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${base}</head><body>${html}</body></html>`;
}

export async function renderHtmlToPng(html: string, width: number, height: number, outPath: string): Promise<void> {
  const page = await openPage(html, width, height);
  try {
    await pauseAnimationsAt(page, 1e7); // show the final state of any entrance animation
    await page.screenshot({ path: outPath as `${string}.png`, type: "png", clip: { x: 0, y: 0, width, height } });
  } finally {
    await page.close().catch(() => undefined);
    scheduleIdleClose();
  }
}

/** Seeks every CSS/Web animation (and an optional window.__januxSeek hook) to `ms`. */
async function pauseAnimationsAt(page: Page, ms: number) {
  await page.evaluate((t) => {
    for (const a of document.getAnimations()) {
      a.pause();
      const timing = a.effect?.getComputedTiming();
      const end = typeof timing?.endTime === "number" ? timing.endTime : t;
      a.currentTime = Math.min(t, Number.isFinite(end) ? end : t);
    }
    const hook = (window as unknown as { __januxSeek?: (s: number) => void }).__januxSeek;
    if (typeof hook === "function") hook(t / 1000);
  }, ms);
}

/**
 * Renders an animated HTML composition frame by frame (time is seeked, not
 * played, so output is deterministic) and encodes it to H.264 MP4.
 */
export async function renderHtmlToVideo(opts: {
  html: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  outPath: string;
  /** Transparent background: ProRes 4444 .mov with alpha, for overlays. */
  transparent?: boolean;
  onProgress?: (fraction: number) => void;
  shouldCancel?: () => boolean;
}): Promise<void> {
  const { width, height, fps, duration } = opts;
  const frames = Math.max(1, Math.round(duration * fps));
  const page = await openPage(opts.html, width, height, opts.transparent);
  const encode = opts.transparent
    ? ["-map", "0:v", "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0"]
    : [
        "-f", "lavfi", "-t", String(duration), "-i", "anullsrc=r=48000:cl=stereo",
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
      ];
  const ff = spawn(
    getConfig().ffmpegPath,
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
      ...encode,
      opts.outPath,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  ff.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
  const exited = new Promise<number>((resolve) => ff.on("close", (code) => resolve(code ?? 1)));
  const deadline = Date.now() + getConfig().ffmpegTimeoutMs;
  try {
    for (let i = 0; i < frames; i++) {
      if (opts.shouldCancel?.()) throw new CancelledError();
      if (Date.now() > deadline) throw new MediaError("The animation took too long to render.", "frame timeout", "timeout");
      await pauseAnimationsAt(page, (i / fps) * 1000);
      const buf = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height }, optimizeForSpeed: true, omitBackground: !!opts.transparent });
      if (!ff.stdin.write(buf)) await new Promise<void>((r) => ff.stdin.once("drain", () => r()));
      opts.onProgress?.((i + 1) / frames);
    }
    ff.stdin.end();
    const code = await exited;
    if (code !== 0) throw new MediaError("Encoding the animation failed.", stderr, "ffmpeg_failed");
  } catch (err) {
    ff.kill("SIGKILL");
    throw err;
  } finally {
    await page.close().catch(() => undefined);
    scheduleIdleClose();
  }
}

export const DESIGN_FORMATS = {
  "1:1": { width: 1080, height: 1080, label: "Square post" },
  "4:5": { width: 1080, height: 1350, label: "Portrait post" },
  "9:16": { width: 1080, height: 1920, label: "Story / reel" },
  "16:9": { width: 1920, height: 1080, label: "Landscape / thumbnail" },
} as const;
export type DesignFormat = keyof typeof DESIGN_FORMATS;

/** Motion graphics render at 720p-class sizes to keep local renders fast. */
export function motionSize(format: DesignFormat): { width: number; height: number } {
  const { width, height } = DESIGN_FORMATS[format];
  const scale = 1280 / Math.max(width, height);
  return { width: Math.round((width * scale) / 2) * 2, height: Math.round((height * scale) / 2) * 2 };
}
