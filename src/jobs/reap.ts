/**
 * The queue is not a place people live.
 *
 * `queued` / `running` on a connection are handles held by a *live* job. When a
 * job dies — daily cap, worker restart, deploy mid-run — those handles used to
 * survive it, so people sat "queued" forever: counted in every header, skipped
 * by the next-N frontier, and waiting for a run that would never come.
 *
 * Two rules enforce the invariant instead of a button that asks the user to
 * tidy up after the machine:
 *   1. a deep-enrich run releases its own leftovers when it ends, however it ends;
 *   2. the idle worker releases anything still holding a handle with no live job.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, connection, job } from "@/db";

/** Jobs untouched for this long are dead, whatever the row says. Each person
 *  takes ~40s+, and setProgress stamps updatedAt per person, so a healthy run
 *  never goes quiet for anywhere near this long. */
const STALE_JOB_MINUTES = 15;

/** Mark abandoned runs as failed so the live banner stops spinning and the
 *  activity feed tells the truth. */
export async function sweepStaleJobs(): Promise<number> {
  const rows = await db.update(job).set({
    status: "failed",
    error: "Run abandoned — worker restarted or deployed mid-run; the people went back to the pool.",
    updatedAt: new Date(),
  }).where(and(
    inArray(job.status, ["queued", "running"]),
    sql`${job.updatedAt} < now() - interval '${sql.raw(String(STALE_JOB_MINUTES))} minutes'`,
  )).returning({ id: job.id });
  return rows.length;
}

/** Release every person holding a handle that no live job can honour. */
export async function releaseOrphans(): Promise<number> {
  const rows = await db.update(connection).set({
    enrichStatus: "pending",
    selectedForEnrich: false,
  }).where(and(
    inArray(connection.enrichStatus, ["queued", "running"]),
    sql`not exists (
      select 1 from ${job} j
      where j.org_id = ${connection.orgId}
        and j.kind = 'deep_enrich'
        and j.status in ('queued', 'running')
        and j.updated_at > now() - interval '${sql.raw(String(STALE_JOB_MINUTES))} minutes'
    )`,
  )).returning({ id: connection.id });
  return rows.length;
}

/** Release the leftovers of one finished run — done and failed people keep
 *  their result, everyone still holding a handle goes back to the pool. */
export async function releaseIds(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.update(connection).set({
    enrichStatus: "pending",
    selectedForEnrich: false,
  }).where(and(
    inArray(connection.id, ids),
    inArray(connection.enrichStatus, ["queued", "running"]),
  )).returning({ id: connection.id });
  return rows.length;
}

/** Throttle for the idle sweep — every poll is 3s, this work is not. */
let lastSweep = 0;
export async function idleSweep(everyMs = 30_000): Promise<void> {
  if (Date.now() - lastSweep < everyMs) return;
  lastSweep = Date.now();
  const stale = await sweepStaleJobs();
  const freed = await releaseOrphans();
  if (stale || freed) console.log(`[worker] released ${freed} people from ${stale} dead run(s)`);
}
