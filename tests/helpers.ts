import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb } from "../src/lib/db";

/** Points the app at a fresh temporary data directory. */
export function useTempDataDir(): string {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "janux-test-"));
  process.env.JANUX_DATA_DIR = dir;
  return dir;
}

const fixtureDir = path.join(os.tmpdir(), "janux-fixtures-v1");

/** Small synthetic clips generated with FFmpeg (cached between runs). */
export function fixtures() {
  fs.mkdirSync(fixtureDir, { recursive: true });
  const make = (name: string, args: string[]) => {
    const out = path.join(fixtureDir, name);
    if (!fs.existsSync(out)) execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, out]);
    return out;
  };
  return {
    landscapeWithAudio: make("landscape.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=4",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    ]),
    smallNoAudio: make("bars.mp4", [
      "-f", "lavfi", "-i", "smptebars=size=640x480:rate=25:duration=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ]),
    portrait: make("portrait.mov", [
      "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=30:duration=5",
      "-f", "lavfi", "-i", "sine=frequency=660:duration=5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    ]),
    image: make("still.png", ["-f", "lavfi", "-i", "color=c=orange:size=800x600", "-frames:v", "1"]),
    corrupt: (() => {
      const p = path.join(fixtureDir, "corrupt.mp4");
      if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.concat([Buffer.from("00000020667479706d703432", "hex"), Buffer.alloc(4096, 7)]));
      return p;
    })(),
  };
}

export async function* fileChunks(p: string): AsyncIterable<Uint8Array> {
  for await (const chunk of fs.createReadStream(p)) yield chunk as Buffer;
}
