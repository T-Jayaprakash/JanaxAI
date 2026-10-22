import { ingestUpload, toPublicAsset, UploadError } from "@/lib/assets";
import { getConversation } from "@/lib/conversations";
import { jsonError, rateLimit } from "@/lib/http";

/**
 * Raw-body upload: the browser sends the file bytes directly (no multipart),
 * which lets the server stream to disk and stop as soon as the limit is hit.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "uploads", 60);
  if (limited) return limited;
  const url = new URL(req.url);
  const name = url.searchParams.get("name") ?? "";
  const conversationId = url.searchParams.get("conversationId");
  if (!name) return jsonError(400, "Missing file name.");
  if (conversationId && !getConversation(conversationId)) return jsonError(404, "Conversation not found.");
  if (!req.body) return jsonError(400, "Empty upload.");
  const declared = Number(req.headers.get("content-length")) || undefined;
  try {
    const asset = await ingestUpload({
      body: req.body as unknown as AsyncIterable<Uint8Array>,
      originalName: name,
      mime: (req.headers.get("content-type") ?? "").split(";")[0].trim(),
      conversationId,
      declaredSize: declared,
    });
    return Response.json({ asset: toPublicAsset(asset) }, { status: 201 });
  } catch (err) {
    if (err instanceof UploadError) return jsonError(err.status, err.message);
    console.error("[api] upload failed", err);
    return jsonError(500, "The upload failed. Please try again.");
  }
}
