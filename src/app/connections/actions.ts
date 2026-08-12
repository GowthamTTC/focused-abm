"use server";
import { redirect } from "next/navigation";
import { enqueue } from "@/jobs/runner";
import { and, eq } from "drizzle-orm";
import { db, channelAccount } from "@/db";
import { requireUser } from "@/auth/session";
import { parseConnectionsCsv } from "@/modules/connections/import-csv";
import { createBatchFromCsv, createBatchFromRelations } from "@/modules/connections/create-batch";
import { getChannelProvider, type Relation } from "@/providers/channel";

export async function uploadCsv(formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file") as File | null;
  if (!file) redirect("/connections?err=nofile");
  const { rows, errors } = parseConnectionsCsv(await file.text());
  if (rows.length === 0) redirect(`/connections?err=${encodeURIComponent(errors[0] ?? "empty")}`);
  const batch = await createBatchFromCsv(
    user.orgId,
    `${file.name.replace(/\.csv$/i, "")} (${rows.length})`,
    rows,
  );
  redirect(`/batches/${batch.id}`);
}

/** v1.3.6: sync is a background job — the button returns instantly and the
 *  app-wide banner shows live "Syncing · N pulled" progress from the worker. */
export async function syncRelations() {
  const user = await requireUser();
  const [seat] = await db.select().from(channelAccount)
    .where(and(eq(channelAccount.orgId, user.orgId), eq(channelAccount.status, "operational")));
  if (!seat) redirect("/connections?err=Connect+a+LinkedIn+account+in+Settings+first");
  await enqueue(user.orgId, "sync", { accountId: seat.unipileAccountId, seatId: seat.id });
  redirect("/connections");
}
