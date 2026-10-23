import { createConversation, getSnapshot, listConversations } from "@/lib/conversations";
import { dynamic } from "@/lib/http";

export async function GET() {
  await dynamic();
  return Response.json({ conversations: await listConversations() });
}

export async function POST() {
  await dynamic();
  const conv = await createConversation();
  return Response.json(await getSnapshot(conv.id), { status: 201 });
}
