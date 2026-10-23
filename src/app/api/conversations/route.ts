import { requireAccess } from "@/lib/auth/access";
import { createConversation, getSnapshot, listConversations } from "@/lib/conversations";
import { dynamic } from "@/lib/http";

export async function GET(req: Request) {
  await dynamic();
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  return Response.json({ conversations: await listConversations(access.workspaceId) });
}

export async function POST(req: Request) {
  await dynamic();
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const conv = await createConversation(undefined, access.workspaceId);
  return Response.json(await getSnapshot(conv.id), { status: 201 });
}
