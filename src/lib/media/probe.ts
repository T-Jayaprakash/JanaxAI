import { ffmpeg, ffprobe, MediaError } from "./ffmpeg";

export interface ProbeResult {
  format: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  fps: number | null;
  rotation: number;
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  duration?: string;
  side_data_list?: { rotation?: number }[];
  tags?: { rotate?: string };
}

function parseRate(rate?: string): number | null {
  if (!rate) return null;
  const [n, d] = rate.split("/").map(Number);
  if (!n || !d) return null;
  return Math.round((n / d) * 100) / 100;
}

export async function probe(filePath: string): Promise<ProbeResult> {
  let raw: { streams?: RawStream[]; format?: { format_name?: string; duration?: string } };
  try {
    const { stdout } = await ffprobe([
      "-v", "error",
      "-print_format", "json",
      "-show_format", "-show_streams",
      filePath,
    ]);
    raw = JSON.parse(stdout);
  } catch (err) {
    if (err instanceof MediaError && err.code === "ffmpeg_missing") throw err;
    throw new MediaError(
      "This file couldn't be read as media. It may be corrupted or in an unsupported format.",
      err instanceof Error ? err.message : String(err),
      "unreadable",
    );
  }
  const streams = raw.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const durationStr = raw.format?.duration ?? v?.duration;
  const duration = durationStr && Number.isFinite(Number(durationStr)) ? Number(durationStr) : null;
  const rotation = Math.abs(
    v?.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation ?? Number(v?.tags?.rotate ?? 0),
  ) % 360;
  // Phone footage is often stored landscape with a rotation flag; report display size.
  const swap = rotation === 90 || rotation === 270;
  return {
    format: raw.format?.format_name ?? "unknown",
    duration,
    width: (swap ? v?.height : v?.width) ?? null,
    height: (swap ? v?.width : v?.height) ?? null,
    hasVideo: !!v,
    hasAudio: !!a,
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    fps: parseRate(v?.avg_frame_rate),
    rotation,
  };
}

/** Writes a JPEG thumbnail roughly 10% into the clip (or the image itself). */
export async function makeThumbnail(input: string, output: string, duration: number | null) {
  const at = duration && duration > 1 ? Math.min(duration * 0.1, 3) : 0;
  await ffmpeg(
    [
      ...(at > 0 ? ["-ss", at.toFixed(2)] : []),
      "-i", input,
      "-frames:v", "1",
      "-vf", "scale='min(480,iw)':-2",
      "-q:v", "4",
      output,
    ],
    { timeoutMs: 30_000 },
  );
}
