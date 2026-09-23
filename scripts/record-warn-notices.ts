/**
 * Record researched WARN filings as account signals.
 *
 *   CONFIRM_PRODUCTION=1 ORG_ID=... railway run npx tsx scripts/record-warn-notices.ts
 *
 * WARN notices are the answer to "were there layoffs" and an RSS feed cannot
 * give them: a feed carries the last few weeks, and the filing that matters
 * here is from May 2025. So the facts are written once, each with the source
 * that published it and the date it happened, and the judge scores them like
 * any other signal rather than being handed a verdict.
 *
 * Every field below is quoted or paraphrased from the cited article. Nothing is
 * inferred, and the body says where it came from so a reader can check it.
 */
import { eq } from "drizzle-orm";
import { db, org } from "../src/db";
import { storeSignals } from "../src/modules/pulse/news";
import { judgeSignals } from "../src/modules/pulse/judge";
import type { NewsItem } from "../src/modules/pulse/types";

const FILINGS: { key: string; name: string; item: NewsItem }[] = [
  {
    key: "allergan aesthetics",
    name: "Allergan Aesthetics",
    item: {
      kind: "filing",
      sourceId: "https://www.fiercepharma.com/pharma/abbvies-allergan-aesthetics-business-tightens-202-layoffs-california",
      source: "California WARN / FiercePharma",
      title: "Allergan Aesthetics to cut 202 roles in Irvine, California (WARN notice)",
      url: "https://www.fiercepharma.com/pharma/abbvies-allergan-aesthetics-business-tightens-202-layoffs-california",
      body:
        "Allergan Aesthetics filed a California WARN notice on 21 May 2025 covering 202 employees, "
        + "effective 22 July 2025. Only 19 of those worked in person at the Irvine headquarters; the rest were remote. "
        + "Affected positions included sales, data engineers and product managers across divisions. "
        + "The company described the action in its own words: \"This action reflects a reorganization to better "
        + "position Allergan Aesthetics for sustained leadership within the dynamic aesthetics industry.\" "
        + "It followed a first-quarter 2025 aesthetics sales decline of 11.7% to $1.1 billion. "
        + "Recorded from the California WARN filing as reported by FiercePharma and the Orange County Business Journal.",
      publishedAt: new Date("2025-05-21T00:00:00Z"),
    },
  },
  {
    key: "allergan eye care",
    name: "Allergan Eye Care",
    item: {
      kind: "filing",
      sourceId: "https://www.fiercepharma.com/pharma/abbvie-plots-85-summer-layoffs-tied-allergan-aesthetics-workforce-california",
      source: "California WARN / FiercePharma",
      title: "AbbVie to cut 85 roles in Irvine, California (WARN notice)",
      url: "https://www.fiercepharma.com/pharma/abbvie-plots-85-summer-layoffs-tied-allergan-aesthetics-workforce-california",
      body:
        "A California WARN notice covers 85 permanent layoffs at AbbVie's Irvine, California location, "
        + "effective 20 July. Reporting places this action within AbbVie's eye care business rather than within "
        + "the Allergan Aesthetics unit. Recorded from the California WARN filing as reported by FiercePharma.",
      publishedAt: new Date("2026-05-20T00:00:00Z"),
    },
  },
];

async function main() {
  if (process.env.CONFIRM_PRODUCTION !== "1") throw new Error("needs CONFIRM_PRODUCTION=1");
  const orgId = (process.env.ORG_ID ?? "").trim();
  const [w] = await db.select().from(org).where(eq(org.id, orgId));
  if (!w) throw new Error("no such workspace");

  const out: Record<string, unknown>[] = [];
  for (const f of FILINGS) {
    const stored = await storeSignals(orgId, f.key, f.name, [f.item]);
    const judged = await judgeSignals(orgId, f.key, { kind: "filing" });
    out.push({ key: f.key, stored, judged: judged.judged, calls: judged.calls });
  }
  console.log(JSON.stringify({ workspace: w.name, filings: out }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
