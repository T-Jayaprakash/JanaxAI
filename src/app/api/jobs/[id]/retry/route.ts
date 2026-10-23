import { requireAccess } from "@/lib/auth/access";
import { conversationWorkspace } from "@/lib/conversations";
import { jsonError, rateLimit } from "@/lib/http";
import { getJob, retryJob, toPublicJob } from "@/lib/jobs";

export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/retry">) {
  const limited = rateLimit(req, "retry", 20);
  if (limited) return limited;
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  const existing = await getJob(id);
  if (!existing || (await conversationWorkspace(existing.conversationId)) !== access.workspaceId) return jsonError(404, "Job not found.");
  const job = await retryJob(id);
  if (!job) return jsonError(409, "Only failed or cancelled jobs can be retried.");
  return Response.json({ job: toPublicJob(job) });
}
