"use server";
import { and, eq, inArray } from "drizzle-orm";
import { db, job } from "@/db";
import { requireUser } from "@/auth/session";

/** Ask the worker to stop a running job at the next safe point (between
 *  people / pages). The worker polls job.status each iteration; "stopping"
 *  is the signal, "stopped" is the worker's acknowledgement. */
export async function requestStop(jobId: string) {
  const user = await requireUser();
  await db.update(job).set({ status: "stopping", updatedAt: new Date() })
    .where(and(eq(job.id, jobId), eq(job.orgId, user.orgId),
      inArray(job.status, ["queued", "running"])));
}

/** Hide the bar now. Marks the job stopped so it does not come back. */
export async function requestDismiss(jobId: string) {
  const user = await requireUser();
  await db.update(job).set({ status: "stopped", updatedAt: new Date() })
    .where(and(eq(job.id, jobId), eq(job.orgId, user.orgId),
      inArray(job.status, ["queued", "running", "stopping"])));
}
