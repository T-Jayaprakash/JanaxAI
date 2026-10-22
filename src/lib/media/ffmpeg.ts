import { spawn } from "node:child_process";
import { getConfig } from "../config";

/** An error that carries a message safe to show users (no paths, no stderr). */
export class MediaError extends Error {
  constructor(
    public userMessage: string,
    public diagnostic?: string,
    public code: string = "media_error",
  ) {
    super(userMessage);
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Job cancelled");
  }
}

interface RunOptions {
  timeoutMs?: number;
  /** Called with output seconds processed so far (from -progress). */
  onProgress?: (seconds: number) => void;
  /** Polled every 500ms; return true to kill the process. */
  shouldCancel?: () => boolean;
  cwd?: string;
}

export interface RunResult {
  stdout: string;
  stderrTail: string;
  wallMs: number;
}

/**
 * Runs a binary with an argument array (never a shell string), so user input
 * can't be interpreted by a shell. Enforces a timeout and supports cancel.
 */
export function runProcess(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? getConfig().ffmpegTimeoutMs;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    let killedFor: "timeout" | "cancel" | null = null;
    const started = process.hrtime.bigint();

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (opts.onProgress) {
        for (const m of text.matchAll(/out_time_(?:us|ms)=(\d+)/g)) {
          opts.onProgress(Number(m[1]) / 1_000_000);
        }
      }
      // Keep stdout bounded; ffprobe JSON is small, progress output is not needed.
      if (stdout.length < 2_000_000) stdout += text;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8000);
    });

    const timer = setTimeout(() => {
      killedFor = "timeout";
      child.kill("SIGKILL");
    }, timeoutMs);
    const cancelPoll = opts.shouldCancel
      ? setInterval(() => {
          if (opts.shouldCancel!()) {
            killedFor = "cancel";
            child.kill("SIGKILL");
          }
        }, 500)
      : null;

    const cleanup = () => {
      clearTimeout(timer);
      if (cancelPoll) clearInterval(cancelPoll);
    };

    child.on("error", (err: NodeJS.ErrnoException) => {
      cleanup();
      if (err.code === "ENOENT") {
        reject(new MediaError("The video engine (FFmpeg) is not installed on the server.", err.message, "ffmpeg_missing"));
      } else {
        reject(new MediaError("The video engine could not start.", err.message));
      }
    });
    child.on("close", (code) => {
      cleanup();
      const wallMs = Number((process.hrtime.bigint() - started) / BigInt(1_000_000));
      if (killedFor === "cancel") return reject(new CancelledError());
      if (killedFor === "timeout") {
        return reject(new MediaError("Rendering took too long and was stopped.", stderr, "timeout"));
      }
      if (code !== 0) {
        return reject(new MediaError(describeFfmpegFailure(stderr), stderr, "ffmpeg_failed"));
      }
      resolve({ stdout, stderrTail: stderr, wallMs });
    });
  });
}

function describeFfmpegFailure(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes("no space left")) return "The server ran out of disk space while rendering.";
  if (s.includes("invalid data found") || s.includes("moov atom not found")) {
    return "One of the files looks corrupted or incomplete.";
  }
  if (s.includes("decoder") && s.includes("not found")) return "One of the clips uses a codec this server can't decode.";
  return "The video engine reported an error while processing your clips.";
}

export function ffmpeg(args: string[], opts?: RunOptions) {
  return runProcess(getConfig().ffmpegPath, ["-hide_banner", "-nostdin", "-y", ...args], opts);
}

export function ffprobe(args: string[], opts?: RunOptions) {
  return runProcess(getConfig().ffprobePath, ["-hide_banner", ...args], { timeoutMs: 30_000, ...opts });
}
