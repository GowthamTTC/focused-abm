/**
 * Day 9's fourth bar: does Stage B "read at the same standard" as the human
 * deliverable?
 *
 *   npx tsx scripts/eval-stage-b.ts                 # read-only, free
 *   ENRICH=6 npx tsx scripts/eval-stage-b.ts        # + enrich N of the human
 *                                                   #   Top 30 for a same-person read
 *
 * The workbook's "Top 30 — Batch 1" sheet is the standard: 30 rows a human
 * wrote, each with an About summary, a posts summary, pain points and an
 * outreach message — the same four fields deep-dive.ts produces. So the bar is
 * a reading comparison, and this script lays the two side by side and measures
 * the few things about a draft that CAN be measured without a human: length,
 * whether it survives as one message, whether it leaked a placeholder or a
 * template seam, and whether it names something specific to the person rather
 * than something true of everyone.
 *
 * Read-only by default: it compares the human rows against whatever the tool
 * has already produced in production, which costs nothing and touches nobody.
 * ENRICH=N goes further and runs the real Stage B on N of those same people in
 * a throwaway LOCAL workspace — that fetches their profile and posts through
 * the live seat (N requests, paced like the worker does) and spends N deep-dive
 * model calls, which is why it is opt-in and why N defaults to nothing.
 */
import "./require-local-db";
import ExcelJS from "exceljs";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { db, channelAccount, connection, connectionBatch, org, service } from "../src/db";
import { updateOrgSettings } from "../src/modules/settings/org-settings";
import { env } from "../src/lib/env";
import type { IcpJson, OrgSettings } from "../src/db/schema";

const WORKBOOK = process.env.GROUND_TRUTH
  ?? "/Users/gowtham/Downloads/TTC-LinkedIn-ABM-Batch1-completed.xlsx";
const LABEL = "stage-b-eval";
const ENRICH = Number(process.env.ENRICH ?? 0);
/** The worker's own pacing between profile fetches. Borrowed rather than
 *  reinvented: this script talks to the same seat a customer's runs do. */
const GAP_MS = env.DEEP_ENRICH_MIN_GAP_SECONDS * 1000;

interface HumanRow {
  rank: number; first: string; last: string; company: string; position: string;
  url: string; about: string; posts: string; pain: string; service: string; message: string;
}
interface ToolRow {
  who: string; position: string | null; company: string | null;
  about: string | null; posts: string | null; pain: string | null; message: string | null;
}

function cell(row: ExcelJS.Row, i: number): string {
  const v = (row.values as unknown[])[i];
  if (v == null) return "";
  if (typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text ?? "").trim();
  return String(v).trim();
}
const nameKey = (f: string, l: string) => `${f} ${l}`.toLowerCase()
  .replace(/\(.*?\)/g, " ").replace(/[^a-z\s]/g, " ")
  .replace(/\b(dr|mr|mrs|ms|prof)\b/g, " ").replace(/\s+/g, " ").trim();

function humanRows(wb: ExcelJS.Workbook): HumanRow[] {
  const out: HumanRow[] = [];
  wb.getWorksheet("Top 30 — Batch 1")?.eachRow((r, i) => {
    if (i === 1) return;
    const rank = cell(r, 1);
    if (rank.toLowerCase() === "ex" || /\(example/i.test(cell(r, 4))) return;
    out.push({
      rank: Number(rank) || 0, first: cell(r, 2), last: cell(r, 3),
      company: cell(r, 4), position: cell(r, 5), url: cell(r, 6),
      about: cell(r, 9), posts: cell(r, 10), pain: cell(r, 11),
      service: cell(r, 12), message: cell(r, 13),
    });
  });
  return out.sort((a, b) => a.rank - b.rank);
}

/** Template seams and tells that a draft was not really about this person.
 *  Deliberately mechanical: what a human reader judges is the writing, and
 *  these are only the failures that do not need a human to spot. */
const SEAMS = [
  /\{\{|\}\}|\[insert|\[name|\[company|<name>|<company>|lorem ipsum/i,
  // Narrow on purpose: "\bas an ai\b" alone flagged a draft that said "as an
  // AI-data platform", which is the customer's own business. A checker that
  // cries wolf on the product's best output gets ignored.
  /\bas an ai (language model|assistant|model)\b|\bi am an ai\b|\bas a language model\b/i,
  /^(hi|hello|hey)\s*[,.]?\s*$/i,
];
function messageAudit(msg: string | null, person: { first: string; company: string | null }) {
  if (!msg) return "— none";
  const words = msg.trim().split(/\s+/).length;
  const flags: string[] = [];
  if (SEAMS.some((re) => re.test(msg))) flags.push("TEMPLATE SEAM");
  if (words > 120) flags.push("long");
  if (words < 25) flags.push("thin");
  if (person.first && !msg.toLowerCase().includes(person.first.toLowerCase().split(" ")[0])) flags.push("no first name");
  if (person.company && !msg.toLowerCase().includes(person.company.toLowerCase().split(/[\s,|]/)[0])) flags.push("no employer");
  return `${words}w${flags.length ? ` · ${flags.join(", ")}` : ""}`;
}

async function liveConfig() {
  const pg = new Pool({ connectionString: process.env.DATABASE_URL_PRODUCTION ?? process.env.DATABASE_URL });
  const svc = await pg.query(
    `select s.slug, s.name, s.icp_json from service s join org o on o.id = s.org_id
     where o.name = 'toss the coin' and s.status = 'active' order by s.slug`);
  const settings = await pg.query(`select settings_json from org where name = 'toss the coin' limit 1`);
  const seat = await pg.query(
    `select a.unipile_account_id, a.display_name from channel_account a join org o on o.id = a.org_id
     where o.name = 'toss the coin' and a.status = 'operational' limit 1`);
  const enriched = await pg.query(
    `select c.first_name, c.last_name, c.position_raw, c.company_raw,
            c.about_summary, c.posts_summary, c.pain_points, c.outreach_message
     from connection c join org o on o.id = c.org_id
     where o.name = 'toss the coin' and c.enrich_status = 'done'
       and c.outreach_message is not null
     order by c.enriched_at desc nulls last`);
  await pg.end();
  return {
    services: svc.rows.map((r) => ({ slug: r.slug as string, name: r.name as string, icp: r.icp_json as IcpJson })),
    settings: (settings.rows[0]?.settings_json ?? {}) as Partial<OrgSettings>,
    seat: seat.rows[0] as { unipile_account_id: string; display_name: string } | undefined,
    enriched: enriched.rows.map((r): ToolRow => ({
      who: nameKey(r.first_name, r.last_name),
      position: r.position_raw, company: r.company_raw,
      about: r.about_summary, posts: r.posts_summary,
      pain: r.pain_points, message: r.outreach_message,
    })),
  };
}

function show(label: string, text: string | null, width = 100) {
  const body = (text ?? "—").replace(/\s+/g, " ").trim();
  console.log(`   ${label.padEnd(9)} ${body.slice(0, width)}${body.length > width ? "…" : ""}`);
}

async function wipe() {
  const rows = await db.select({ id: org.id }).from(org).where(eq(org.name, LABEL));
  for (const o of rows) {
    await db.delete(connection).where(eq(connection.orgId, o.id));
    await db.delete(connectionBatch).where(eq(connectionBatch.orgId, o.id));
    await db.delete(channelAccount).where(eq(channelAccount.orgId, o.id));
    await db.delete(service).where(eq(service.orgId, o.id));
    await db.delete(org).where(eq(org.id, o.id));
  }
}

async function main() {
  await wipe();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK);
  const humans = humanRows(wb);
  const { services, settings, seat, enriched } = await liveConfig();
  const byKey = new Map(enriched.map((r) => [r.who, r]));

  console.log(`Human standard: ${humans.length} rows from "Top 30 — Batch 1"`);
  console.log(`Tool output in production: ${enriched.length} people carry a full Stage B`);
  const sameePerson = humans.filter((h) => byKey.has(nameKey(h.first, h.last)));
  console.log(`Overlap between the two: ${sameePerson.length}`);

  // ── What the human standard looks like, measured ───────────────────────────
  console.log(`\n${"=".repeat(78)}\nTHE HUMAN STANDARD (the 30 rows the bar is set against)\n${"=".repeat(78)}`);
  const hAbout = humans.map((h) => h.about.split(/\s+/).length);
  const hMsg = humans.map((h) => h.message.split(/\s+/).length);
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  console.log(`  About summary   avg ${avg(hAbout)} words (min ${Math.min(...hAbout)}, max ${Math.max(...hAbout)})`);
  console.log(`  Outreach msg    avg ${avg(hMsg)} words (min ${Math.min(...hMsg)}, max ${Math.max(...hMsg)})`);
  console.log(`  every row names the person's employer: ${humans.every((h) => h.message.toLowerCase().includes(h.company.toLowerCase().split(/[\s,|]/)[0])) ? "yes" : "no"}`);
  for (const h of humans.slice(0, 2)) {
    console.log(`\n  human #${h.rank} — ${h.position} @ ${h.company}`);
    show("about", h.about); show("posts", h.posts); show("pain", h.pain);
    show("service", h.service); show("message", h.message, 240);
    console.log(`   audit     ${messageAudit(h.message, { first: h.first, company: h.company })}`);
  }

  // ── The same comparison against whatever the tool has produced ─────────────
  console.log(`\n${"=".repeat(78)}\nTHE TOOL'S OWN OUTPUT (production, read-only)\n${"=".repeat(78)}`);
  const sample = enriched.slice(0, 3);
  if (sample.length === 0) console.log("  Nothing enriched in production yet — run with ENRICH=N.");
  for (const t of sample) {
    console.log(`\n  tool — ${t.position ?? "?"} @ ${t.company ?? "?"}`);
    show("about", t.about); show("posts", t.posts); show("pain", t.pain);
    show("message", t.message, 240);
    console.log(`   audit     ${messageAudit(t.message, { first: t.who.split(" ")[0] ?? "", company: t.company })}`);
  }
  const audits = enriched.map((t) => messageAudit(t.message, { first: t.who.split(" ")[0] ?? "", company: t.company }));
  const seams = audits.filter((a) => a.includes("TEMPLATE SEAM")).length;
  const noEmployer = audits.filter((a) => a.includes("no employer")).length;
  const noName = audits.filter((a) => a.includes("no first name")).length;
  const words = enriched.map((t) => (t.message ?? "").trim().split(/\s+/).length);
  console.log(`\n  across all ${enriched.length} tool drafts: avg ${avg(words)} words`);
  console.log(`    template seams leaked      ${seams}`);
  console.log(`    draft never names employer ${noEmployer}`);
  console.log(`    draft never names person   ${noName}`);

  // ── Optional: the same people, both ways ───────────────────────────────────
  if (ENRICH > 0) {
    if (!seat) throw new Error("No operational seat in production — cannot fetch profiles.");
    const targets = humans.filter((h) => !byKey.has(nameKey(h.first, h.last)) && h.url).slice(0, ENRICH);
    console.log(`\n${"=".repeat(78)}\nSAME-PERSON READ — enriching ${targets.length} of the human Top 30\n${"=".repeat(78)}`);
    console.log(`  seat: ${seat.display_name} · ${GAP_MS / 1000}s between profile fetches · ${env.LLM_MODEL_DEEPDIVE}`);
    const [o] = await db.insert(org).values({ name: LABEL }).returning();
    try {
      await updateOrgSettings(o.id, settings);
      for (const s of services) {
        await db.insert(service).values({ orgId: o.id, slug: s.slug, name: s.name, icpJson: s.icp });
      }
      await db.insert(channelAccount).values({
        orgId: o.id, unipileAccountId: seat.unipile_account_id, provider: "linkedin",
        status: "operational", displayName: seat.display_name,
      });
      const [batch] = await db.insert(connectionBatch)
        .values({ orgId: o.id, source: "csv", label: LABEL, statsJson: { imported: targets.length } })
        .returning();
      const { deepEnrichOne } = await import("../src/modules/enrich/deep-dive");
      for (const [i, h] of targets.entries()) {
        const [row] = await db.insert(connection).values({
          orgId: o.id, batchId: batch.id,
          firstName: h.first, lastName: h.last,
          companyRaw: h.company, positionRaw: h.position,
          linkedinUrl: h.url || null,
          publicIdentifier: h.url?.split("/in/")[1]?.split(/[?#]/)[0]?.replace(/\/+$/, "") ?? null,
          bucket: "pitchable", serviceSlug: services[0]?.slug ?? null,
          matchConfidence: 80, rank: h.rank, tier: 1, score: 90,
        }).returning({ id: connection.id });
        if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS + Math.random() * GAP_MS));
        process.stdout.write(`\r  researching ${i + 1}/${targets.length}: ${h.first} ${h.last}          `);
        try { await deepEnrichOne(o.id, row.id); } catch (e) {
          console.log(`\n   ! ${h.first} ${h.last}: ${e instanceof Error ? e.message.slice(0, 120) : "failed"}`);
        }
      }
      process.stdout.write("\n");
      const got = await db.select().from(connection).where(eq(connection.batchId, batch.id));
      for (const h of targets) {
        const t = got.find((g) => nameKey(g.firstName, g.lastName) === nameKey(h.first, h.last));
        console.log(`\n  #${h.rank} ${h.position} @ ${h.company}`);
        console.log(`  ── human ──`);
        show("about", h.about); show("pain", h.pain); show("message", h.message, 240);
        console.log(`  ── tool ──`);
        show("about", t?.aboutSummary ?? null); show("posts", t?.postsSummary ?? null);
        show("pain", t?.painPoints ?? null); show("message", t?.outreachMessage ?? null, 240);
        console.log(`   audit     human ${messageAudit(h.message, { first: h.first, company: h.company })}   |   tool ${messageAudit(t?.outreachMessage ?? null, { first: h.first, company: h.company })}`);
        if (t?.enrichError) console.log(`   error     ${t.enrichError.slice(0, 140)}`);
      }
    } finally {
      await wipe();
      console.log(`\ncleaned up the ${LABEL} workspace`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
