import { z } from "zod";
import { jsonError } from "@/lib/http";
import { deleteKitItem, toPublicKitItem, updateKitItem } from "@/lib/kit";

const Patch = z.object({ name: z.string().max(80).optional(), notes: z.string().max(4000).optional(), credit: z.string().max(200).nullable().optional() });

export async function PATCH(req: Request, ctx: RouteContext<"/api/kit/[id]">) {
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid changes.");
  const item = updateKitItem(id, parsed.data);
  return item ? Response.json({ item: toPublicKitItem(item) }) : jsonError(404, "Not found.");
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/kit/[id]">) {
  const { id } = await ctx.params;
  return deleteKitItem(id) ? Response.json({ ok: true }) : jsonError(404, "Not found.");
}
