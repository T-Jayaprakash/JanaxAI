import { jsonError } from "@/lib/http";
import { requestCancel, toPublicJob } from "@/lib/jobs";

export async function POST(_req: Request, ctx: RouteContext<"/api/jobs/[id]/cancel">) {
  const { id } = await ctx.params;
  const job = await requestCancel(id);
  if (!job) return jsonError(404, "Job not found.");
  return Response.json({ job: toPublicJob(job) });
}
