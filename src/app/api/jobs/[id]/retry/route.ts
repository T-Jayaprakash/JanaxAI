import { jsonError, rateLimit } from "@/lib/http";
import { getJob, retryJob, toPublicJob } from "@/lib/jobs";

export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/retry">) {
  const limited = rateLimit(req, "retry", 20);
  if (limited) return limited;
  const { id } = await ctx.params;
  if (!getJob(id)) return jsonError(404, "Job not found.");
  const job = retryJob(id);
  if (!job) return jsonError(409, "Only failed or cancelled jobs can be retried.");
  return Response.json({ job: toPublicJob(job) });
}
