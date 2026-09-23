/**
 * Record the Mid-Year National Sales Meeting as a dated signal.
 *
 *   CONFIRM_PRODUCTION=1 ORG_ID=... npx tsx --env-file=.env scripts/record-nsm-event.ts
 *
 * The trigger vocabulary already counts the phrase "national sales meeting"
 * across eight posts. A count is not an event: it cannot say where the meeting
 * was, when, or who stood up at it, and those are the three things a seller of
 * presentation work needs. This writes the event once, assembled from the posts
 * themselves, with every claim attributed to the person who made it and the
 * post it came from.
 *
 * Nothing here is inferred. Where the posts do not say something — the exact
 * dates, the attendance — this says so rather than filling it in.
 */
import { eq } from "drizzle-orm";
import { db, org } from "../src/db";
import { storeSignals } from "../src/modules/pulse/news";
import type { NewsItem } from "../src/modules/pulse/types";

const KEY = "allergan aesthetics";
const NAME = "Allergan Aesthetics";

const ITEM: NewsItem = {
  kind: "news",
  sourceId: "linkedin:allergan-aesthetics-mid-year-nsm-2026",
  source: "LinkedIn · 8 employee posts",
  title: "Mid-Year National Sales Meeting, San Diego — field leaders and first-timers presented",
  url: "https://www.linkedin.com/posts/glen-curran_our-mid-year-allergan-aesthetics-an-abbvie-ugcPost-7503814448751517696-F3hQ",
  body:
    "Allergan Aesthetics held its Mid-Year National Sales Meeting in San Diego in late August 2026. "
    + "Eight US posts name it, seven of them from employees, between 2 and 16 September. The posts are "
    + "about the stage, not the content: Katie Dombrowski was \"honored and privileged to have had the "
    + "opportunity to present\"; Jessica Klein described \"what an incredible experience it was to take "
    + "the stage\"; Courtney Etheredge, Director of Portfolio Field Training Management, was \"proud and "
    + "honored to represent Allergan Aesthetics at our National Sales Meeting and share how Value Drives "
    + "Impact\"; Henly Sleight and Madison Rodriguez each describe their FIRST National Sales Meeting. "
    + "Glen Curran, SVP US Allergan Aesthetics, called it \"always a valuable opportunity to step away\". "
    + "The exact dates and the attendance are not stated in any of the posts. "
    + "Recorded from the eight LinkedIn posts themselves, which are stored against this account and can "
    + "be opened from the people list.",
  publishedAt: new Date("2026-09-02T00:00:00Z"),
};

async function main() {
  if (process.env.CONFIRM_PRODUCTION !== "1") throw new Error("needs CONFIRM_PRODUCTION=1");
  const orgId = (process.env.ORG_ID ?? "").trim();
  const [w] = await db.select().from(org).where(eq(org.id, orgId));
  if (!w) throw new Error("no such workspace");
  const stored = await storeSignals(orgId, KEY, NAME, [ITEM]);
  console.log(JSON.stringify({ workspace: w.name, stored }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
