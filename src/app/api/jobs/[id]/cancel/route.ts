import { requireAccess } from "@/lib/auth/access";
import { conversationWorkspace } from "@/lib/conversations";
import { jsonError } from "@/lib/http";
import { getJob, requestCancel, toPublicJob } from "@/lib/jobs";

export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/cancel">) {
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  const existing = await getJob(id);
  if (!existing || (await conversationWorkspace(existing.conversationId)) !== access.workspaceId) return jsonError(404, "Job not found.");
  const job = await requestCancel(id);
  if (!job) return jsonError(404, "Job not found.");
  return Response.json({ job: toPublicJob(job) });
}
