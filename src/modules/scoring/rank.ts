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
  [/chief\s+\w+\s+officer|founder\b|managing director|president\b/, 40, "cxo/founder"],
  [/\bhead of|\bhead\b|director/, 28, "head/director"],
  [/general manager|lead\b/, 22, "gm/lead"],
  [/manager/, 16, "manager"],
];
/** Defaults only. These are the words that describe TOSS THE COIN's buyer; a
 *  workspace selling something else overrides them in Settings. Left hardcoded
 *  they rank a client's real buyers below their competitors — measured on the
 *  Ariel workspace, only 8 of the top 50 held an HR/talent/L&D title while 180
 *  such people sat in the pool. */
export const DEFAULT_FUNCTION_TERMS = [
  "market", "brand", "growth", "demand", "communicat",
  "content", "gtm", "go to market", "revenue", "sales",
];

export interface RankWeights {
  functionTerms: string[];
  /** Exact slug -> bonus. Falls back to the substring rules when absent. */
  serviceWeights?: Record<string, number>;
}

export const DEFAULT_RANK_WEIGHTS: RankWeights = { functionTerms: DEFAULT_FUNCTION_TERMS };

/** Substring test against the normalised title, matching how every other
 *  signal list in the codebase is evaluated. An empty list scores nobody. */
function hasFunctionFit(title: string, terms: string[]): boolean {
  for (const t of terms) if (t && title.includes(t)) return true;
  return false;
}

/** GT's Top 30 is dominated by pipeline-owning marketers — rank mirrors that
 *  priority so the machine's Top-N composes like the human's did. */
/** Substring-matched so legacy slugs (cmo-office, sales-enablement…) and the
 *  v3 live-catalog slugs (gmo-office, gmo-for-pe…) both resolve. Order matters:
 *  first hit wins. Tune freely — Re-rank is free. */
const DEFAULT_SERVICE_BONUS_RULES: [string, number][] = [
  ["marketeroid", 10],
  ["gmo-for-pe", 8], ["sales-enablement", 8],
  ["gmo", 8], ["cmo", 8],
  ["demand", 6],
  ["manufacturing", 5], ["gtm", 5],
  ["etch", 4], ["leadership", 4],
  ["brand", 4],
];
function serviceBonus(slug: string, weights?: Record<string, number>): number {
  if (!slug) return 0;
  // A configured workspace maps its own slugs exactly; only fall back to
  // substring guessing when nothing has been configured.
  if (weights && Object.keys(weights).length > 0) return weights[slug] ?? 0;
  for (const [needle, bonus] of DEFAULT_SERVICE_BONUS_RULES) if (slug.includes(needle)) return bonus;
  return 0;
}

export function scoreConnection(input: {
  position: string | null; company: string | null; confidence: number | null;
  serviceSlug?: string | null;
}, weights: RankWeights = DEFAULT_RANK_WEIGHTS): ScoreBreakdown {
  const title = normalizeTitle(input.position ?? "");
  let seniority = 8;
  for (const [re, pts] of SENIORITY) { if (re.test(title)) { seniority = pts; break; } }
  const fit = hasFunctionFit(title, weights.functionTerms);
  const function_fit = fit ? 12 : 0;
  const confidence = Math.round((input.confidence ?? 50) * 0.3);
  // The founder bonus exists to lift founders who are NOT already scoring on
  // function fit — otherwise it double-counts.
  const founder_bonus = /founder\b|chief executive officer/.test(title) && !fit ? 8 : 0;
  const company_present = input.company ? 5 : 0;
  const service_bonus = serviceBonus(input.serviceSlug ?? "", weights.serviceWeights);
  const total = seniority + function_fit + confidence + founder_bonus + company_present + service_bonus;
  return { seniority, function_fit, confidence, founder_bonus, company_present, service_bonus, total };
}

export function tierFor(total: number): 1 | 2 | 3 {
  if (total >= 70) return 1;
  if (total >= 50) return 2;
  return 3;
}

export async function rankBatch(orgId: string, batchId: string): Promise<number> {
  // One settings read per run, not per person.
  const { getOrgSettings } = await import("@/modules/settings/org-settings");
  const s = await getOrgSettings(orgId);
  const weights: RankWeights = {
    functionTerms: s.functionTerms ?? DEFAULT_FUNCTION_TERMS,
    serviceWeights: s.serviceWeights,
  };

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
      }, weights);
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
