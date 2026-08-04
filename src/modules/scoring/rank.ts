/**
 * Deterministic person-level scoring → tier → rank. Every number explains
 * itself: the breakdown is stored and shown in the UI popover.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import type { ScoreBreakdown } from "@/db/schema";
import { normalizeTitle } from "@/modules/matching/normalize";

const SENIORITY: [RegExp, number, string][] = [
  [/chief\s+\w+\s+officer|founder|managing director|president\b/, 40, "cxo/founder"],
  [/vice president/, 34, "vp"],
  [/\bhead of|\bhead\b|director/, 28, "head/director"],
  [/general manager|lead\b/, 22, "gm/lead"],
  [/manager/, 16, "manager"],
];
const FUNCTION_TERMS = /market|brand|growth|demand|communicat|content|gtm|go to market|revenue|sales/;

export function scoreConnection(input: {
  position: string | null; company: string | null; confidence: number | null;
}): ScoreBreakdown {
  const title = normalizeTitle(input.position ?? "");
  let seniority = 8; // baseline IC
  for (const [re, pts] of SENIORITY) { if (re.test(title)) { seniority = pts; break; } }
  const function_fit = FUNCTION_TERMS.test(title) ? 12 : 0;
  const confidence = Math.round((input.confidence ?? 50) * 0.3);
  const founder_bonus = /founder|chief executive officer/.test(title) && !FUNCTION_TERMS.test(title) ? 8 : 0;
  const company_present = input.company ? 5 : 0;
  const total = seniority + function_fit + confidence + founder_bonus + company_present;
  return { seniority, function_fit, confidence, founder_bonus, company_present, total };
}

export function tierFor(total: number): 1 | 2 | 3 {
  if (total >= 70) return 1;
  if (total >= 50) return 2;
  return 3;
}

/** Score + tier + rank every PITCHABLE connection in a batch. */
export async function rankBatch(orgId: string, batchId: string): Promise<number> {
  const rows = await db.select().from(connection)
    .where(and(eq(connection.orgId, orgId), eq(connection.batchId, batchId), eq(connection.bucket, "pitchable")));

  for (const c of rows) {
    const b = scoreConnection({
      position: c.positionRaw ?? c.headlineRaw,
      company: c.companyRaw,
      confidence: c.matchConfidence,
    });
    await db.update(connection)
      .set({ score: b.total, scoreBreakdownJson: b, tier: tierFor(b.total) })
      .where(eq(connection.id, c.id));
  }

  // Dense rank by score desc, stable by created order.
  const ranked = await db.select({ id: connection.id }).from(connection)
    .where(and(eq(connection.batchId, batchId), eq(connection.bucket, "pitchable")))
    .orderBy(desc(connection.score), asc(connection.createdAt));
  let r = 0;
  for (const row of ranked) {
    r += 1;
    await db.update(connection).set({ rank: r }).where(eq(connection.id, row.id));
  }
  // Clear rank on non-pitchable (idempotent re-runs).
  await db.update(connection).set({ rank: null, tier: null, score: null })
    .where(and(eq(connection.batchId, batchId), sql`${connection.bucket} <> 'pitchable'`));
  return r;
}
