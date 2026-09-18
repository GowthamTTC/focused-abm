"use server";
import { redirect } from "next/navigation";
import { and, asc, eq, gte, ilike, isNull, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { requireUser } from "@/auth/session";
import { enqueue } from "@/jobs/runner";
import { markSelection } from "@/modules/matching/service-fit";
import { clampToLimit, getOrgSettings } from "@/modules/settings/org-settings";
import { outcomeQs, queueEnrich } from "@/modules/enrich/queue";

/** Return to exactly the tab + filters the click came from. */
function backTo(batchId: string, back: string, extra: string) {
  const q = [back, extra].filter(Boolean).join("&");
  return `/batches/${batchId}${q ? `?${q}` : ""}`;
}

export async function runClassify(batchId: string) {
  const user = await requireUser();
  await enqueue(user.orgId, "classify", { batchId });
  redirect(`/batches/${batchId}`);
}

/** Deliberate fresh pass after ICP/prompt edits: CLEAR every Stage-A verdict,
 *  then run a normal continuation classify. Clearing first is what makes the
 *  matching guardrail compose correctly — each subsequent run advances through
 *  the now-unclassified pool instead of redoing the same first slice. */
export async function reclassifyAllAction(batchId: string) {
  const user = await requireUser();
  await db.update(connection).set({
    bucket: null, serviceSlug: null, matchConfidence: null, matchWhy: null,
    matchMethod: null, score: null, scoreBreakdownJson: null, tier: null, rank: null,
  }).where(and(eq(connection.orgId, user.orgId), eq(connection.batchId, batchId)));
  await enqueue(user.orgId, "classify", { batchId });
  redirect(`/batches/${batchId}`);
}

/** "Select NEXT N": advance the enrichment frontier through the pool.
 *  Takes the next N pitchable people by rank who are NOT yet selected —
 *  already-enriched (and already-queued) people are untouched, so each click
 *  queues a fresh tranche and the Batch tab stays the cumulative roster.
 *  N is clamped by the enrichment guardrail; the daily 80 cap rules above. */
export async function selectTopN(batchId: string, formData: FormData) {
  const user = await requireUser();
  const { enrichLimit } = await getOrgSettings(user.orgId);
  const n = clampToLimit(Number(formData.get("n") ?? 30), enrichLimit);
  const country = String(formData.get("country") ?? "");
  const posted = String(formData.get("posted") ?? "");
  const next = await db.select({ id: connection.id }).from(connection)
    .where(and(
      eq(connection.orgId, user.orgId), eq(connection.batchId, batchId),
      eq(connection.bucket, "pitchable"), eq(connection.enrichStatus, "pending"),
      ...(country ? [ilike(connection.location, `%${country}`)] : []),
      ...(posted === "none" ? [isNull(connection.lastPostAt)] : []),
      ...(["3", "7", "15"].includes(posted)
        ? [gte(connection.lastPostAt, new Date(Date.now() - Number(posted) * 864e5))] : []),
    ))
    .orderBy(asc(connection.rank)).limit(n);
  await markSelection(batchId, next.map((t) => t.id), true);
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

/** Tick-and-run: research exactly the people the user checked, nobody else.
 *
 *  The brake is queueEnrich, the same one /people presses: ownership re-checked,
 *  rows already done or in flight dropped, and the rest clamped to what is left
 *  of today's budget. This screen used to enqueue whatever was ticked and let
 *  the worker discover the cap mid-run — which threw, and handed the remainder
 *  back to the pool with an error where a held-back count belonged. */
export async function enrichSelected(batchId: string, back: string, formData: FormData) {
  const user = await requireUser();
  const picked = formData.getAll("ids").map(String).filter(Boolean);
  if (picked.length === 0) redirect(backTo(batchId, back, "run=0"));
  const outcome = await queueEnrich(user.orgId, picked);
  redirect(backTo(batchId, back, outcomeQs(outcome)));
}

/** One row, one decision — the per-record Enrich button. */
export async function enrichOne(batchId: string, connId: string, back: string = "") {
  const user = await requireUser();
  const outcome = await queueEnrich(user.orgId, [connId]);
  // Always return to this person so the wait panel is visible (not a bare table).
  const backQs = back && back.includes("p=")
    ? back
    : [back, `p=${connId}`].filter(Boolean).join("&");
  redirect(backTo(batchId, backQs || `view=pitchable&p=${connId}`, outcomeQs(outcome)));
}

/** Quiet rescue action on Off-ICP / Peers rows (design 1d footer): promote a
 *  wrongly-demoted person back into the pool. Rank stays empty until the next
 *  free Re-rank. */
export async function moveToPitchable(batchId: string, connId: string) {
  const user = await requireUser();
  await db.update(connection).set({
    bucket: "pitchable",
    matchMethod: "manual",
    matchWhy: sql`concat('Manually moved to pitchable. ', coalesce(${connection.matchWhy}, ''))`,
  }).where(and(eq(connection.orgId, user.orgId), eq(connection.batchId, batchId), eq(connection.id, connId)));
  redirect(`/batches/${batchId}?view=pitchable`);
}

/** Per-person retry from the enrichment pane (design 1e). */
export async function retryPerson(batchId: string, connId: string) {
  const user = await requireUser();
  await db.update(connection).set({ enrichStatus: "queued", enrichError: null })
    .where(and(eq(connection.orgId, user.orgId), eq(connection.id, connId)));
  await enqueue(user.orgId, "deep_enrich", { connectionIds: [connId] });
  redirect(`/batches/${batchId}?view=enriched&p=${connId}`);
}

/** Lightweight post-recency scan for the top of the (filtered) pool — fills
 *  lastPostAt WITHOUT full enrichment, so the recent-post filter has data. */
export async function scanActivity(batchId: string, formData: FormData) {
  const user = await requireUser();
  const n = Math.min(Math.max(Number(formData.get("n") ?? 50), 1), 200);
  const country = String(formData.get("country") ?? "");
  const targets = await db.select({ id: connection.id }).from(connection)
    .where(and(
      eq(connection.orgId, user.orgId), eq(connection.batchId, batchId),
      eq(connection.bucket, "pitchable"), isNull(connection.lastScanAt),
      ...(country ? [ilike(connection.location, `%${country}`)] : []),
    ))
    .orderBy(asc(connection.rank)).limit(n);
  if (targets.length === 0) redirect(`/batches/${batchId}?err=Nothing unscanned in the current filter.`);
  await enqueue(user.orgId, "activity_scan", { connectionIds: targets.map((t) => t.id) });
  redirect(`/batches/${batchId}`);
}
