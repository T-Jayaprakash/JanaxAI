import { z } from "zod";
import { requireAccess } from "@/lib/auth/access";
import { jsonError } from "@/lib/http";
import { deleteKitItem, toPublicKitItem, updateKitItem } from "@/lib/kit";

const Patch = z.object({ name: z.string().max(80).optional(), notes: z.string().max(4000).optional(), credit: z.string().max(200).nullable().optional() });

export async function PATCH(req: Request, ctx: RouteContext<"/api/kit/[id]">) {
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid changes.");
  const item = await updateKitItem(id, parsed.data, access.workspaceId);
  return item ? Response.json({ item: toPublicKitItem(item) }) : jsonError(404, "Not found.");
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/kit/[id]">) {
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  return (await deleteKitItem(id, access.workspaceId)) ? Response.json({ ok: true }) : jsonError(404, "Not found.");
}
