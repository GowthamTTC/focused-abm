/**
 * Score service-fit prompt versions against the TTC Batch-1 ground truth.
 *
 * The workbook is a labelled dataset: sheet membership IS the human bucket.
 *   Target Pool (ranked) -> pitchable      (4,502)
 *   Review — off-ICP     -> off_icp        (85)
 *   Peers & Competitors  -> peer_competitor (114)
 * "Excluded" has no sheet — those rows never made the deliverable — so a
 * prediction of "excluded" is scored as a disagreement and also reported
 * separately, because it is the one class the ground truth cannot contain.
 *
 * This measures the PROMPT, not the pipeline: every person goes straight to
 * the model. In production the free rule pass resolves many of them first
 * (blank rows, own company, junior titles, peer company names, coach titles),
 * so real-world accuracy is a blend of rules and this.
 *
 * Read-only. Makes LLM calls; writes no database rows.
 *   npx tsx scripts/eval-prompt-versions.ts v2 v3
 */
import "dotenv/config";
import { z } from "zod";
import ExcelJS from "exceljs";
import { Pool } from "pg";
import { complete } from "../src/llm/client";
import { servicesDigest } from "../src/modules/matching/service-fit";
import type { IcpJson } from "../src/db/schema";

const WORKBOOK = process.env.GROUND_TRUTH
  ?? "/Users/gowtham/Downloads/TTC-LinkedIn-ABM-Batch1-completed.xlsx";
const PITCHABLE_SAMPLE = Number(process.env.SAMPLE ?? 300);
const BATCH = 25;
const CONCURRENCY = 3;

/** Ground-truth service labels are display names; the catalog stores slugs. */
const SERVICE_TO_SLUG: Record<string, string> = {
  "gtm office": "gtm-office",
  "marketeroid": "marketeroid",
  "demand gen + abm + content": "demand-gen-abm-content",
  "sales enablement": "sales-enablement",
  "branding / rebranding": "branding-rebranding",
  "cmo office": "cmo-office",
};

type Person = {
  key: string; name: string; company: string; position: string;
  bucket: "pitchable" | "off_icp" | "peer_competitor";
  service: string | null;
};

/** Deterministic sampling so two runs compare the same people. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cell(row: ExcelJS.Row, i: number): string {
  const v = (row.values as unknown[])[i];
  if (v == null) return "";
  if (typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text ?? "").trim();
  if (typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result ?? "").trim();
  return String(v).trim();
}

async function loadGroundTruth(): Promise<Person[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK);
  const out: Person[] = [];

  const pool = wb.getWorksheet("Target Pool (ranked)");
  pool?.eachRow((row, i) => {
    if (i === 1) return;
    const first = cell(row, 3), last = cell(row, 4);
    const company = cell(row, 5), position = cell(row, 6);
    if (!first && !last) return;
    const svc = cell(row, 8).toLowerCase();
    out.push({
      key: `${first} ${last}|${company}`.toLowerCase(),
      name: `${first} ${last}`.trim(), company, position,
      bucket: "pitchable", service: SERVICE_TO_SLUG[svc] ?? null,
    });
  });

  const off = wb.getWorksheet("Review — off-ICP");
  off?.eachRow((row, i) => {
    if (i === 1) return;
    const first = cell(row, 1), last = cell(row, 2);
    if (!first && !last) return;
    out.push({
      key: `${first} ${last}|${cell(row, 3)}`.toLowerCase(),
      name: `${first} ${last}`.trim(), company: cell(row, 3), position: cell(row, 4),
      bucket: "off_icp", service: null,
    });
  });

  const peers = wb.getWorksheet("Peers & Competitors");
  peers?.eachRow((row, i) => {
    if (i === 1) return;
    const first = cell(row, 1), last = cell(row, 2);
    if (!first && !last) return;
    out.push({
      key: `${first} ${last}|${cell(row, 3)}`.toLowerCase(),
      name: `${first} ${last}`.trim(), company: cell(row, 3), position: cell(row, 4),
      bucket: "peer_competitor", service: null,
    });
  });

  // The example row shipped in the template is not a real person.
  return out.filter((p) => !/\(example/i.test(p.company) && (p.company || p.position));
}

async function loadDigest(): Promise<{ digest: string; slugs: Set<string> }> {
  const url = process.env.DATABASE_URL_PRODUCTION ?? process.env.DATABASE_URL;
  const pg = new Pool({ connectionString: url });
  const r = await pg.query(
    `select s.slug, s.name, s.icp_json from service s
     join org o on o.id = s.org_id
     where o.name = 'toss the coin' and s.status = 'active' order by s.slug`,
  );
  await pg.end();
  const services = r.rows.map((x) => ({ slug: x.slug, name: x.name, icp: x.icp_json as IcpJson }));
  if (!services.length) throw new Error("No services found for the reference catalog.");
  return { digest: servicesDigest(services), slugs: new Set(services.map((s) => s.slug)) };
}

const fitArray = z.array(z.object({
  id: z.string(),
  bucket: z.string().min(1),
  service_slug: z.string().nullable(),
  confidence: z.number().int().min(0).max(100),
  why: z.string().min(1),
}));

type Verdict = { bucket: string; slug: string | null; conf: number };

async function runVersion(version: string, people: Person[], digest: string) {
  const slices: Person[][] = [];
  for (let i = 0; i < people.length; i += BATCH) slices.push(people.slice(i, i + BATCH));

  const verdicts = new Map<string, Verdict>();
  let calls = 0, failed = 0, next = 0;

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const i = next++;
      if (i >= slices.length) return;
      const slice = slices[i]!;
      const peopleJson = JSON.stringify(
        slice.map((p, j) => ({ id: `${i}-${j}`, name: p.name, company: p.company, position: p.position })),
      );
      try {
        const out = await complete({
          stage: "classify", prompt: "service-fit", version,
          vars: { people_json: peopleJson, own_company: "toss the coin" },
          cachedContext: digest, schema: fitArray, maxTokens: 6000,
        });
        calls += 1;
        const byId = new Map(out.map((o) => [o.id, o]));
        slice.forEach((p, j) => {
          const o = byId.get(`${i}-${j}`);
          if (o) verdicts.set(p.key, { bucket: o.bucket, slug: o.service_slug, conf: o.confidence });
        });
      } catch {
        failed += 1;
      }
      process.stdout.write(`\r  ${version}: ${verdicts.size}/${people.length} scored, ${calls} calls, ${failed} failed   `);
    }
  }));
  process.stdout.write("\n");
  return { verdicts, calls, failed };
}

const BUCKETS = ["pitchable", "off_icp", "peer_competitor", "excluded", "other"] as const;

function score(people: Person[], verdicts: Map<string, Verdict>, slugs: Set<string>) {
  const matrix = new Map<string, Map<string, number>>();
  let correct = 0, judged = 0, unknownSlug = 0, svcJudged = 0, svcAgree = 0;

  for (const p of people) {
    const v = verdicts.get(p.key);
    if (!v) continue;
    judged += 1;
    const pred = (BUCKETS as readonly string[]).includes(v.bucket) ? v.bucket : "other";
    if (!matrix.has(p.bucket)) matrix.set(p.bucket, new Map());
    const row = matrix.get(p.bucket)!;
    row.set(pred, (row.get(pred) ?? 0) + 1);
    if (pred === p.bucket) correct += 1;

    if (pred === "pitchable" && v.slug && !slugs.has(v.slug)) unknownSlug += 1;
    if (p.bucket === "pitchable" && p.service && pred === "pitchable" && v.slug) {
      svcJudged += 1;
      if (v.slug === p.service) svcAgree += 1;
    }
  }
  return { matrix, correct, judged, unknownSlug, svcJudged, svcAgree };
}

function pct(n: number, d: number) { return d ? `${((n / d) * 100).toFixed(1)}%` : "n/a"; }

async function main() {
  const versions = process.argv.slice(2).filter((a) => /^v\d+$/.test(a));
  if (!versions.length) throw new Error("Usage: tsx scripts/eval-prompt-versions.ts v2 v3");

  const all = await loadGroundTruth();
  const byBucket = {
    pitchable: all.filter((p) => p.bucket === "pitchable"),
    off_icp: all.filter((p) => p.bucket === "off_icp"),
    peer_competitor: all.filter((p) => p.bucket === "peer_competitor"),
  };
  console.log("Ground truth loaded:");
  for (const [k, v] of Object.entries(byBucket)) console.log(`  ${k.padEnd(16)} ${v.length}`);

  // All of both minority classes; a deterministic sample of the majority.
  const rnd = mulberry32(20260902);
  const shuffled = [...byBucket.pitchable].sort(() => rnd() - 0.5);
  const sample = [
    ...shuffled.slice(0, PITCHABLE_SAMPLE),
    ...byBucket.off_icp,
    ...byBucket.peer_competitor,
  ];
  const seen = new Set<string>();
  const people = sample.filter((p) => !seen.has(p.key) && seen.add(p.key));
  console.log(`\nEvaluating ${people.length} people (all off-ICP + all peers + ${PITCHABLE_SAMPLE} sampled pitchable)`);

  const { digest, slugs } = await loadDigest();
  console.log(`Reference catalog: ${[...slugs].join(", ")}\n`);

  const results: Record<string, ReturnType<typeof score> & { calls: number; failed: number }> = {};
  for (const v of versions) {
    const { verdicts, calls, failed } = await runVersion(v, people, digest);
    results[v] = { ...score(people, verdicts, slugs), calls, failed };
  }

  console.log("\n" + "=".repeat(72));
  console.log("BUCKET ACCURACY");
  console.log("=".repeat(72));
  for (const v of versions) {
    const r = results[v]!;
    console.log(`\n${v}  —  ${pct(r.correct, r.judged)} overall  (${r.correct}/${r.judged} judged, ${r.failed} calls failed)`);
    for (const truth of ["pitchable", "off_icp", "peer_competitor"] as const) {
      const row = results[v]!.matrix.get(truth);
      if (!row) continue;
      const total = [...row.values()].reduce((a, b) => a + b, 0);
      const hit = row.get(truth) ?? 0;
      const spread = [...row].sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k}:${n}`).join("  ");
      console.log(`  ${truth.padEnd(16)} ${pct(hit, total).padStart(6)} of ${String(total).padStart(4)}   ${spread}`);
    }
    console.log(`  service agreement  ${pct(r.svcAgree, r.svcJudged)} (${r.svcAgree}/${r.svcJudged} where both named a service)`);
    console.log(`  slugs outside the catalog: ${r.unknownSlug}`);
  }
  console.log("\n" + "=".repeat(72));
}

main().catch((e) => { console.error(e); process.exit(1); });
