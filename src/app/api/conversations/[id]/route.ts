import { z } from "zod";
import { deleteConversation, getConversation, getSnapshot, renameConversation } from "@/lib/conversations";
import { dynamic, jsonError } from "@/lib/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  await dynamic();
  const { id } = await ctx.params;
  const snap = await getSnapshot(id);
  if (!snap) return jsonError(404, "Conversation not found.");
  return Response.json(snap);
}

const Rename = z.object({ title: z.string().trim().min(1).max(80) });

export async function PATCH(req: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  const { id } = await ctx.params;
  if (!await getConversation(id)) return jsonError(404, "Conversation not found.");
  const parsed = Rename.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Title must be 1–80 characters.");
  await renameConversation(id, parsed.data.title);
  return Response.json({ conversation: await getConversation(id) });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  const { id } = await ctx.params;
  if (!await deleteConversation(id)) return jsonError(404, "Conversation not found.");
  return Response.json({ deleted: true });
}
