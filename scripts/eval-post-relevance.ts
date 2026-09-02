/**
 * Judge a fixed set of posts against a real workspace's catalog and print every
 * verdict for human review. This tests the PROMPT, not the plumbing.
 *
 * The set is deliberately mostly noise, because real feeds are. Run it against
 * two workspaces that sell different things and the same posts should score
 * differently — that is the property the whole design rests on.
 *
 * Read-only apart from the model calls (~1 call per workspace).
 *   npx tsx scripts/eval-post-relevance.ts apingel@arielgroup.com
 */
import "dotenv/config";
import { z } from "zod";
import { Pool } from "pg";
import { complete } from "../src/llm/client";
import { servicesDigest } from "../src/modules/matching/service-fit";
import type { IcpJson } from "../src/db/schema";

type Fixture = { id: string; author: string; role: string; company: string; post: string; want: string };

/** `want` is my expectation for a LEADERSHIP-DEVELOPMENT firm, used only to
 *  flag disagreements for a human to look at — never as a pass/fail gate. */
const FIXTURES: Fixture[] = [
  { id: "f01", author: "A", role: "Chief Learning Officer", company: "Global bank", want: "high",
    post: "Six months into rebuilding our leadership pipeline and the hardest part isn't the curriculum — it's getting senior leaders to actually model the behaviours we're teaching. Anyone solved this?" },
  { id: "f02", author: "B", role: "VP Talent & Organizational Development", company: "Health system", want: "high",
    post: "Our post-merger integration is going to live or die on whether two very different leadership cultures can work together. The org chart was the easy part." },
  { id: "f03", author: "C", role: "CHRO", company: "Manufacturer", want: "high",
    post: "We promoted 40 first-time managers this year and gave them a half-day of training. I don't know why we're surprised that engagement dropped in their teams." },
  { id: "f04", author: "D", role: "Chief People Officer", company: "Retailer", want: "medium",
    post: "Three rounds of restructuring in eighteen months. Keeping people steady through this is the whole job right now." },
  { id: "f05", author: "E", role: "Head of Talent", company: "Insurer", want: "congrats",
    post: "Thrilled to announce that our team has been named one of the Best Places to Work for the third year running! So proud of everyone. 🎉" },
  { id: "f06", author: "F", role: "CHRO", company: "Logistics", want: "congrats",
    post: "Huge congratulations to Priya on her promotion to VP Operations. Very well deserved!" },
  { id: "f07", author: "G", role: "Director of L&D", company: "Utility", want: "promo",
    post: "We're hiring! Two senior instructional designer roles open on my team. DM me or apply through the link." },
  { id: "f08", author: "H", role: "VP People", company: "SaaS", want: "promo",
    post: "Join us next Thursday for our webinar on the future of hybrid work — register now, spaces are limited." },
  { id: "f09", author: "I", role: "Chief People Officer", company: "Bank", want: "reshare",
    post: "Great read from our CEO on this quarter's results. 👏" },
  { id: "f10", author: "J", role: "SVP Human Resources", company: "Grocery", want: "personal",
    post: "Ran my first half marathon this weekend. Legs destroyed, spirit intact. 🏃" },
  { id: "f11", author: "K", role: "CFO", company: "Industrial", want: "low",
    post: "Freight costs are up 22% year over year and our hedging strategy is not keeping pace. Rethinking the whole logistics model for next year." },
  { id: "f12", author: "L", role: "VP Engineering", company: "Fintech", want: "medium",
    post: "The hardest part of scaling from 20 to 120 engineers wasn't hiring. It was that none of my new managers had ever managed before, and I had no idea how to teach them." },
  { id: "f13", author: "M", role: "Chief Marketing Officer", company: "Consumer brand", want: "low",
    post: "Our attribution model still can't explain half the pipeline. Boards want certainty, buyers want fewer forms. Something has to give." },
  { id: "f14", author: "N", role: "Head of Organizational Development", company: "Pharma", want: "high",
    post: "Reading through this year's engagement survey. The lowest-scoring item, by a distance: 'senior leaders communicate a clear direction.' Fourth year in a row." },
  { id: "f15", author: "O", role: "Managing Director", company: "Professional services", want: "medium",
    post: "Our partners are brilliant technically and most of them have never been taught how to hold a difficult conversation with a client. That gap costs us more than any pitch we lose." },
  { id: "f16", author: "P", role: "Executive Coach", company: "Independent practice", want: "low",
    post: "Five things I've learned coaching C-suite leaders through transitions. A thread. 1/" },
  { id: "f17", author: "Q", role: "VP HR", company: "Telecom", want: "reshare",
    post: "Repost: our new sustainability report is live." },
  { id: "f18", author: "R", role: "Chief Human Resources Officer", company: "Airline", want: "high",
    post: "Succession planning has been on my list for two years and keeps losing to whatever is on fire. We have three C-suite retirements coming in 18 months and no bench." },
  { id: "f19", author: "S", role: "Head of Communications", company: "Energy", want: "medium",
    post: "Spent the week coaching our exec team through the earnings call. Technically flawless people who freeze the moment a journalist asks something unscripted." },
  { id: "f20", author: "T", role: "Chief People Officer", company: "Media", want: "personal",
    post: "Sending love to everyone affected by the storms this week. Stay safe out there." },
];

const verdicts = z.array(z.object({
  id: z.string(), category: z.string(), relevance: z.number().int().min(0).max(100),
  hook: z.string().nullable(),
}));

async function digestFor(orgName: string) {
  const pg = new Pool({ connectionString: process.env.DATABASE_URL_PRODUCTION ?? process.env.DATABASE_URL });
  const r = await pg.query(
    `select s.slug, s.name, s.icp_json from service s join org o on o.id = s.org_id
     join app_user u on u.org_id = o.id
     where u.email = $1 and s.status = 'active' order by s.slug`, [orgName]);
  await pg.end();
  if (!r.rows.length) throw new Error(`no catalog for ${orgName}`);
  const services = r.rows.map((x) => ({ slug: x.slug, name: x.name, icp: x.icp_json as IcpJson }));
  return { digest: servicesDigest(services), names: services.map((s) => s.name) };
}

const bucket = (cat: string, rel: number) =>
  cat !== "substantive" ? cat : rel >= 80 ? "high" : rel >= 55 ? "medium" : "low";

async function judge(label: string, email: string) {
  const { digest, names } = await digestFor(email);
  console.log(`\n${"=".repeat(74)}`);
  console.log(`${label}  —  ${names.slice(0, 4).join(" · ")}${names.length > 4 ? " …" : ""}`);
  console.log("=".repeat(74));

  const out = await complete({
    stage: "classify", prompt: "post-relevance",
    vars: { posts_json: JSON.stringify(FIXTURES.map((f) => ({
      id: f.id, author: f.author, author_role: f.role, author_company: f.company, post: f.post,
    }))) },
    cachedContext: digest, schema: verdicts, maxTokens: 6000,
  });

  const byId = new Map(out.map((o) => [o.id, o]));
  let disagree = 0, hooks = 0, noiseScored = 0;
  for (const f of FIXTURES) {
    const o = byId.get(f.id);
    if (!o) { console.log(`  ${f.id}  NO VERDICT`); continue; }
    const got = bucket(o.category, o.relevance);
    const flag = got === f.want ? "  " : "≠ ";
    if (got !== f.want) disagree += 1;
    if (o.hook) hooks += 1;
    if (o.category !== "substantive" && o.relevance > 0) noiseScored += 1;
    console.log(`\n${flag}${f.id} ${String(o.relevance).padStart(3)} ${o.category.padEnd(12)} (I expected ${f.want})`);
    console.log(`     ${f.role} · ${f.company}`);
    console.log(`     "${f.post.slice(0, 90)}${f.post.length > 90 ? "…" : ""}"`);
    if (o.hook) console.log(`     HOOK: ${o.hook}`);
  }
  console.log(`\n  ${FIXTURES.length - disagree}/${FIXTURES.length} matched my expectation · ${hooks} hooks written`);
  console.log(`  non-substantive posts scoring above 0: ${noiseScored} (must be 0)`);
  return byId;
}

async function main() {
  const email = process.argv[2] ?? "apingel@arielgroup.com";
  const a = await judge("ARIEL — leadership & communication development", email);

  const other = process.argv[3];
  if (!other) return;
  const b = await judge("SECOND WORKSPACE — for comparison", other);
  console.log(`\n${"=".repeat(74)}`);
  console.log("SAME POST, DIFFERENT SELLER — the property the design rests on");
  console.log("=".repeat(74));
  for (const f of FIXTURES) {
    const x = a.get(f.id), y = b.get(f.id);
    if (!x || !y || Math.abs(x.relevance - y.relevance) < 25) continue;
    console.log(`  ${f.id}  ariel ${String(x.relevance).padStart(3)}  vs  other ${String(y.relevance).padStart(3)}   ${f.post.slice(0, 62)}…`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
