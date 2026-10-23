/**
 * The assistant may run arbitrary FFmpeg edits, so arguments are checked
 * before running: no network protocols, no paths outside the workspace, no
 * filters that read other files, outputs only under work/. FFmpeg is always
 * spawned with an argument array (never a shell).
 */

const MEDIA_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mp3|m4a|aac|wav|ogg|opus|flac|png|jpe?g|webp|gif|srt|txt|json|ass|cube)$/i;
const FORBIDDEN_SUBSTRINGS = [
  "://", "concat:", "subfile", "pipe:", "fd:", "tcp", "udp", "rtmp", "rtsp", "file:", "/dev/",
  "movie=", "amovie=", "sendcmd", "zmq", "azmq", "ladspa", "lv2", "frei0r", "openclfilter",
];
const FORBIDDEN_OPTIONS = new Set([
  "-filter_script", "-filter_complex_script", "-/filter_complex", "-/vf", "-/af", "-protocol_whitelist", "-protocol_blacklist",
  "-dump_attachment", "-progress", "-report", "-vstats_file", "-passlogfile", "-sdp_file", "-stats_period",
]);
// Options whose next token is a value, not a file path.
const VALUE_OPTIONS = /^-(c|codec|vcodec|acodec|f|filter|vf|af|filter_complex|lavfi|map|b|maxrate|bufsize|crf|preset|tune|profile|level|pix_fmt|r|s|aspect|ss|to|t|sseof|ar|ac|q|qscale|g|keyint_min|movflags|metadata|disposition|frames|vframes|aframes|threads|shortest_buf_duration|loop|stream_loop|framerate|itsoffset|safe|map_metadata|map_chapters|tag|fps_mode|vsync|strict|x264-params|x265-params|bf|refs|sc_threshold|color_primaries|color_trc|colorspace|alpha_quality|update|segment_time|hls_time|start_number|use_wallclock_as_timestamps|max_muxing_queue_size|filter_threads|af:.*|c:.*|b:.*|q:.*|filter:.*|codec:.*|profile:.*|tag:.*|disposition:.*|metadata:.*)$/;

export interface FfmpegPlan {
  args: string[];
  inputs: string[];
  outputs: string[];
}

export function checkFfmpegArgs(raw: string[]): FfmpegPlan {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 400) throw new Error("Provide FFmpeg arguments as a list (max 400 items).");
  const inputs: string[] = [];
  const outputs: string[] = [];
  let concatDemuxer = false;
  let safeZero = false;
  // Check every token first, including option values (filter graphs).
  for (const t of raw) {
    const tok = String(t);
    if (tok.length > 20000) throw new Error("An argument is too long.");
    // Filters that read files (LUTs) may only use workspace or library paths.
    for (const m of tok.matchAll(/(?:lut3d|lut1d|haldclut)=(?:file=)?([^:,;\]\s]+)/g)) {
      const f = m[1].replace(/^'|'$/g, "");
      if (f.startsWith("/") || f.includes("..") || !/^(lib|kit|work|cache|in)\//.test(f)) throw new Error(`LUT file "${f}" must be inside the workspace, lib/ or kit/.`);
    }
    if (FORBIDDEN_OPTIONS.has(tok)) throw new Error(`The option ${tok} isn't allowed.`);
    const lower = tok.toLowerCase();
    for (const bad of FORBIDDEN_SUBSTRINGS) {
      if (lower.includes(bad)) throw new Error(`"${bad}" isn't allowed in FFmpeg arguments.`);
    }
  }
  for (let i = 0; i < raw.length; i++) {
    const tok = String(raw[i]);
    if (tok === "-y" || tok === "-n" || tok === "-hide_banner" || tok === "-nostdin") continue;
    if (tok === "-f" && raw[i + 1] === "concat") concatDemuxer = true;
    if (tok === "-safe" && raw[i + 1] === "0") safeZero = true;
    if (tok === "-i") {
      const v = String(raw[i + 1] ?? "");
      // lavfi sources (color=, testsrc, anullsrc...) are generated, not files.
      const isLavfi = raw[i - 1] === "lavfi" && raw[i - 2] === "-f";
      if (!isLavfi) inputs.push(v);
      i++;
      continue;
    }
    if (tok.startsWith("-")) {
      if (VALUE_OPTIONS.test(tok)) i++;
      continue;
    }
    // A bare token that isn't an option value is an output path.
    if (MEDIA_EXT.test(tok) || tok.includes("/")) outputs.push(tok);
  }
  if (concatDemuxer && safeZero) throw new Error("The concat demuxer must keep -safe 1.");
  if (!outputs.length) throw new Error("No output file found. End the arguments with an output path under work/.");
  for (const p of [...inputs, ...outputs]) {
    if (p.startsWith("/") || p.split("/").includes("..") || !/^(in|work|cache|lib|kit)\//.test(p)) {
      throw new Error(`Path "${p}" must be inside the workspace (in/, work/, cache/, lib/ or kit/).`);
    }
  }
  for (const o of outputs) {
    if (!o.startsWith("work/")) throw new Error(`Outputs must be written under work/ (got "${o}").`);
    if (inputs.includes(o)) throw new Error("An output can't overwrite one of its inputs.");
  }
  // Restrict every input to local files.
  const args: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "-i" && !(raw[i - 1] === "lavfi" && raw[i - 2] === "-f")) args.push("-protocol_whitelist", "file");
    args.push(String(raw[i]));
  }
  return { args, inputs, outputs };
}
