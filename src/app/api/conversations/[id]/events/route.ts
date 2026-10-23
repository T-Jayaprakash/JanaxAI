import { requireAccess } from "@/lib/auth/access";
import { getConversation, getConversationIn, getSnapshot, messagesUpdatedSince } from "@/lib/conversations";
import { dynamic, jsonError } from "@/lib/http";
import { isWorkerAlive, jobsUpdatedSince, toPublicJob } from "@/lib/jobs";

/**
 * Server-sent events: pushes job updates (written by the worker into SQLite)
 * to the chat. When a job completes, a fresh snapshot is sent so the result
 * card and version list appear without a refresh.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/conversations/[id]/events">) {
  await dynamic();
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  if (!(await getConversationIn(access.workspaceId, id))) return jsonError(404, "Conversation not found.");
  const encoder = new TextEncoder();
  let since = Number(new URL(req.url).searchParams.get("since")) || 0;
  let msgSince = Date.now();
  const seenStatus = new Map<string, string>();
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
      let ticking = false;
      const tick = async () => {
        // A slow database round must not overlap the next one.
        if (ticking) return;
        ticking = true;
        try {
          await tickOnce();
        } catch (err) {
          console.error("[events] update failed", err);
        } finally {
          ticking = false;
        }
      };
      const tickOnce = async () => {
        if (!(await getConversation(id))) {
          send("deleted", {});
          clearInterval(timer);
          controller.close();
          return;
        }
        const jobs = await jobsUpdatedSince(id, since);
        let terminal = false;
        for (const job of jobs) {
          since = Math.max(since, job.updatedAt);
          send("job", toPublicJob(job));
          if (job.state === "completed") terminal = true;
        }
        // Assistant replies stream in as message updates.
        for (const m of await messagesUpdatedSince(id, msgSince)) {
          msgSince = Math.max(msgSince, m.updatedAt);
          send("message", m);
          const key = `${m.meta.status}:${(m.meta.designs as unknown[] | undefined)?.length ?? 0}:${(m.meta.jobIds as unknown[] | undefined)?.length ?? 0}:${m.versionId}`;
          if (seenStatus.get(m.id) !== key && (m.meta.designs || m.meta.jobIds || m.meta.status === "done" || m.versionId)) terminal = true;
          seenStatus.set(m.id, key);
        }
        if (terminal) send("snapshot", await getSnapshot(id));
        const alive = await isWorkerAlive();
        if (alive !== lastWorker || ticks % 20 === 0) send("worker", { alive });
        lastWorker = alive;
        ticks++;
      };
      void tick();
      timer = setInterval(() => void tick(), 600);
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
