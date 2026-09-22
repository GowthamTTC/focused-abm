/** Queue research for an explicitly chosen set of people.
 *
 *  The ceiling is what is LEFT of today's cap, not a fixed number: the worker
 *  throws the moment the cap is hit and hands the rest of its run back to the
 *  pool, so a batch enqueued over the line would look accepted and then die
 *  half-done. Clamping here instead means the overflow is never queued at all,
 *  and the caller can say how many were held back. The per-run tick ceiling
 *  (MAX_MANUAL_SELECT) applies on top, so a hand-posted form body cannot spend
 *  the whole day's budget in one submit.
 *
 *  Rows already finished or in flight are dropped before the clamp — re-running
 *  them buys nothing and would eat room from people who still need it. */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { enqueue } from "@/jobs/runner";
import { markSelection } from "@/modules/matching/service-fit";
import { getDailyEnrichUsage } from "@/modules/enrich/usage";
import { MAX_MANUAL_SELECT } from "@/modules/enrich/limits";
import { enrichStateOf, isEnrichable } from "@/modules/enrich/status";

/** What one tick-and-run may queue right now: today's remaining budget, or the
 *  per-run tick ceiling, whichever is smaller.
 *
 *  Both tables ask this rather than each doing its own Math.min, so the number
 *  the checkboxes refuse past and the number the server clamps to cannot drift
 *  apart — a limit the UI does not know about is a limit the user discovers as
 *  a silent "held back". */
export async function enrichAllowance(orgId: string): Promise<{
  used: number; cap: number; resetsAt: Date; room: number; allowance: number;
}> {
  const usage = await getDailyEnrichUsage(orgId);
  const room = Math.max(0, usage.cap - usage.used);
  return { ...usage, room, allowance: Math.min(room, MAX_MANUAL_SELECT) };
}

export interface QueueOutcome {
  /** Handed to the worker. */
  queued: number;
  /** Eligible, but past today's remaining allowance. */
  held: number;
  /** Already enriched or in flight, so never counted against the allowance. */
  skipped: number;
}

/** The outcome as the query string both tables read back. It lives here rather
 *  than in either screen so the two cannot describe the same run differently. */
export function outcomeQs(o: QueueOutcome): string {
  return `run=${o.queued}${o.held > 0 ? `&held=${o.held}` : ""}${o.skipped > 0 ? `&kept=${o.skipped}` : ""}`;
}

/** `ids` is whatever the user ticked; ownership is re-checked here because the
 *  tick boxes are convenience and this is the brake. Best-ranked first, so a
 *  clamp keeps the people most worth the budget. */
export async function queueEnrich(orgId: string, ids: string[]): Promise<QueueOutcome> {
  if (ids.length === 0) return { queued: 0, held: 0, skipped: 0 };

  const mine = await db.select({
    id: connection.id,
    batchId: connection.batchId,
    enrichStatus: connection.enrichStatus,
    enrichedAt: connection.enrichedAt,
  }).from(connection)
    .where(and(eq(connection.orgId, orgId), inArray(connection.id, ids)))
    .orderBy(sql`rank asc nulls last`);

  const eligible = mine.filter((r) => isEnrichable(enrichStateOf(r)));
  const skipped = mine.length - eligible.length;
  const { allowance } = await enrichAllowance(orgId);
  const take = eligible.slice(0, allowance);
  if (take.length === 0) return { queued: 0, held: eligible.length, skipped };

  // markSelection writes through connection.batch_id, so a pick spanning
  // several imports is marked one batch at a time and enqueued once.
  const byBatch = new Map<string, string[]>();
  for (const r of take) byBatch.set(r.batchId, [...(byBatch.get(r.batchId) ?? []), r.id]);
  for (const [batchId, batchIds] of byBatch) await markSelection(batchId, batchIds, true);
  await enqueue(orgId, "deep_enrich", { connectionIds: take.map((r) => r.id) });

  return { queued: take.length, held: eligible.length - take.length, skipped };
}
