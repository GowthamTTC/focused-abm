"use server";
import { redirect } from "next/navigation";
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

export async function syncRelations() {
  const user = await requireUser();
  const [seat] = await db.select().from(channelAccount)
    .where(and(eq(channelAccount.orgId, user.orgId), eq(channelAccount.status, "operational")));
  if (!seat) redirect("/connections?err=Connect+a+LinkedIn+account+in+Settings+first");

  const provider = getChannelProvider();
  const all: Relation[] = [];
  let cursor: string | null = null;
  do {
    const page = await provider.fetchRelations({ accountId: seat.unipileAccountId, cursor, limit: 100 });
    all.push(...page.items);
    cursor = page.cursor;
  } while (cursor && all.length < 20000);

  const batch = await createBatchFromRelations(
    user.orgId, `Synced connections (${all.length})`, all,
  );
  await db.update(channelAccount).set({ lastSyncedAt: new Date() })
    .where(eq(channelAccount.id, seat.id));
  redirect(`/batches/${batch.id}`);
}
