import { requireAccess } from "@/lib/auth/access";
import { jsonError, rateLimit } from "@/lib/http";
import { saveStyle, StyleSchema, toPublicKitItem } from "@/lib/kit";

export async function POST(req: Request) {
  const limited = rateLimit(req, "kit", 30);
  if (limited) return limited;
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const parsed = StyleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Give the style a name and describe it.");
  return Response.json({ item: toPublicKitItem(await saveStyle(parsed.data, access.workspaceId)) }, { status: 201 });
}
