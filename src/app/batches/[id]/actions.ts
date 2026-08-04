"use server";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, connection } from "@/db";
import { requireUser } from "@/auth/session";
import { enqueue } from "@/jobs/runner";
import { markSelection } from "@/modules/matching/service-fit";
import { clampToLimit, getOrgSettings } from "@/modules/settings/org-settings";

export async function runClassify(batchId: string) {
  const user = await requireUser();
  await enqueue(user.orgId, "classify", { batchId });
  redirect(`/batches/${batchId}`);
}

export async function selectTopN(batchId: string, formData: FormData) {
  const user = await requireUser();
  const { enrichLimit } = await getOrgSettings(user.orgId);
  const n = clampToLimit(Number(formData.get("n") ?? 30), enrichLimit);
  const top = await db.select({ id: connection.id }).from(connection)
    .where(and(eq(connection.orgId, user.orgId), eq(connection.batchId, batchId), eq(connection.bucket, "pitchable")))
    .orderBy(asc(connection.rank)).limit(n);
  await markSelection(batchId, top.map((t) => t.id), true);
  redirect(`/batches/${batchId}`);
}

export async function runDeepEnrich(batchId: string) {
  const user = await requireUser();
  const selected = await db.select({ id: connection.id }).from(connection)
    .where(and(
      eq(connection.orgId, user.orgId), eq(connection.batchId, batchId),
      eq(connection.selectedForEnrich, true), eq(connection.enrichStatus, "queued"),
    )).orderBy(asc(connection.rank));
  if (selected.length > 0) {
    // Guardrail enforced here too — selection UI is convenience, this is the brake.
    const { enrichLimit } = await getOrgSettings(user.orgId);
    const ids = selected.map((s) => s.id);
    const capped = enrichLimit === "all" ? ids : ids.slice(0, enrichLimit);
    await enqueue(user.orgId, "deep_enrich", { connectionIds: capped });
  }
  redirect(`/batches/${batchId}`);
}
