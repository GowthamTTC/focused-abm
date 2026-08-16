"use server";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { db, connection } from "@/db";
import { requireUser } from "@/auth/session";
import { enqueue } from "@/jobs/runner";
import { getOrgSettings, clampToLimit } from "@/modules/settings/org-settings";
import { markSelection } from "@/modules/matching/service-fit";

/** One-click morning ritual: select the next tranche (guardrail-clamped,
 *  default 30) AND queue the enrichment run. The daily cap still rules the
 *  worker — leftovers wait for the reset. */
export async function runTodaysTranche(batchId: string) {
  const user = await requireUser();
  const { enrichLimit } = await getOrgSettings(user.orgId);
  const n = clampToLimit(30, enrichLimit);
  const next = await db.select({ id: connection.id }).from(connection)
    .where(and(eq(connection.orgId, user.orgId), eq(connection.batchId, batchId),
      eq(connection.bucket, "pitchable"), eq(connection.selectedForEnrich, false)))
    .orderBy(asc(connection.rank)).limit(n);
  if (next.length > 0) await markSelection(batchId, next.map((t) => t.id), true);
  const queued = await db.select({ id: connection.id }).from(connection)
    .where(and(eq(connection.orgId, user.orgId), eq(connection.batchId, batchId),
      eq(connection.selectedForEnrich, true), eq(connection.enrichStatus, "queued")));
  if (queued.length > 0) await enqueue(user.orgId, "deep_enrich", { connectionIds: queued.map((q) => q.id) });
  redirect(`/dashboard?c=${batchId}`);
}

export async function markSent(batchId: string, connId: string) {
  const user = await requireUser();
  await db.update(connection).set({ outreachStatus: "sent", sentAt: new Date() })
    .where(and(eq(connection.orgId, user.orgId), eq(connection.id, connId)));
  redirect(`/dashboard?c=${batchId}`);
}

/** Flag-inbox verdicts: dropped (out of pipeline) · verify (parked for human
 *  verification) · variant (the honest-variant message goes to the queue). */
export async function flagVerdict(batchId: string, connId: string, verdict: "dropped" | "verify" | "variant") {
  const user = await requireUser();
  await db.update(connection).set({ flagVerdict: verdict })
    .where(and(eq(connection.orgId, user.orgId), eq(connection.id, connId), isNull(connection.flagVerdict)));
  redirect(`/dashboard?c=${batchId}`);
}

/** Undo a mistaken "Mark sent" — the person returns to the send queue. */
export async function undoSent(batchId: string, connId: string) {
  const user = await requireUser();
  await db.update(connection).set({ outreachStatus: null, sentAt: null })
    .where(and(eq(connection.orgId, user.orgId), eq(connection.id, connId)));
  redirect(`/dashboard?c=${batchId}`);
}

/** "Check for new posts now" — lightweight activity scan over the send queue:
 *  posts only, no LLM. Refreshes lastPostAt so activity badges and the
 *  recent/older filter reflect today, not enrichment day. */
export async function checkQueuePosts(batchId: string) {
  const user = await requireUser();
  const targets = await db.select({ id: connection.id }).from(connection)
    .where(and(eq(connection.orgId, user.orgId), eq(connection.batchId, batchId),
      eq(connection.enrichStatus, "done"), isNull(connection.sentAt)))
    .orderBy(sql`${connection.lastScanAt} asc nulls first`).limit(80);
  if (targets.length === 0) redirect(`/dashboard?c=${batchId}`);
  await enqueue(user.orgId, "activity_scan", { connectionIds: targets.map((t) => t.id) });
  redirect(`/dashboard?c=${batchId}`);
}
