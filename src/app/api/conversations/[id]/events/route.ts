import { getConversation, getSnapshot } from "@/lib/conversations";
import { dynamic, jsonError } from "@/lib/http";
import { isWorkerAlive, jobsUpdatedSince, toPublicJob } from "@/lib/jobs";

/**
 * Server-sent events: pushes job updates (written by the worker into SQLite)
 * to the chat. When a job completes, a fresh snapshot is sent so the result
 * card and version list appear without a refresh.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/conversations/[id]/events">) {
  await dynamic();
  const { id } = await ctx.params;
  if (!getConversation(id)) return jsonError(404, "Conversation not found.");
  const encoder = new TextEncoder();
  let since = Number(new URL(req.url).searchParams.get("since")) || 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastWorker: boolean | null = null;
  let ticks = 0;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          clearInterval(timer);
        }
      };
      const tick = () => {
        if (!getConversation(id)) {
          send("deleted", {});
          clearInterval(timer);
          controller.close();
          return;
        }
        const jobs = jobsUpdatedSince(id, since);
        let terminal = false;
        for (const job of jobs) {
          since = Math.max(since, job.updatedAt);
          send("job", toPublicJob(job));
          if (job.state === "completed") terminal = true;
        }
        if (terminal) send("snapshot", getSnapshot(id));
        const alive = isWorkerAlive();
        if (alive !== lastWorker || ticks % 20 === 0) send("worker", { alive });
        lastWorker = alive;
        ticks++;
      };
      tick();
      timer = setInterval(tick, 600);
      req.signal.addEventListener("abort", () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
