import { dynamic, jsonError } from "@/lib/http";
import { streamFile } from "@/lib/http/files";
import { getKitItem } from "@/lib/kit";
import { getStorage } from "@/lib/storage";

const MIME: Record<string, string> = {
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", cube: "text/plain; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  mov: "video/quicktime", webm: "video/webm", mp4: "video/mp4",
  wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac",
};

/** Serves a kit file by item id (the path comes from the database, never the request). */
export async function GET(req: Request, ctx: RouteContext<"/api/kit/[id]/file">) {
  await dynamic();
  const { id } = await ctx.params;
  const item = /^kit_[a-f0-9]{32}$/.test(id) ? getKitItem(id) : null;
  const storage = getStorage();
  if (!item?.file || !storage.exists(`kit/${item.file}`)) return jsonError(404, "File not found.");
  const ext = item.file.split(".").pop() ?? "";
  return streamFile(req, storage.absolutePath(`kit/${item.file}`), { mime: MIME[ext] ?? "application/octet-stream" });
}
