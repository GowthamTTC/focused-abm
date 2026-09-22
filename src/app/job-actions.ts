"use server";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, connection, job } from "@/db";
import { requireUser } from "@/auth/session";
import { enqueue } from "@/jobs/runner";

/** Retry the failed job from the app-wide banner. Classify jobs simply
 *  continue (only unclassified rows are touched); enrich jobs requeue their
 *  FAILED rows only, so finished people are never re-billed. */
export async function retryJob(jobId: string) {
  const user = await requireUser();
  const [j] = await db.select().from(job)
    .where(and(eq(job.id, jobId), eq(job.orgId, user.orgId)));
  if (!j) redirect("/connections");

  if (j.kind === "classify") {
    const batchId = String(j.payloadJson.batchId);
    // Payload carried forward, not rebuilt: a setup-step classify runs with
    // fullPool set, and dropping it here would silently re-cap the retry.
    await enqueue(user.orgId, "classify", { ...j.payloadJson, batchId });
    redirect(`/batches/${batchId}`);
  }

  if (j.kind === "deep_enrich") {
    const ids = (j.payloadJson.connectionIds as string[]) ?? [];
    if (ids.length > 0) {
      await db.update(connection).set({ enrichStatus: "queued" })
        .where(and(eq(connection.orgId, user.orgId), inArray(connection.id, ids), eq(connection.enrichStatus, "failed")));
      await enqueue(user.orgId, "deep_enrich", { connectionIds: ids });
      const [first] = await db.select({ batchId: connection.batchId }).from(connection)
        .where(eq(connection.id, ids[0]));
      redirect(first ? `/batches/${first.batchId}?view=enriched` : "/connections");
    }
  }

  await enqueue(user.orgId, j.kind, j.payloadJson);
  redirect("/connections");
}
