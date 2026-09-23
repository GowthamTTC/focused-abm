/**
 * Record researched Allergan Aesthetics press as account signals.
 *
 *   CONFIRM_PRODUCTION=1 ORG_ID=... railway run npx tsx scripts/record-aesthetics-press.ts
 *
 * The newsroom RSS this workspace polls carries AbbVie corporate items —
 * conference appearances, the headline earnings release — keyed to the parent.
 * Neither carries the unit's own numbers, and neither reaches back to August.
 * These two do, so they are written once with the source that published them.
 *
 * Every figure below is quoted from the cited release. Nothing is inferred, and
 * each body says where it came from so a reader can check it.
 */
import { eq } from "drizzle-orm";
import { db, org } from "../src/db";
import { storeSignals } from "../src/modules/pulse/news";
import type { NewsItem } from "../src/modules/pulse/types";

const KEY = "allergan aesthetics";
const NAME = "Allergan Aesthetics";

const PRESS: NewsItem[] = [
  {
    kind: "news",
    sourceId: "https://www.prnewswire.com/news-releases/allergan-aesthetics-refreshes-allergan-partner-privileges-to-better-support-todays-modern-aesthetics-practices-302847863.html",
    source: "Allergan Aesthetics / PR Newswire",
    title: "Allergan Aesthetics rebuilds Allergan Partner Privileges around simplicity and transparency",
    url: "https://www.prnewswire.com/news-releases/allergan-aesthetics-refreshes-allergan-partner-privileges-to-better-support-todays-modern-aesthetics-practices-302847863.html",
    body:
      "Announced 11 August 2026. The loyalty program every US practice buys through was rebuilt: "
      + "streamlined brand tiers, net pricing shown at the point of ordering, new portfolio levels by "
      + "purchasing volume, and a quarterly BOTOX Cosmetic growth rebate. Nicole Mowad-Nassar, Senior "
      + "Vice President of AbbVie and President of Global Allergan Aesthetics, in her own words: "
      + "\"Our customers told us they wanted greater simplicity, more transparency and rewards that "
      + "better reflect the way they operate.\" This is the same programme whose previous redesign "
      + "providers called too complex — the decline that reporting tied to the 202-role WARN "
      + "filing of May 2025. Every account manager and practice development manager in the US "
      + "field has to explain the new one to customers who were confused by the last one. "
      + "Recorded from the Allergan Aesthetics release carried by PR Newswire.",
    publishedAt: new Date("2026-08-11T00:00:00Z"),
  },
  {
    kind: "news",
    sourceId: "https://investors.abbvie.com/news-releases/news-release-details/abbvie-reports-second-quarter-2026-financial-results#aesthetics",
    source: "AbbVie Q2 2026 results",
    title: "Aesthetics Q2 2026: BOTOX Cosmetic up 5.2%, Juvederm down 6.0%, portfolio flat",
    url: "https://investors.abbvie.com/news-releases/news-release-details/abbvie-reports-second-quarter-2026-financial-results",
    body:
      "Reported 31 July 2026. Global aesthetics net revenues were $1.282 billion, up 0.3% reported and "
      + "down 0.9% operationally. BOTOX Cosmetic was $728 million, up 5.2% reported and 3.4% "
      + "operationally — a third consecutive quarter of growth. Juvederm was $245 million, down 6.0% "
      + "reported and 6.6% operationally. The unit is stabilising on toxin while filler keeps falling, "
      + "a year after the WARN filing that cut 202 roles. Context for a conversation rather than an "
      + "event to open on. Recorded from AbbVie's second-quarter 2026 results release.",
    publishedAt: new Date("2026-07-31T00:00:00Z"),
  },
];

async function main() {
  if (process.env.CONFIRM_PRODUCTION !== "1") throw new Error("needs CONFIRM_PRODUCTION=1");
  const orgId = (process.env.ORG_ID ?? "").trim();
  const [w] = await db.select().from(org).where(eq(org.id, orgId));
  if (!w) throw new Error("no such workspace");

  const stored = await storeSignals(orgId, KEY, NAME, PRESS);
  // The judge is imported here, not at the top: it parses model env at import
  // time, so a machine without a key cannot even load this file otherwise.
  // SKIP_JUDGE=1 stores the facts and scores nothing, which is what a local
  // preview wants.
  const judged = process.env.SKIP_JUDGE === "1"
    ? { judged: 0, calls: 0 }
    : await (await import("../src/modules/pulse/judge")).judgeSignals(orgId, KEY, { kind: "news" });
  console.log(JSON.stringify({ workspace: w.name, stored, judged: judged.judged, calls: judged.calls }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
