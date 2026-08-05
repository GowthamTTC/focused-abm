/**
 * Deterministic person-level scoring → tier → rank.
 * v10: set-based SQL — score/tier land in chunked bulk updates and rank is ONE
 * window-function statement, replacing ~7,400 sequential row updates per run.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import type { ScoreBreakdown } from "@/db/schema";
import { normalizeTitle } from "@/modules/matching/normalize";

const SENIORITY: [RegExp, number, string][] = [
  [/vice president/, 34, "vp"], // MUST precede cxo: "vice president" contains "president"
  [/chief\s+\w+\s+officer|founder|managing director|president\b/, 40, "cxo/founder"],
  [/\bhead of|\bhead\b|director/, 28, "head/director"],
  [/general manager|lead\b/, 22, "gm/lead"],
  [/manager/, 16, "manager"],
];
const FUNCTION_TERMS = /market|brand|growth|demand|communicat|content|gtm|go to market|revenue|sales/;

/** GT's Top 30 is dominated by pipeline-owning marketers — rank mirrors that
 *  priority so the machine's Top-N composes like the human's did. */
const SERVICE_BONUS: Record<string, number> = {
  "demand-gen-abm-content": 10,
  "cmo-office": 8,
  "sales-enablement": 6,
  "marketeroid": 6,
  "branding-rebranding": 4,
  "gtm-office": 0,
};

export function scoreConnection(input: {
  position: string | null; company: string | null; confidence: number | null;
  serviceSlug?: string | null;
}): ScoreBreakdown {
  const title = normalizeTitle(input.position ?? "");
  let seniority = 8;
  for (const [re, pts] of SENIORITY) { if (re.test(title)) { seniority = pts; break; } }
  const function_fit = FUNCTION_TERMS.test(title) ? 12 : 0;
  const confidence = Math.round((input.confidence ?? 50) * 0.3);
  const founder_bonus = /founder|chief executive officer/.test(title) && !FUNCTION_TERMS.test(title) ? 8 : 0;
  const company_present = input.company ? 5 : 0;
  const service_bonus = SERVICE_BONUS[input.serviceSlug ?? ""] ?? 0;
  const total = seniority + function_fit + confidence + founder_bonus + company_present + service_bonus;
  return { seniority, function_fit, confidence, founder_bonus, company_present, service_bonus, total };
}

export function tierFor(total: number): 1 | 2 | 3 {
  if (total >= 70) return 1;
  if (total >= 50) return 2;
  return 3;
}

export async function rankBatch(orgId: string, batchId: string): Promise<number> {
  const rows = await db.select({
    id: connection.id,
    positionRaw: connection.positionRaw,
    headlineRaw: connection.headlineRaw,
    companyRaw: connection.companyRaw,
    matchConfidence: connection.matchConfidence,
    serviceSlug: connection.serviceSlug,
  }).from(connection)
    .where(and(eq(connection.orgId, orgId), eq(connection.batchId, batchId), eq(connection.bucket, "pitchable")));

  // Score/tier in chunked bulk updates.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = sql.join(chunk.map((c) => {
      const b = scoreConnection({
        position: c.positionRaw ?? c.headlineRaw,
        company: c.companyRaw,
        confidence: c.matchConfidence,
        serviceSlug: c.serviceSlug,
      });
      return sql`(${c.id}::text, ${b.total}::int, ${tierFor(b.total)}::int, ${JSON.stringify(b)}::jsonb)`;
    }), sql`, `);
    await db.execute(sql`
      update connection as c
      set score = v.score, tier = v.tier, score_breakdown_json = v.breakdown
      from (values ${values}) as v(id, score, tier, breakdown)
      where c.id = v.id
    `);
  }

  // Dense rank in ONE statement.
  await db.execute(sql`
    with ranked as (
      select id, row_number() over (order by score desc nulls last, created_at asc) as rn
      from connection
      where batch_id = ${batchId} and bucket = 'pitchable'
    )
    update connection as c set rank = ranked.rn
    from ranked where c.id = ranked.id
  `);

  // Clear stale rank/tier/score on anything not pitchable (incl. NULL buckets).
  await db.execute(sql`
    update connection set rank = null, tier = null, score = null, score_breakdown_json = null
    where batch_id = ${batchId} and bucket is distinct from 'pitchable'
  `);

  return rows.length;
}
