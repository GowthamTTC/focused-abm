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
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, connection, job } from "@/db";

/** A live run stamps its own row every HEARTBEAT_MS (src/jobs/runner.ts), so a
 *  row quiet for longer than this is held by a process that no longer exists.
 *
 *  This replaces a 15-minute staleness guess. The old number was a guess
 *  because updated_at was only stamped per PERSON, and with a 25s inter-person
 *  gap a healthy deep_enrich went quiet for ~50s at a time — so the window had
 *  to be wide enough to never false-kill, which meant a user whose deploy
 *  interrupted a run watched a dead banner spin for a quarter of an hour. The
 *  heartbeat makes updated_at a real liveness signal, and the window can shrink
 *  to something a person will wait through.
 *
 *  THE HEARTBEAT MUST LAND BEFORE THIS WINDOW SHRINKS. A short window shipped
 *  against per-person stamping is a false-kill machine. */
export const DEAD_AFTER_SECONDS = 60;

/** Jobs whose owning process is gone.
 *
 *  'queued' IS NEVER SWEPT, and that is the one rule here worth stating twice.
 *  A queued job has no process attached: it is what the web service inserts
 *  while the worker is restarting, it is what activity_scan chains its own
 *  post_judge into, and it is exactly what processNext claims. Sweeping it
 *  would delete work nobody had started yet. The previous version of this
 *  function did include 'queued', and got away with it only because its single
 *  caller ran on the no-job-found path, having just proved no queued row
 *  existed. This one runs from the heartbeat while a job is in flight, so it
 *  has no such protection and must not rely on one.
 *
 *  Every write is a compare-and-swap on the status it expects, so a terminal
 *  row is unreachable by construction rather than by convention, and a late
 *  write from a draining process matches zero rows instead of clobbering.
 *
 *  `exceptJobId` is the row THIS process is holding: a momentarily late beat
 *  must never let a worker sweep its own live job. */
export async function sweepDeadJobs(exceptJobId?: string): Promise<number> {
  const quiet = sql`${job.updatedAt} < now() - interval '${sql.raw(String(DEAD_AFTER_SECONDS))} seconds'`;
  const notMine = exceptJobId ? ne(job.id, exceptJobId) : undefined;

  // 'stopping' → 'stopped'. The user pressed Stop and the worker died before it
  // could acknowledge; this is markStopped arriving late, from another process.
  // Their intent is honoured rather than reported as a failure.
  const stopped = await db.update(job).set({ status: "stopped", updatedAt: new Date() })
    .where(and(eq(job.status, "stopping"), quiet, notMine))
    .returning({ id: job.id });

  // 'running' → 'failed'. Nobody chose this outcome, and 'failed' is the only
  // status whose error string the product actually renders — so it is the only
  // one that can explain itself to the person who pressed the button.
  const failed = await db.update(job).set({
    status: "failed",
    error: "Run abandoned — the worker restarted or was deployed mid-run. Whatever it had already finished was kept.",
    updatedAt: new Date(),
  }).where(and(eq(job.status, "running"), quiet, notMine))
    .returning({ id: job.id });

  return stopped.length + failed.length;
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
        and (
          -- A queued deep_enrich is unconditionally live: it has no process to
          -- go quiet. Applying the window to it stripped the handles off a run
          -- that was about to start — and at boot, when the worker has just
          -- been down, a legitimately queued job is almost certainly older than
          -- any window, so this was worst exactly when it mattered most.
          j.status = 'queued'
          or (j.status in ('running', 'stopping')
              and j.updated_at > now() - interval '${sql.raw(String(DEAD_AFTER_SECONDS))} seconds')
        )
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
  // Order matters: the job rows die first, or the dead rows go on protecting
  // the very handles they orphaned.
  const stale = await sweepDeadJobs();
  const freed = await releaseOrphans();
  if (stale || freed) console.log(`[worker] released ${freed} people from ${stale} dead run(s)`);
}
