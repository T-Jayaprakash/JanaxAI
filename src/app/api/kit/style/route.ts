import { jsonError, rateLimit } from "@/lib/http";
import { saveStyle, StyleSchema, toPublicKitItem } from "@/lib/kit";

export async function POST(req: Request) {
  const limited = rateLimit(req, "kit", 30);
  if (limited) return limited;
  const parsed = StyleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Give the style a name and describe it.");
  return Response.json({ item: toPublicKitItem(saveStyle(parsed.data)) }, { status: 201 });
}
