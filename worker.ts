/**
 * The second Railway process: `npm run worker`.
 * Polls the job table every 3s; one job at a time (deliberate — Stage B
 * pacing is the point, not throughput).
 */
import "dotenv/config";
import { processNext } from "./src/jobs/runner";
import { releaseOrphans, sweepDeadJobs } from "./src/jobs/reap";

/** Close out whatever the PREVIOUS process was holding when it died.
 *
 *  A deploy replaces this container mid-run. The job it was working on is still
 *  labelled 'running' or 'stopping', and processNext only ever claims 'queued'
 *  — so nothing picks it up, the banner spins, and the Scan button stays
 *  blocked. That is not a hypothetical: it happened in production on 2026-09-04,
 *  when a push landed seconds after a user pressed Stop and left the run
 *  wedged at 3 of 40.
 *
 *  This is deliberately the same sweep the heartbeat runs, quiet window and
 *  all, rather than an unconditional "kill everything running". A booting
 *  process knows it holds nothing itself, but it does NOT know whether some
 *  other process is alive and working — the replica count lives in a dashboard,
 *  not in this repo — so safety comes from the window and the compare-and-swap,
 *  never from an assumption about how many workers exist.
 *
 *  It must never prevent the worker starting. A queue that will not run because
 *  its cleanup failed is strictly worse than the one stuck row it meant to fix. */
async function reconcile() {
  try {
    const dead = await sweepDeadJobs();
    const freed = await releaseOrphans();
    if (dead || freed) {
      console.log(`[worker] boot reconcile — closed ${dead} abandoned run(s), released ${freed} people`);
    }
  } catch (e) {
    console.error("[worker] boot reconcile failed, starting anyway", e);
  }
}

async function main() {
  console.log("[worker] up — polling every 3s");
  await reconcile();
  for (;;) {
    try {
      const worked = await processNext();
      if (!worked) await new Promise((r) => setTimeout(r, 3000));
    } catch (e) {
      console.error("[worker] loop error", e);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
main();
