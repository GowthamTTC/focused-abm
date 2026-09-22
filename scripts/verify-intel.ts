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
import { companyAliases, voiceOf } from "../src/modules/intel/voice";
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

  // ── whose voice ───────────────────────────────────────────────────
  const CO = "Allergan Aesthetics";
  check("a headline naming the employer is inside",
    voiceOf("Camila Klein — Gerente Nacional de Vendas - Allergan Aesthetics", CO) === "employee");
  check("a shortened employer name still counts",
    voiceOf("Paolo Cuccuru — General Manager Italy and Greece - Allergan", CO) === "employee");
  check("a parent company counts when it is given as an alias",
    voiceOf("Constantine Vutsas — Sourcing Lead @ AbbVie", CO, ["AbbVie"]) === "employee");
  check("and does NOT count when it is not",
    voiceOf("Constantine Vutsas — Sourcing Lead @ AbbVie", CO) === "market");
  check("a practitioner is market",
    voiceOf("Noon Yousif — Aesthetic Doctor | DHA Licensed | Dubai", CO) === "market");
  check("a product-brand fan is market, not staff",
    voiceOf("Shaye Van Zee — Esthetician | Passionate About SkinMedica & DiamondGlow", CO) === "market");
  check("the brand's own page is the company talking",
    voiceOf("Allergan Aesthetics, an AbbVie Company", CO) === "company");
  check("a company page under a sibling name is still the company",
    voiceOf("Allergan Medical Institute", CO) === "company");
  check("a bare personal name is never guessed into the staff list",
    voiceOf("Jane Doe", CO) === "market");
  check("an empty author line is market", voiceOf(null, CO) === "market");
  // A short word from a multi-word name must not become an alias on its own:
  // "IRA Strategy" must not file every headline containing "IRA" as staff.
  // The full name still matches, which is why the first assertion is market
  // and the second is employee.
  check("a short token from a multi-word name is not an alias",
    !companyAliases("IRA Strategy").includes("ira")
    && voiceOf("Someone — Head of IRA reporting", "IRA Strategy") === "market");
  check("but the full name still matches",
    voiceOf("Someone — Lead, IRA Strategy", "IRA Strategy") === "employee");
  // The known ceiling, pinned so it cannot regress silently into a false
  // positive: LinkedIn headlines often omit the employer, and this one is a
  // real Allergan Aesthetics leader who reads as market because her headline
  // never says so. Precision is chosen over recall deliberately.
  check("a real employee whose headline omits the employer is MISSED, by design",
    voiceOf("Anna Gamal — Associate Director Human Resources", CO, ["AbbVie"]) === "market");
  check("aliases include the distinctive first word",
    companyAliases(CO).includes("allergan"));
  // The regression that shipped for ten minutes: every token became an alias,
  // so "Aesthetics" matched every clinic and conference in the industry and
  // filed strangers as staff. Only the head word is distinctive.
  check("a category word from the name is NOT an alias",
    !companyAliases(CO).includes("aesthetics"));
  check("an unrelated clinic is not filed as staff",
    voiceOf("Jane Doe — Founder, Harmony Aesthetics Clinic", CO) === "market");
  check("an unrelated conference page is not filed as the company",
    voiceOf("Re Gen. Aesthetics", CO) === "market");

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
