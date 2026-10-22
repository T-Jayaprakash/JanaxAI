import { createConversation, getSnapshot, listConversations } from "@/lib/conversations";
import { dynamic } from "@/lib/http";

export async function GET() {
  await dynamic();
  return Response.json({ conversations: listConversations() });
}

export async function POST() {
  await dynamic();
  const conv = createConversation();
  return Response.json(getSnapshot(conv.id), { status: 201 });
}
