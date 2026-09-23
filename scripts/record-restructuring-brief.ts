/**
 * Record what a search of the open web says about the Allergan Aesthetics
 * reorganisation, as one dated signal.
 *
 *   CONFIRM_PRODUCTION=1 ORG_ID=... npx tsx --env-file=.env scripts/record-restructuring-brief.ts
 *
 * The WARN filing already says 202 roles went. What a filing cannot say is what
 * the company still expects from the people who stayed, and that is the half a
 * seller of leadership work needs: the growth target did not move when the
 * headcount did.
 *
 * Every figure is quoted from the cited source. Nothing is inferred.
 */
import { eq } from "drizzle-orm";
import { db, org } from "../src/db";
import { storeSignals } from "../src/modules/pulse/news";
import type { NewsItem } from "../src/modules/pulse/types";

const ITEM: NewsItem = {
  kind: "news",
  sourceId: "web:allergan-aesthetics-reorganisation-brief",
  source: "FiercePharma · AbbVie investor releases",
  title: "The reorganisation, and the target it did not change",
  url: "https://www.fiercepharma.com/pharma/abbvies-allergan-aesthetics-business-tightens-202-layoffs-california",
  body:
    "AbbVie described the 2025 action in its own words as \"a reorganization to better position "
    + "Allergan Aesthetics for sustained leadership within the dynamic aesthetics industry\" — 202 roles, "
    + "WARN filed 21 May 2025, effective 22 July 2025, only 19 of them on site at Irvine. Reporting tied "
    + "the decline behind it to a loyalty programme redesign providers called too complex, which the "
    + "company then reverted. What did NOT move is the expectation: on 31 January 2025 AbbVie guided to a "
    + "high single-digit compound annual revenue growth rate for aesthetics through 2029, with 2025 as the "
    + "base year, and has not withdrawn it. Against that target the unit delivered $5.176 billion in 2024 "
    + "(down 2.2%), fell 11.7% in Q1 2025, and in Q2 2026 was $1.282 billion — up 0.3% reported, down 0.9% "
    + "operationally, with BOTOX Cosmetic growing 5.2% and Juvederm falling 6.0%. A smaller organisation "
    + "under an unchanged growth target, a year after the cut and a year into a new president. "
    + "Recorded from FiercePharma's reporting of the California WARN filing and AbbVie's own results "
    + "releases; a fresh web search on 23 September 2026 found no newer restructuring announcement.",
  publishedAt: new Date("2026-09-23T00:00:00Z"),
};

async function main() {
  if (process.env.CONFIRM_PRODUCTION !== "1") throw new Error("needs CONFIRM_PRODUCTION=1");
  const orgId = (process.env.ORG_ID ?? "").trim();
  const [w] = await db.select().from(org).where(eq(org.id, orgId));
  if (!w) throw new Error("no such workspace");
  const stored = await storeSignals(orgId, "allergan aesthetics", "Allergan Aesthetics", [ITEM]);
  console.log(JSON.stringify({ workspace: w.name, stored }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
