import { requireAccess } from "@/lib/auth/access";
import { cancelAgentRunForMessage } from "@/lib/agent/run";
import { conversationWorkspace } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { jsonError } from "@/lib/http";

/** Stops an assistant reply that is still being written. */
export async function POST(req: Request, ctx: RouteContext<"/api/messages/[id]/stop">) {
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  const msg = await getDb().get<{ conversation_id: string }>("SELECT conversation_id FROM messages WHERE id = ?", [id]);
  if (!msg || (await conversationWorkspace(msg.conversation_id)) !== access.workspaceId) return jsonError(404, "Message not found.");
  await cancelAgentRunForMessage(id);
  return Response.json({ stopped: true });
}
