/**
 * Verification harness for ABM Intelligence — the LinkedIn side of an account
 * read, with no contacts in it.
 *
 *   UNIPILE_API_KEY= UNIPILE_DSN= npx tsx scripts/verify-intel.ts
 *
 * What it pins:
 *  - the company guard: LinkedIn's post search is a relevance engine, so a post
 *    that never names the company must not be stored and must not move a tone
 *    score that claims to be about that company;
 *  - a scan stores what it found, and a second scan of the same posts does not
 *    duplicate them (account_signal is unique on org+company+source);
 *  - the cap is a cap;
 *  - tone ignores unscored posts rather than reading them as neutral;
 *  - themes carry their own mean, not the headline's;
 *  - top posts are only ever posts the judge could quote;
 *  - these rows never leak into Account Pulse's news band or its narrative.
 *
 * Writes rows, so it refuses a non-local database, and refuses to start with
 * real Unipile keys present. It never calls the model: judging is simulated by
 * writing the verdicts the judge would write, so this costs nothing.
 */
import "./require-local-db";
import "./require-mock-provider";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, accountSignal, connectionBatch, channelAccount, org } from "../src/db";
import { mentionsCompany, scanCompanyPosts } from "../src/modules/intel/scan";
import { loadIntel } from "../src/modules/intel/query";
import { loadPulse } from "../src/modules/pulse";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}`, detail === undefined ? "" : detail); }
}

const KEY = "verify allergan aesthetics";
const NAME = "Verifyallergan Aesthetics";

async function main() {
  const [o] = await db.select().from(org).limit(1);
  if (!o) throw new Error("No org — run npm run seed first.");

  // ── the company guard, in isolation ───────────────────────────────
  check("matches the distinctive token",
    mentionsCompany("Big changes at Verifyallergan this quarter", NAME));
  check("matches the full name",
    mentionsCompany("news from Verifyallergan Aesthetics today", NAME));
  check("a post that never names the company is rejected",
    !mentionsCompany("Beautiful day for a walk in the park", NAME));
  check("a short filler word cannot carry a match",
    !mentionsCompany("the and for", "The And Co"));
  check("punctuation and case do not defeat it",
    mentionsCompany("VERIFYALLERGAN's Q3!", NAME));

  // ── a real scan through the mock provider ─────────────────────────
  const [seat] = await db.insert(channelAccount).values({
    orgId: o.id, provider: "linkedin", status: "operational",
    unipileAccountId: "mock-seat-intel",
  }).returning();

  const first = await scanCompanyPosts(o.id, KEY, NAME, { limit: 12 });
  check("the scan stored something", first.stored > 0, first);
  check("it never stored more than the cap", first.stored <= 12, first);

  const stored = await db.select().from(accountSignal)
    .where(and(eq(accountSignal.orgId, o.id), eq(accountSignal.companyKey, KEY)));
  check("every stored row is kind=linkedin",
    stored.every((r) => r.kind === "linkedin"), stored.map((r) => r.kind));
  check("every stored row names the company in its body",
    stored.every((r) => mentionsCompany(r.body ?? "", NAME)));
  check("nothing was stored unjudged-but-scored",
    stored.every((r) => r.sentiment === null), "a fresh scan must not invent scores");

  const second = await scanCompanyPosts(o.id, KEY, NAME, { limit: 12 });
  const afterSecond = await db.select({ n: sql<number>`count(*)::int` }).from(accountSignal)
    .where(and(eq(accountSignal.orgId, o.id), eq(accountSignal.companyKey, KEY)));
  check("a second scan of the same posts adds no duplicates",
    afterSecond[0].n === stored.length, { first: stored.length, now: afterSecond[0].n, second });

  // ── judging, simulated (no model call) ────────────────────────────
  const ids = stored.map((r) => r.id);
  const now = new Date();
  await db.update(accountSignal).set({
    sentiment: -60, theme: "restructuring", evidence: "layoffs are hitting the aesthetics unit",
    judgedAt: now,
  }).where(inArray(accountSignal.id, ids.slice(0, 2)));
  await db.update(accountSignal).set({
    sentiment: 40, theme: "product", evidence: "the new launch looks strong", judgedAt: now,
  }).where(inArray(accountSignal.id, ids.slice(2, 3)));
  // Read, but nothing quotable — the judge's null, not a zero.
  await db.update(accountSignal).set({
    sentiment: null, theme: "other", evidence: null, judgedAt: now,
  }).where(inArray(accountSignal.id, ids.slice(3)));

  const view = await loadIntel(o.id, KEY, NAME);
  check("tone counts only the scored posts", view.tone.n === 3, view.tone);
  check("tone is negative overall", (view.tone.score ?? 0) < 0, view.tone);
  check("unscorable posts are not read as neutral zeroes",
    view.scored === 3 && view.judged === stored.length, { scored: view.scored, judged: view.judged });

  const restructuring = view.themes.find((t) => t.theme === "restructuring");
  const product = view.themes.find((t) => t.theme === "product");
  check("themes carry their own mean, not the headline's",
    restructuring?.score === -60 && product?.score === 40, view.themes);
  check("a theme with nothing scorable reports null rather than 0",
    view.themes.find((t) => t.theme === "other")?.score === null, view.themes);

  check("top posts are only ones with a quote",
    view.top.length === 3 && view.top.every((p) => !!p.evidence), view.top.length);
  check("the strongest opinion leads",
    view.top[0].sentiment === -60, view.top.map((p) => p.sentiment));

  // ── the boundary with Account Pulse ───────────────────────────────
  const pulse = await loadPulse(o.id, KEY, NAME, true);
  check("Pulse's news band never shows these posts", pulse.news.length === 0, pulse.news.length);
  check("and they never move Pulse's narrative score",
    pulse.narrative.n === 0 && pulse.narrative.score === null, pulse.narrative);

  // ── cleanup ───────────────────────────────────────────────────────
  await db.delete(accountSignal)
    .where(and(eq(accountSignal.orgId, o.id), eq(accountSignal.companyKey, KEY)));
  await db.delete(channelAccount).where(eq(channelAccount.id, seat.id));

  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
