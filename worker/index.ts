/**
 * Render worker. Runs separately from the web server so renders survive
 * browser closes and don't block HTTP requests:  npm run worker
 */
import { claimNextAgentRun, processAgentRun, recoverInterruptedAgentRuns } from "../src/lib/agent/run";
import { selectBackend } from "../src/lib/agent/provider";
import { claimNextJob, recoverInterruptedJobs, setWorkerHeartbeat } from "../src/lib/jobs";
import { processJob } from "../src/lib/render/pipeline";

let stopping = false;

async function main() {
  const recovered = recoverInterruptedJobs();
  if (recovered.requeued || recovered.failed) {
    console.log(`[worker] recovered interrupted jobs: ${recovered.requeued} re-queued, ${recovered.failed} failed`);
  }
  const interruptedReplies = recoverInterruptedAgentRuns();
  if (interruptedReplies) console.log(`[worker] marked ${interruptedReplies} interrupted assistant replies as failed`);
  setWorkerHeartbeat();
  const beat = setInterval(setWorkerHeartbeat, 2000);
  const backend = selectBackend();
  console.log(`[worker] ready · assistant: ${backend ? backend.label : "none (keyword planner only)"}`);
  void agentLoop();

  while (!stopping) {
    const job = claimNextJob();
    if (!job) {
      await new Promise((r) => setTimeout(r, 750));
      continue;
    }
    console.log(`[worker] job ${job.id} started (attempt ${job.attempts})`);
    const t = Date.now();
    await processJob(job.id);
    console.log(`[worker] job ${job.id} finished in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  clearInterval(beat);
}

/** Assistant replies run alongside renders so chatting never waits for a render. */
async function agentLoop() {
  const active = new Set<Promise<void>>();
  while (!stopping) {
    const run = active.size < 3 ? claimNextAgentRun() : null;
    if (!run) {
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    const p = processAgentRun(run).finally(() => active.delete(p));
    active.add(p);
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    // An in-flight job is left "active"; the next worker start re-queues it.
    stopping = true;
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
