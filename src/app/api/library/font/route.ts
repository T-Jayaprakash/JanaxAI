import fs from "node:fs";
import path from "node:path";
import { dynamic, jsonError } from "@/lib/http";
import { streamFile } from "@/lib/http/files";
import { libraryDir } from "@/lib/library";
import { fontFile, FONTS } from "@/lib/library/fonts";

/** Serves a library font so the Library panel can preview it. */
export async function GET(req: Request) {
  await dynamic();
  const url = new URL(req.url);
  const family = FONTS.find((f) => f.family === url.searchParams.get("family"));
  const weight = Number(url.searchParams.get("weight"));
  if (!family || !family.weights.includes(weight)) return jsonError(404, "Font not found.");
  const file = path.join(libraryDir(), fontFile(family.family, weight));
  if (!fs.existsSync(file)) return jsonError(404, "Font not installed.");
  return streamFile(req, file, { mime: "font/ttf", cache: "public, max-age=604800, immutable" });
}
