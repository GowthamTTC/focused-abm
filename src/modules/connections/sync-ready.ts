import { and, eq } from "drizzle-orm";
import { db, connectionBatch, job } from "@/db";

/** Step 6's gate: has this org ever run a sync that imported at least one
 *  connection AND finished mapping it (classify, which chains rank inside
 *  the same job — see jobs/runner.ts)? Checked by intersecting synced
 *  batches that actually imported someone against classify jobs that
 *  finished against one of those batches, rather than trusting either
 *  signal alone — a batch with zero rows or a classify job still queued
 *  would otherwise pass. */
export async function orgHasSyncedConnections(orgId: string): Promise<boolean> {
  const batches = await db.select({ id: connectionBatch.id, statsJson: connectionBatch.statsJson })
    .from(connectionBatch)
    .where(and(eq(connectionBatch.orgId, orgId), eq(connectionBatch.source, "sync")));
  const readyIds = new Set(
    batches.filter((b) => (b.statsJson?.imported ?? 0) > 0).map((b) => b.id),
  );
  if (readyIds.size === 0) return false;

  const classifyJobs = await db.select({ payloadJson: job.payloadJson })
    .from(job)
    .where(and(eq(job.orgId, orgId), eq(job.kind, "classify"), eq(job.status, "done")));
  return classifyJobs.some((j) => readyIds.has(String(j.payloadJson.batchId)));
}
