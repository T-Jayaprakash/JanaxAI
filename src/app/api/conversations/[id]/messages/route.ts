import { z } from "zod";
import { ChatError, handleUserMessage } from "@/lib/chat";
import { jsonError, rateLimit } from "@/lib/http";

const Body = z.object({
  text: z.string().max(4000).default(""),
  attachmentIds: z.array(z.string().regex(/^ast_[a-f0-9]{32}$/)).max(200).default([]),
});

export async function POST(req: Request, ctx: RouteContext<"/api/conversations/[id]/messages">) {
  const limited = rateLimit(req, "messages", 30);
  if (limited) return limited;
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid message.");
  try {
    const result = await handleUserMessage(id, parsed.data.text, parsed.data.attachmentIds);
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ChatError) return jsonError(err.status, err.message);
    console.error("[api] message failed", err);
    return jsonError(500, "Something went wrong handling that message.");
  }
}
