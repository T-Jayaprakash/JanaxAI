import fs from "node:fs";
import { Readable } from "node:stream";

/** Streams a file with HTTP Range support (needed for video seeking). */
export function streamFile(req: Request, filePath: string, opts: { mime: string; downloadName?: string; cache?: string }) {
  const size = fs.statSync(filePath).size;
  const headers = new Headers({
    "Content-Type": opts.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": opts.cache ?? "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  if (opts.downloadName) {
    const ascii = opts.downloadName.replace(/[^A-Za-z0-9._-]/g, "_");
    headers.set("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}`);
  }
  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    const body = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream, { status: 200, headers });
}
