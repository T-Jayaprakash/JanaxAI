import type { EditSpec, Look } from "../spec";
import type { Timeline, TimelineSegment } from "../timeline";

/**
 * Pure builders for FFmpeg argument arrays. Every value interpolated into a
 * filter string is a number we computed or an enum from the validated spec —
 * never free text from the user.
 */

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

export const ENCODE_VIDEO = ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
export const ENCODE_AUDIO = ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"];

function reframe(fit: EditSpec["fit"], w: number, h: number): string {
  const tail = "setsar=1,fps=30,format=yuv420p";
  if (fit === "crop") return `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},${tail}[v]`;
  if (fit === "pad") return `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,${tail}[v]`;
  // Blurred background: blur a small copy (fast), then scale it up behind the fitted clip.
  const sw = Math.max(2, Math.round(w / 8 / 2) * 2);
  const sh = Math.max(2, Math.round(h / 8 / 2) * 2);
  return (
    `[0:v]split=2[bg][fg];` +
    `[bg]scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${sw}:${sh},boxblur=4:2,scale=${w}:${h},eq=brightness=-0.06[bgb];` +
    `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs];` +
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,${tail}[v]`
  );
}

/** Cuts one segment and normalizes it to the output size, 30fps and stereo 48k audio. */
export function segmentArgs(opts: {
  input: string;
  output: string;
  seg: TimelineSegment;
  timeline: Timeline;
  spec: EditSpec;
}): string[] {
  const { seg, timeline, spec } = opts;
  const useAudio = seg.mediaType === "video" && seg.hasAudio && spec.audio.keepOriginal;
  const inputs =
    seg.mediaType === "image"
      ? ["-loop", "1", "-framerate", "30", "-t", f(seg.duration), "-i", opts.input]
      : ["-ss", f(seg.srcStart), "-t", f(seg.duration), "-i", opts.input];
  const silent = useAudio ? [] : ["-f", "lavfi", "-t", f(seg.duration), "-i", "anullsrc=r=48000:cl=stereo"];
  const audioIn = useAudio ? "[0:a:0]" : "[1:a]";
  const vol = useAudio && spec.audio.volume !== 1 ? `,volume=${f(spec.audio.volume)}` : "";
  const graph = `${reframe(spec.fit, timeline.width, timeline.height)};${audioIn}aresample=48000,aformat=channel_layouts=stereo${vol},apad[a]`;
  return [
    ...inputs,
    ...silent,
    "-filter_complex", graph,
    "-map", "[v]", "-map", "[a]",
    "-t", f(seg.duration),
    ...ENCODE_VIDEO, "-crf", "18",
    ...ENCODE_AUDIO,
    "-progress", "pipe:1", "-nostats",
    opts.output,
  ];
}

export function lookFilter(look: Look): string | null {
  switch (look) {
    case "cinematic":
      return "eq=contrast=1.08:saturation=0.9:gamma=0.97,colorbalance=rs=-0.04:bs=0.05:rh=0.05:bh=-0.04,vignette=angle=PI/5";
    case "vibrant":
      return "eq=saturation=1.35:contrast=1.05";
    case "bw":
      return "hue=s=0,eq=contrast=1.1";
    case "warm":
      return "colortemperature=temperature=5000";
    case "cool":
      return "colortemperature=temperature=8500";
    default:
      return null;
  }
}

/**
 * Joins normalized segments (with xfade/acrossfade, or concat for hard cuts),
 * then applies the color look and fades. `durations` are the measured lengths
 * of the cut segments so transition offsets line up exactly.
 */
export function assembleArgs(opts: {
  inputs: string[];
  durations: number[];
  output: string;
  spec: EditSpec;
  transition: Timeline["transition"];
}): { args: string[]; expectedDuration: number } {
  const { inputs, durations, spec } = opts;
  const n = inputs.length;
  const T = n > 1 ? opts.transition.duration : 0;
  const parts: string[] = [];
  let vLabel = "[0:v]";
  let aLabel = "[0:a]";

  if (n > 1 && T > 0) {
    let offset = 0;
    for (let i = 1; i < n; i++) {
      offset += durations[i - 1] - T;
      const vOut = `[vx${i}]`;
      const aOut = `[ax${i}]`;
      parts.push(`${vLabel}[${i}:v]xfade=transition=${opts.transition.type}:duration=${f(T)}:offset=${f(offset)}${vOut}`);
      parts.push(`${aLabel}[${i}:a]acrossfade=d=${f(T)}:c1=tri:c2=tri${aOut}`);
      vLabel = vOut;
      aLabel = aOut;
    }
  } else if (n > 1) {
    parts.push(`${inputs.map((_, i) => `[${i}:v][${i}:a]`).join("")}concat=n=${n}:v=1:a=1[vc][ac]`);
    vLabel = "[vc]";
    aLabel = "[ac]";
  }

  const total = durations.reduce((s, d) => s + d, 0) - (n - 1) * T;
  const vPost: string[] = [];
  const aPost: string[] = [];
  const look = lookFilter(spec.look);
  if (look) vPost.push(look);
  if (spec.fadeInOut && total > 1.5) {
    const fo = Math.min(0.6, total / 4);
    vPost.push(`fade=t=in:st=0:d=0.5`, `fade=t=out:st=${f(total - fo)}:d=${f(fo)}`);
    aPost.push(`afade=t=in:st=0:d=0.5`, `afade=t=out:st=${f(total - fo)}:d=${f(fo)}`);
  }
  vPost.push("format=yuv420p");
  parts.push(`${vLabel}${vPost.join(",")}[vout]`);
  parts.push(`${aLabel}${aPost.length ? aPost.join(",") : "anull"}[aout]`);

  return {
    expectedDuration: total,
    args: [
      ...inputs.flatMap((p) => ["-i", p]),
      "-filter_complex", parts.join(";"),
      "-map", "[vout]", "-map", "[aout]",
      ...ENCODE_VIDEO, "-crf", "21", "-profile:v", "high",
      ...ENCODE_AUDIO,
      "-movflags", "+faststart",
      "-progress", "pipe:1", "-nostats",
      opts.output,
    ],
  };
}
