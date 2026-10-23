import { UploadError } from "@/lib/assets";
import { dynamic, jsonError, rateLimit } from "@/lib/http";
import { ingestKitFile, KIT_KINDS, listKit, toPublicKitItem, type KitKind } from "@/lib/kit";

export async function GET() {
  await dynamic();
  return Response.json({ items: listKit().map(toPublicKitItem) });
}

/** Raw-body upload into My Kit: ?kind=font&name=…&notes=…&credit=…&rights=1 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "kit", 30);
  if (limited) return limited;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as KitKind | null;
  const fileName = url.searchParams.get("fileName") ?? "";
  if (!kind || !KIT_KINDS.includes(kind) || kind === "style") return jsonError(400, "Choose what kind of resource this is.");
  if (!fileName) return jsonError(400, "Missing file name.");
  if (url.searchParams.get("rights") !== "1") return jsonError(400, "Please confirm you own this or have a licence to use it.");
  if (!req.body) return jsonError(400, "Empty upload.");
  try {
    const item = await ingestKitFile({
      body: req.body as unknown as AsyncIterable<Uint8Array>,
      kind,
      originalName: fileName,
      name: url.searchParams.get("name") ?? undefined,
      notes: url.searchParams.get("notes") ?? undefined,
      credit: url.searchParams.get("credit") ?? undefined,
      declaredSize: Number(req.headers.get("content-length")) || undefined,
    });
    return Response.json({ item: toPublicKitItem(item) }, { status: 201 });
  } catch (err) {
    if (err instanceof UploadError) return jsonError(err.status, err.message);
    console.error("[api] kit upload failed", err);
    return jsonError(500, "The upload failed. Please try again.");
  }
}
