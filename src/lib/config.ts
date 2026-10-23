import path from "node:path";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * All runtime limits live here so they can be tuned from the environment
 * without code changes. Values are read lazily so tests can override env.
 */
export function getConfig() {
  const dataDir = path.resolve(/*turbopackIgnore: true*/ process.env.JANUX_DATA_DIR || path.join(process.cwd(), "data"));
  return {
    dataDir,
    dbPath: path.join(dataDir, "janux.db"),
    ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
    ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
    maxUploadBytes: num("JANUX_MAX_UPLOAD_MB", 300) * 1024 * 1024,
    maxFilesPerMessage: num("JANUX_MAX_FILES_PER_MESSAGE", 50),
    maxClipSeconds: num("JANUX_MAX_CLIP_SECONDS", 15 * 60),
    maxOutputSeconds: num("JANUX_MAX_OUTPUT_SECONDS", 180),
    minFreeDiskBytes: num("JANUX_MIN_FREE_DISK_MB", 1024) * 1024 * 1024,
    ffmpegTimeoutMs: num("JANUX_FFMPEG_TIMEOUT_SEC", 600) * 1000,
    maxJobAttempts: num("JANUX_MAX_JOB_ATTEMPTS", 3),
    /** Long edge of rendered output. 1280 keeps local renders fast; raise to 1920 for 1080p. */
    outputLongEdge: num("JANUX_OUTPUT_LONG_EDGE", 1280),
    imageStillSeconds: num("JANUX_IMAGE_STILL_SECONDS", 3),
    workerStaleMs: 15_000,
  };
}

export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "mkv"] as const;
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
export const AUDIO_EXTENSIONS = ["mp3", "m4a", "aac", "wav", "ogg"] as const;

export const ALLOWED_MIME: Record<string, "video" | "image" | "audio"> = {
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/x-m4v": "video",
  "video/webm": "video",
  "video/x-matroska": "video",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "audio/mpeg": "audio",
  "audio/mp3": "audio",
  "audio/mp4": "audio",
  "audio/x-m4a": "audio",
  "audio/aac": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/wave": "audio",
  "audio/ogg": "audio",
};
