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
  /** slug -> that service's ICP fit signals, for the employer test below. */
  fitSignals?: Record<string, string[]>;
  /** What a confirmed employer match is worth. Unset means DEFAULT_ICP_FIT_BONUS,
   *  which is 0 until someone measures it — see that constant. */
  icpFitBonus?: number;
}

/** What a confirmed employer↔ICP match is worth, in points.
 *
 *  ZERO, AND THAT IS NOT THE ANSWER — it is the absence of one. The component
 *  below is built and tested; what has never been measured is the WEIGHT, and
 *  a number invented for the ranking every workspace's daily list comes out of
 *  is worse than no number. Shipping it off means nobody's list moves until
 *  someone has measured what moving it does.
 *
 *  What IS measured (docs/ACCEPTANCE.md, run 2026-09-18): top-30 overlap is
 *  6/30 because the scorer never looks at the employer at all, and the ICP's
 *  own language is present in the classifier's `why` sentence for 54.8% of
 *  classified people, against 1.5% in company names. So the signal is real and
 *  reachable. What it is worth against a C-title's 40 points is the open
 *  question.
 *
 *  To answer it, per that doc: classify the workbook once (one paid run), keep
 *  the batch, then sweep this weight for free —
 *    KEEP=1 CLASSIFY_PROMPT_VERSION=v8 npx tsx scripts/eval-top30-overlap.ts
 *    RERANK=1 ICP_FIT_BONUS=0  npx tsx scripts/eval-top30-overlap.ts   # baseline
 *    RERANK=1 ICP_FIT_BONUS=10 npx tsx scripts/eval-top30-overlap.ts   # …and 14, 18, 25
 *  Set the winner as `icpFitBonus` in Settings, or make it this default once a
 *  run backs it. Arithmetic bounds, for whoever does: under 6 nothing changes,
 *  because a CMO outscores a VP by exactly 6; past ~20 a manager at a fitting
 *  employer starts outranking a CMO at one. */
export const DEFAULT_ICP_FIT_BONUS = 0;

export const DEFAULT_RANK_WEIGHTS: RankWeights = { functionTerms: DEFAULT_FUNCTION_TERMS };

/** Does this person's EMPLOYER look like the ICP they were matched to?
 *
 *  The ranker used to award exactly five points for "has a company at all" and
 *  nothing whatever for WHICH company, which is how its top 30 filled up with
 *  CMOs at a paint retailer and a construction firm while the human's top 30
 *  was VP-level marketers at IT-services firms — mid-senior titles, employers
 *  that buy (docs/ACCEPTANCE.md, top-30 overlap 6/30).
 *
 *  The evidence is the service's OWN fit_signals — the workspace wrote them —
 *  tested against everything we already hold about the employer. Which text
 *  matters is measured, not assumed: across 400 classified people, the ICP's
 *  language appears in the company NAME 1.5% of the time, in the headline 3.5%,
 *  and in the classifier's own `why` sentence 54.8%, because the model names
 *  the trade while explaining itself ("Chief Marketing Officer at iPacket (B2B
 *  IT services)"). So `why` is the signal and the other two are free extras.
 *
 *  A rule-pass hit writes a `why` about the TITLE ("Title matched pattern
 *  'chief'"), never the employer, so those rows will not fire this. That is
 *  the honest reading: nobody has qualified that employer. Verified fit ranks
 *  above unverified, and unverified still ranks above a verified mismatch. */
export function employerFitsIcp(
  employerText: string | null | undefined,
  fitSignals: string[] | undefined,
): boolean {
  if (!employerText || !fitSignals?.length) return false;
  const hay = employerText.toLowerCase();
  for (const sig of fitSignals) {
    const s = sig.trim().toLowerCase();
    // One- and two-character signals would match inside unrelated words.
    if (s.length > 2 && hay.includes(s)) return true;
  }
  return false;
}

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
  /** Everything known about the employer at rank time: the classifier's own
   *  reason, the headline, the company name. See employerFitsIcp. */
  matchWhy?: string | null; headline?: string | null;
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
  const employerText = [input.matchWhy, input.headline, input.company].filter(Boolean).join(" · ");
  const icp_fit = employerFitsIcp(employerText, weights.fitSignals?.[input.serviceSlug ?? ""])
    ? (weights.icpFitBonus ?? DEFAULT_ICP_FIT_BONUS)
    : 0;
  const total = seniority + function_fit + confidence + founder_bonus + company_present + service_bonus + icp_fit;
  return { seniority, function_fit, confidence, founder_bonus, company_present, service_bonus, icp_fit, total };
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
  // The workspace's own ICP language, one read per run, keyed by the slug each
  // person was matched to — this is what the employer test is made of.
  const { service } = await import("@/db");
  const services = await db.select({ slug: service.slug, icpJson: service.icpJson })
    .from(service).where(and(eq(service.orgId, orgId), eq(service.status, "active")));
  const fitSignals: Record<string, string[]> = {};
  for (const svc of services) fitSignals[svc.slug] = svc.icpJson?.fit_signals ?? [];
  const weights: RankWeights = {
    functionTerms: s.functionTerms ?? DEFAULT_FUNCTION_TERMS,
    serviceWeights: s.serviceWeights,
    fitSignals,
    icpFitBonus: s.icpFitBonus,
  };

  const rows = await db.select({
    id: connection.id,
    positionRaw: connection.positionRaw,
    headlineRaw: connection.headlineRaw,
    companyRaw: connection.companyRaw,
    matchConfidence: connection.matchConfidence,
    serviceSlug: connection.serviceSlug,
    matchWhy: connection.matchWhy,
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
        matchWhy: c.matchWhy,
        headline: c.headlineRaw,
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
