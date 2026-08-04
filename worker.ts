/**
 * The second Railway process: `npm run worker`.
 * Polls the job table every 3s; one job at a time (deliberate — Stage B
 * pacing is the point, not throughput).
 */
import "dotenv/config";
import { processNext } from "./src/jobs/runner";

async function main() {
  console.log("[worker] up — polling every 3s");
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
