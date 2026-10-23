import { cancelAgentRunForMessage } from "@/lib/agent/run";

/** Stops an assistant reply that is still being written. */
export async function POST(_req: Request, ctx: RouteContext<"/api/messages/[id]/stop">) {
  const { id } = await ctx.params;
  await cancelAgentRunForMessage(id);
  return Response.json({ stopped: true });
}
