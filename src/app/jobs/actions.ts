"use server";
import { and, eq } from "drizzle-orm";
import { db, job } from "@/db";
import { requireUser } from "@/auth/session";

/** Ask the worker to stop a running job at the next safe point (between
 *  people / pages). The worker polls job.status each iteration; "stopping"
 *  is the signal, "stopped" is the worker's acknowledgement. */
export async function requestStop(jobId: string) {
  const user = await requireUser();
  // A job that has not started has nothing to interrupt: the worker only ever
  // picks up 'queued', so marking it 'stopping' left a row no worker would
  // acknowledge, which then read as "a run is in flight" to everything that
  // checks. Stop it outright instead.
  await db.update(job).set({ status: "stopped", updatedAt: new Date() })
    .where(and(eq(job.id, jobId), eq(job.orgId, user.orgId), eq(job.status, "queued")));
  await db.update(job).set({ status: "stopping", updatedAt: new Date() })
    .where(and(eq(job.id, jobId), eq(job.orgId, user.orgId), eq(job.status, "running")));
}
