import { z } from "zod";
import { requireAccess } from "@/lib/auth/access";
import { deleteConversation, getConversationIn, getSnapshot, renameConversation } from "@/lib/conversations";
import { dynamic, jsonError } from "@/lib/http";

export async function GET(req: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  await dynamic();
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  if (!(await getConversationIn(access.workspaceId, id))) return jsonError(404, "Conversation not found.");
  const snap = await getSnapshot(id);
  if (!snap) return jsonError(404, "Conversation not found.");
  return Response.json(snap);
}

const Rename = z.object({ title: z.string().trim().min(1).max(80) });

export async function PATCH(req: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  if (!(await getConversationIn(access.workspaceId, id))) return jsonError(404, "Conversation not found.");
  const parsed = Rename.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Title must be 1–80 characters.");
  await renameConversation(id, parsed.data.title);
  return Response.json({ conversation: await getConversationIn(access.workspaceId, id) });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  if (!(await getConversationIn(access.workspaceId, id)) || !(await deleteConversation(id))) return jsonError(404, "Conversation not found.");
  return Response.json({ deleted: true });
}
