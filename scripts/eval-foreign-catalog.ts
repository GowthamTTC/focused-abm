/**
 * The test the TTC ground truth cannot run: does a prompt route correctly for a
 * workspace whose catalog shares NOTHING with the slugs the prompt was written
 * around?
 *
 * Adam's workspace sells executive coaching and leadership development. v3's
 * routing line names six marketing slugs; 175 of his 180 unserviced people are
 * the model obeying "everyone else -> gtm-office" over the menu in front of it.
 * There is no human label for his people, so the measure here is not accuracy
 * but VALIDITY: of the people a version calls pitchable, how many get a service
 * that actually exists in his catalog?
 *
 * Read-only — reads people from production, writes nothing.
 *   npx tsx scripts/eval-foreign-catalog.ts v3 v4
 */
import "dotenv/config";
import { z } from "zod";
import { Pool } from "pg";
import { complete } from "../src/llm/client";
import { servicesDigest } from "../src/modules/matching/service-fit";
import type { IcpJson } from "../src/db/schema";

const EMAIL = process.env.WORKSPACE_EMAIL ?? "apingel@arielgroup.com";
const CATCH_ALL = process.env.CATCH_ALL ?? "leadership-communication-development";
const SAMPLE = Number(process.env.SAMPLE ?? 150);
const BATCH = 25;

const fitArray = z.array(z.object({
  id: z.string(),
  bucket: z.string().min(1),
  service_slug: z.string().nullable(),
  confidence: z.number().int().min(0).max(100),
  why: z.string().min(1),
}));

async function main() {
  const versions = process.argv.slice(2).filter((a) => /^v\d+$/.test(a));
  if (!versions.length) throw new Error("Usage: tsx scripts/eval-foreign-catalog.ts v3 v4");

  const pg = new Pool({ connectionString: process.env.DATABASE_URL_PRODUCTION ?? process.env.DATABASE_URL });
  const u = await pg.query("select org_id from app_user where email = $1", [EMAIL]);
  if (!u.rows.length) throw new Error(`No workspace for ${EMAIL}`);
  const orgId = u.rows[0].org_id;

  const svc = await pg.query(
    "select slug, name, icp_json from service where org_id = $1 and status = 'active' order by slug", [orgId]);
  const services = svc.rows.map((s) => ({ slug: s.slug, name: s.name, icp: s.icp_json as IcpJson }));
  const slugs = new Set(services.map((s) => s.slug));

  // The people the model actually judged, in the state it left them.
  const people = await pg.query(
    `select first_name, last_name, company_raw, position_raw, headline_raw, service_slug
     from connection
     where org_id = $1 and bucket = 'pitchable' and match_method = 'llm'
     order by id limit $2`, [orgId, SAMPLE]);
  await pg.end();

  console.log(`Workspace: ${EMAIL}`);
  console.log(`Catalog:   ${[...slugs].join(", ")}`);
  console.log(`Catch-all: ${slugs.has(CATCH_ALL) ? CATCH_ALL : "(none — not in catalog)"}`);
  console.log(`People:    ${people.rows.length} currently pitchable & model-classified`);
  const baselineBlank = people.rows.filter((r) => !r.service_slug).length;
  console.log(`Today:     ${baselineBlank} of them have NO service (${((baselineBlank / people.rows.length) * 100).toFixed(1)}%)\n`);

  const digest = servicesDigest(services, CATCH_ALL);

  for (const version of versions) {
    let valid = 0, invalid = 0, nulls = 0, judged = 0, calls = 0, failed = 0;
    const dist = new Map<string, number>();
    const invented = new Map<string, number>();

    for (let i = 0; i < people.rows.length; i += BATCH) {
      const slice = people.rows.slice(i, i + BATCH);
      const peopleJson = JSON.stringify(slice.map((p, j) => ({
        id: `${i}-${j}`,
        name: `${p.first_name} ${p.last_name}`.trim(),
        company: p.company_raw ?? "",
        position: p.position_raw ?? p.headline_raw ?? "",
      })));
      try {
        const out = await complete({
          stage: "classify", prompt: "service-fit", version,
          vars: { people_json: peopleJson, own_company: "Ariel" },
          cachedContext: digest, schema: fitArray, maxTokens: 6000,
        });
        calls += 1;
        for (const o of out) {
          if (o.bucket !== "pitchable") continue;
          judged += 1;
          if (!o.service_slug) { nulls += 1; dist.set("(null)", (dist.get("(null)") ?? 0) + 1); continue; }
          if (slugs.has(o.service_slug)) {
            valid += 1;
            dist.set(o.service_slug, (dist.get(o.service_slug) ?? 0) + 1);
          } else {
            invalid += 1;
            invented.set(o.service_slug, (invented.get(o.service_slug) ?? 0) + 1);
          }
        }
      } catch { failed += 1; }
      process.stdout.write(`\r  ${version}: ${judged} judged, ${calls} calls   `);
    }
    process.stdout.write("\n");

    const p = (n: number) => (judged ? `${((n / judged) * 100).toFixed(1)}%` : "n/a");
    console.log(`\n${version} — of ${judged} people it called pitchable:`);
    console.log(`  service from HIS catalog   ${String(valid).padStart(4)}  ${p(valid)}`);
    console.log(`  invented a slug            ${String(invalid).padStart(4)}  ${p(invalid)}`);
    console.log(`  honest null                ${String(nulls).padStart(4)}  ${p(nulls)}`);
    if (invented.size) {
      console.log("  slugs invented:");
      for (const [k, n] of [...invented].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(4)}  ${k}`);
    }
    console.log("  routed to:");
    for (const [k, n] of [...dist].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(4)}  ${k}`);
    if (failed) console.log(`  (${failed} calls failed)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
