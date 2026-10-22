/**
 * Render worker. Runs separately from the web server so renders survive
 * browser closes and don't block HTTP requests:  npm run worker
 */
import { claimNextJob, recoverInterruptedJobs, setWorkerHeartbeat } from "../src/lib/jobs";
import { processJob } from "../src/lib/render/pipeline";

let stopping = false;

async function main() {
  const recovered = recoverInterruptedJobs();
  if (recovered.requeued || recovered.failed) {
    console.log(`[worker] recovered interrupted jobs: ${recovered.requeued} re-queued, ${recovered.failed} failed`);
  }
  setWorkerHeartbeat();
  const beat = setInterval(setWorkerHeartbeat, 2000);
  console.log("[worker] ready, waiting for render jobs");

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
