/**
 * Day 9's two unmeasured bars, on the whole ground truth rather than a sample.
 *
 *   DRY=1 npx tsx scripts/eval-top30-overlap.ts          # rules + rank, no model calls
 *   CLASSIFY_PROMPT_VERSION=v8 npx tsx scripts/eval-top30-overlap.ts
 *
 * docs/ACCEPTANCE.md measures the PROMPT against a 300-person sample of the
 * target pool. Two of Day 9's four bars cannot be measured that way at all:
 *
 *   TOP-30 OVERLAP — the tool's rank is dense over the whole pool, so the
 *     question "are the tool's top 30 the human's top 30" only has an answer
 *     once every one of the 4,502 people has a bucket, a confidence and a
 *     score. That means the real pipeline: rule pass first, model for the
 *     remainder, then rankBatch.
 *   FULL-POPULATION BUCKET ACCURACY — the sampled number carries ±2.5 points of
 *     sampling error and deliberately over-represents the two tiny classes.
 *     Running everyone removes both problems.
 *
 * It builds a throwaway LOCAL workspace, copies TTC's live catalog and settings
 * into it read-only so rules and scoring behave exactly as they do in
 * production, imports the workbook, and deletes the workspace afterwards
 * whatever happens. Nothing is written outside the local database.
 *
 * It makes a LOT of model calls — every person the rules do not resolve. DRY=1
 * rehearses the whole thing for free (cap the model out, rules and rank only),
 * which is how to check the wiring before paying for it.
 */
import "./require-local-db";
import ExcelJS from "exceljs";
import { Pool } from "pg";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, connection, connectionBatch, org, service } from "../src/db";
import { bucketCounts, classifyBatch } from "../src/modules/matching/service-fit";
import { rankBatch } from "../src/modules/scoring/rank";
import { updateOrgSettings } from "../src/modules/settings/org-settings";
import { env } from "../src/lib/env";
import type { IcpJson, OrgSettings } from "../src/db/schema";

const WORKBOOK = process.env.GROUND_TRUTH
  ?? "/Users/gowtham/Downloads/TTC-LinkedIn-ABM-Batch1-completed.xlsx";
const LABEL = "top30-overlap-eval";
const DRY = Boolean(process.env.DRY);
/** The live TTC workspace has SAVED signal lists, which override the shipped
 *  defaults — so the tuned defaults in rule-pass.ts do not reach it until
 *  someone edits Settings. Default here is to measure what the product now
 *  ships (tuned defaults); LIVE_SIGNALS=1 measures what that workspace does
 *  today instead. The rule pass is free, so the difference between the two is
 *  already measured by scripts/eval-rule-coverage.ts. */
const LIVE_SIGNALS = Boolean(process.env.LIVE_SIGNALS);
/** The workbook was produced with GTM Office as the catch-all (2,528 of its
 *  4,502 target-pool rows carry it) and the live workspace has no catchAllSlug
 *  saved, so without this v8's routing line correctly returns null for everyone
 *  who fits nothing — measuring the missing setting rather than the prompt. */
const CATCH_ALL = process.env.CATCH_ALL ?? "gtm-office";
/** RANK_ONLY isolates the SCORER: it hands every target-pool person the bucket
 *  and service the deliverable itself gave them, with one fixed confidence, and
 *  asks only whether rankBatch surfaces the same 30 people the human chose.
 *  Confidence is constant so it cannot affect the ORDER — what is left is
 *  seniority, function fit, the service bonus and whatever else the scorer
 *  reads. No model calls, so ranking can be tuned in seconds instead of in
 *  $2.30 increments. The full run remains the honest end-to-end number. */
const RANK_ONLY = Boolean(process.env.RANK_ONLY);
const FIXED_CONFIDENCE = 80;
/** KEEP=1 leaves the classified workspace in the local database instead of
 *  deleting it, and RERANK=1 re-scores and re-measures that kept workspace
 *  without importing or classifying anything. Classification is the only part
 *  that costs money; ranking is arithmetic. Keeping the batch turns tuning the
 *  scorer from a $2.30 question into a free one, which is the difference
 *  between measuring a weight and guessing it. */
/** Implied by RERANK and RESUME, and that is not a convenience: the first
 *  version required KEEP alongside them, so a free re-rank of a kept workspace
 *  ran its finally block and DELETED the classified rows it had just read —
 *  $1.60 of classification thrown away by a read-only-looking command. Asking
 *  to reuse a workspace is asking to keep it. */
const KEEP = Boolean(process.env.KEEP) || Boolean(process.env.RERANK) || Boolean(process.env.RESUME);
const RERANK = Boolean(process.env.RERANK);
/** RESUME=1 picks a kept workspace back up and classifies only the rows that
 *  have no bucket yet. classifyBatch already works that way by default — it
 *  filters on `bucket is null` unless told to reclassify — so an interrupted
 *  run costs only what it had not reached, which is the difference between
 *  stopping a measurement and abandoning one. */
const RESUME = Boolean(process.env.RESUME);
/** Override the workspace's employer-fit weight for this measurement only. */
const ICP_FIT_BONUS = process.env.ICP_FIT_BONUS === undefined
  ? undefined : Number(process.env.ICP_FIT_BONUS);

type Truth = "pitchable" | "off_icp" | "peer_competitor";
interface Person {
  first: string; last: string; company: string; position: string;
  url: string; truth: Truth; service: string | null; humanRank: number | null;
}

/** Ground-truth service labels are display names; the catalog stores slugs. */
const SERVICE_TO_SLUG: Record<string, string> = {
  "gtm office": "gtm-office",
  "marketeroid": "marketeroid",
  "demand gen + abm + content": "demand-gen-abm-content",
  "sales enablement": "sales-enablement",
  "branding / rebranding": "branding-rebranding",
  "cmo office": "cmo-office",
};

function cell(row: ExcelJS.Row, i: number): string {
  const v = (row.values as unknown[])[i];
  if (v == null) return "";
  if (typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text ?? "").trim();
  return String(v).trim();
}

/** Names are the only join between the workbook's sheets, so they are compared
 *  the way a human would read them: case, punctuation and the decorations
 *  people put in their LinkedIn names ("Dr. Kiran ☆ Veigas") removed. */
function nameKey(first: string, last: string): string {
  return `${first} ${last}`.toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(dr|mr|mrs|ms|prof)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

async function loadWorkbook(): Promise<{ people: Person[]; top30: Map<string, number> }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK);
  const people: Person[] = [];

  const pool = wb.getWorksheet("Target Pool (ranked)");
  pool?.eachRow((row, i) => {
    if (i === 1) return;
    const company = cell(row, 5);
    if (/\(example/i.test(company)) return;
    const first = cell(row, 3), last = cell(row, 4), position = cell(row, 6);
    if (!first && !last) return;
    const svc = cell(row, 8).toLowerCase();
    people.push({
      first, last, company, position, url: cell(row, 7),
      truth: "pitchable", service: SERVICE_TO_SLUG[svc] ?? null,
      humanRank: Number(cell(row, 1)) || null,
    });
  });

  for (const [sheet, truth] of [
    ["Review — off-ICP", "off_icp"], ["Peers & Competitors", "peer_competitor"],
  ] as const) {
    wb.getWorksheet(sheet)?.eachRow((row, i) => {
      if (i === 1) return;
      const company = cell(row, 3);
      if (/\(example/i.test(company)) return;
      const first = cell(row, 1), last = cell(row, 2);
      if (!first && !last) return;
      people.push({
        first, last, company, position: cell(row, 4), url: cell(row, 5),
        truth, service: null, humanRank: null,
      });
    });
  }

  const top30 = new Map<string, number>();
  wb.getWorksheet("Top 30 — Batch 1")?.eachRow((row, i) => {
    if (i === 1) return;
    const rank = cell(row, 1);
    if (/\(example/i.test(cell(row, 4)) || rank.toLowerCase() === "ex") return;
    top30.set(nameKey(cell(row, 2), cell(row, 3)), Number(rank) || 0);
  });
  return { people, top30 };
}

/** TTC's live catalog and settings, read-only, so the rules and the scorer
 *  behave here exactly as they do for the workspace this bar is about. */
async function loadLiveConfig() {
  const url = process.env.DATABASE_URL_PRODUCTION ?? process.env.DATABASE_URL;
  const pg = new Pool({ connectionString: url });
  const svc = await pg.query(
    `select s.slug, s.name, s.icp_json from service s
     join org o on o.id = s.org_id
     where o.name = 'toss the coin' and s.status = 'active' order by s.slug`,
  );
  const set = await pg.query(
    `select settings_json from org where name = 'toss the coin' limit 1`,
  );
  await pg.end();
  if (!svc.rows.length) throw new Error("No live TTC catalog found.");
  return {
    services: svc.rows.map((r) => ({ slug: r.slug as string, name: r.name as string, icp: r.icp_json as IcpJson })),
    settings: (set.rows[0]?.settings_json ?? {}) as Partial<OrgSettings>,
  };
}

async function wipe() {
  const rows = await db.select({ id: org.id }).from(org).where(eq(org.name, LABEL));
  for (const o of rows) {
    await db.delete(connection).where(eq(connection.orgId, o.id));
    await db.delete(connectionBatch).where(eq(connectionBatch.orgId, o.id));
    await db.delete(service).where(eq(service.orgId, o.id));
    await db.delete(org).where(eq(org.id, o.id));
  }
}

function pct(n: number, d: number) { return d ? `${((n / d) * 100).toFixed(1)}%` : "n/a"; }

async function main() {
  if (!RERANK && !RESUME) await wipe();
  const { people, top30 } = await loadWorkbook();
  const { services, settings } = await loadLiveConfig();
  console.log(`Workbook: ${people.length} people · human Top 30: ${top30.size}`);
  console.log(`Live catalog: ${services.map((s) => s.slug).join(", ")}`);
  console.log(`Live settings that steer this run:`);
  console.log(`  sellerName        ${settings.sellerName ?? "(unset)"}`);
  console.log(`  peerSignals       ${settings.peerSignals ? `OVERRIDDEN (${settings.peerSignals.length})` : "defaults"}`);
  console.log(`  offIcpSignals     ${settings.offIcpSignals ? `OVERRIDDEN (${settings.offIcpSignals.length})` : "defaults"}`);
  console.log(`  catchAllSlug      ${settings.catchAllSlug ?? `(unset live) -> using ${CATCH_ALL}`}`);
  console.log(`  signal lists      ${LIVE_SIGNALS ? "the workspace's SAVED lists" : "the shipped defaults (saved lists ignored)"}`);
  console.log(`  prompt version    ${env.CLASSIFY_PROMPT_VERSION}${DRY ? "  (DRY — no model calls)" : ""}`);

  let o: { id: string };
  // Assigned on both paths below (created, or looked up under RERANK); the
  // definite-assignment marker keeps the reporting code free of null checks
  // that could only ever fire if one of those paths forgot to set it.
  let batch!: { id: string };
  if (RERANK || RESUME) {
    const [kept] = await db.select({ id: org.id }).from(org).where(eq(org.name, LABEL));
    if (!kept) throw new Error(`Nothing kept — run once with KEEP=1 before RERANK=1.`);
    const [keptBatch] = await db.select({ id: connectionBatch.id }).from(connectionBatch)
      .where(eq(connectionBatch.orgId, kept.id)).limit(1);
    if (!keptBatch) throw new Error("The kept workspace has no batch.");
    o = kept; batch = keptBatch;
    const [done] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
      .where(and(eq(connection.batchId, batch.id), sql`bucket is not null`));
    const [all] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
      .where(eq(connection.batchId, batch.id));
    console.log(RESUME
      ? `\nResuming the kept workspace: ${done.n}/${all.n} already classified, ${all.n - done.n} to go.`
      : `\nRe-ranking the kept workspace: ${done.n} rows already classified, no model calls.`);
  } else {
    [o] = await db.insert(org).values({ name: LABEL }).returning();
  }
  try {
    if (ICP_FIT_BONUS !== undefined) {
      await updateOrgSettings(o.id, { icpFitBonus: ICP_FIT_BONUS });
      console.log(`  employer-fit weight for this run: ${ICP_FIT_BONUS} points`);
    }
    if (!RERANK && !RESUME) {
    await updateOrgSettings(o.id, {
      ...settings,
      ...(LIVE_SIGNALS ? {} : { peerSignals: undefined, offIcpSignals: undefined }),
      catchAllSlug: settings.catchAllSlug ?? CATCH_ALL,
      // DRY caps the model out: the first slice of 25 exceeds a cap of 1, so
      // pass 2 plans nothing and the run is rules + rank only, for free.
      classifyLlmPeopleCap: DRY ? 1 : "all",
    });
    for (const s of services) {
      await db.insert(service).values({ orgId: o.id, slug: s.slug, name: s.name, icpJson: s.icp });
    }
    [batch] = await db.insert(connectionBatch)
      .values({ orgId: o.id, source: "csv", label: LABEL, statsJson: { imported: people.length } })
      .returning();

    const importing = RANK_ONLY ? people.filter((p) => p.truth === "pitchable") : people;
    const CHUNK = 500;
    for (let i = 0; i < importing.length; i += CHUNK) {
      await db.insert(connection).values(importing.slice(i, i + CHUNK).map((p) => ({
        orgId: o.id, batchId: batch.id,
        firstName: p.first || "(unknown)", lastName: p.last,
        companyRaw: p.company, positionRaw: p.position,
        linkedinUrl: p.url || null,
        ...(RANK_ONLY ? {
          bucket: "pitchable" as const, serviceSlug: p.service,
          matchConfidence: FIXED_CONFIDENCE, matchMethod: "rule" as const,
        } : {}),
      })));
    }
    console.log(`\nImported ${importing.length} rows.${RANK_ONLY ? " Scoring only (RANK_ONLY)…" : " Classifying…"}`);

    }
    // Fresh or resumed, never on a pure re-rank. classifyBatch only touches
    // rows with no bucket, so a resume pays for exactly what was left.
    if (!RANK_ONLY && !RERANK) {
      const t0 = Date.now();
      const res = await classifyBatch(o.id, batch.id, { fullPool: !DRY },
        async (done, total) => {
          if (done % 500 < 25) process.stdout.write(`\r  ${done}/${total} classified   `);
        });
      process.stdout.write("\n");
      console.log(`  rule hits ${res.ruleHits} · model calls ${res.llmCalls} · ${Math.round((Date.now() - t0) / 1000)}s`);
    }
    const ranked = await rankBatch(o.id, batch.id);
    console.log(`  ranked ${ranked} pitchable people`);

    // ── Bar 1: full-population bucket accuracy ────────────────────────────
    const rows = await db.select({
      firstName: connection.firstName, lastName: connection.lastName,
      bucket: connection.bucket, serviceSlug: connection.serviceSlug,
      rank: connection.rank, score: connection.score, matchMethod: connection.matchMethod,
      positionRaw: connection.positionRaw, companyRaw: connection.companyRaw,
    }).from(connection).where(eq(connection.batchId, batch.id));
    const byKey = new Map(rows.map((r) => [nameKey(r.firstName, r.lastName), r]));

    const matrix = new Map<Truth, Map<string, number>>();
    let svcJudged = 0, svcAgree = 0;
    for (const p of people) {
      const got = byKey.get(nameKey(p.first, p.last));
      const pred = got?.bucket ?? "unclassified";
      if (!matrix.has(p.truth)) matrix.set(p.truth, new Map());
      const row = matrix.get(p.truth)!;
      row.set(pred, (row.get(pred) ?? 0) + 1);
      if (p.truth === "pitchable" && p.service && pred === "pitchable" && got?.serviceSlug) {
        svcJudged += 1;
        if (got.serviceSlug === p.service) svcAgree += 1;
      }
    }

    console.log(`\n${"=".repeat(72)}\nBAR 1 — BUCKET ACCURACY, FULL POPULATION (pipeline: rules, then ${env.CLASSIFY_PROMPT_VERSION})\n${"=".repeat(72)}`);
    if (RANK_ONLY) console.log("  (skipped — RANK_ONLY hands the buckets over, so this would score itself)");
    let weighted = 0, popTotal = 0;
    for (const truth of (RANK_ONLY ? [] : ["pitchable", "off_icp", "peer_competitor"]) as readonly Truth[]) {
      const row = matrix.get(truth);
      if (!row) continue;
      const total = [...row.values()].reduce((a, b) => a + b, 0);
      const hit = row.get(truth) ?? 0;
      weighted += hit; popTotal += total;
      const spread = [...row].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join("  ");
      console.log(`  ${truth.padEnd(16)} ${pct(hit, total).padStart(6)} of ${String(total).padStart(5)}   ${spread}`);
    }
    if (!RANK_ONLY) {
      console.log(`  ${"POPULATION".padEnd(16)} ${pct(weighted, popTotal).padStart(6)} of ${String(popTotal).padStart(5)}   (no sampling error — everyone was classified)`);
      console.log(`  service agreement ${pct(svcAgree, svcJudged)} (${svcAgree}/${svcJudged})`);
    }
    if (!RANK_ONLY) {
      const counts = await bucketCounts(batch.id);
      const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
        .where(and(eq(connection.batchId, batch.id), isNull(connection.bucket)));
      console.log(`  rows left unclassified: ${left.n}${DRY ? " (expected in DRY — the model never ran)" : ""} · buckets ${JSON.stringify(counts)}`);
    }

    // ── Bar 2: top-30 overlap ─────────────────────────────────────────────
    const toolTop = rows.filter((r) => r.rank != null && r.rank <= 30)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    const hit = toolTop.filter((r) => top30.has(nameKey(r.firstName, r.lastName)));
    console.log(`\n${"=".repeat(72)}\nBAR 2 — TOP-30 OVERLAP\n${"=".repeat(72)}`);
    console.log(`  the tool's top 30 vs the human's 30: ${hit.length}/${Math.min(30, top30.size)} = ${pct(hit.length, Math.min(30, top30.size))}`);
    console.log(`\n  the tool's top 30 (· = also in the human's list):`);
    for (const r of toolTop) {
      const mark = top30.has(nameKey(r.firstName, r.lastName)) ? "·" : " ";
      console.log(`   ${mark} ${String(r.rank).padStart(3)} s${String(r.score).padStart(3)} ${`${r.firstName} ${r.lastName}`.slice(0, 26).padEnd(28)} ${(r.positionRaw ?? "").slice(0, 34).padEnd(36)} ${(r.companyRaw ?? "").slice(0, 24)}`);
    }
    const missed = [...top30].filter(([k]) => !hit.some((r) => nameKey(r.firstName, r.lastName) === k));
    console.log(`\n  human picks the tool did NOT put in its top 30 (${missed.length}) — with where it did put them:`);
    for (const [k, humanRank] of missed.sort((a, b) => a[1] - b[1])) {
      const got = byKey.get(k);
      console.log(`     human #${String(humanRank).padStart(2)}  ${k.padEnd(28)} tool: ${got ? `${got.bucket}${got.rank ? ` rank ${got.rank}` : ""}${got.score != null ? ` score ${got.score}` : ""}` : "NOT FOUND in the import"}`);
    }
  } finally {
    if (KEEP) {
      console.log(`\nKEEP=1 — the ${LABEL} workspace stays in the local database.`);
      console.log(`  re-score it for free:  RERANK=1 ICP_FIT_BONUS=<n> npx tsx scripts/eval-top30-overlap.ts`);
      console.log(`  delete it when done:   psql "$DATABASE_URL" -c "delete from connection where org_id='${o.id}'; delete from connection_batch where org_id='${o.id}'; delete from service where org_id='${o.id}'; delete from org where id='${o.id}';"`);
    } else {
      await wipe();
      console.log(`\ncleaned up the ${LABEL} workspace`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
