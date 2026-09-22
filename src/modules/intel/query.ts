/**
 * The read side of ABM Intelligence. Cheap, request-path safe: it touches
 * neither LinkedIn nor the model, and every number it returns was written by a
 * scan that already happened.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, accountSignal, job } from "@/db";
import { meanSentiment, type Band, type SignalRow } from "@/modules/pulse/types";

/** How many posts the panel quotes back. Enough to read the room, few enough
 *  that each one has to have earned its place. */
export const TOP_POSTS = 8;

export interface ThemeRow {
  theme: string;
  n: number;
  /** Mean sentiment within the theme, or null when nothing in it was scorable. */
  score: number | null;
}

export interface IntelView {
  companyKey: string;
  companyName: string;
  /** The headline number: tone across every scorable post, age-decayed. */
  tone: Band;
  /** Everything stored for this company, newest first. */
  posts: SignalRow[];
  /** The posts worth reading — strongest opinions, each carrying its quote. */
  top: SignalRow[];
  themes: ThemeRow[];
  stored: number;
  judged: number;
  scored: number;
  scannedAt: Date | null;
}

export async function loadIntel(
  orgId: string,
  companyKey: string,
  companyName: string,
): Promise<IntelView> {
  const [posts, lastRun] = await Promise.all([
    db.select({
      id: accountSignal.id,
      kind: accountSignal.kind,
      source: accountSignal.source,
      title: accountSignal.title,
      url: accountSignal.url,
      publishedAt: accountSignal.publishedAt,
      sentiment: accountSignal.sentiment,
      theme: accountSignal.theme,
      evidence: accountSignal.evidence,
      judgedAt: accountSignal.judgedAt,
      body: accountSignal.body,
    }).from(accountSignal).where(and(
      eq(accountSignal.orgId, orgId),
      eq(accountSignal.companyKey, companyKey),
      eq(accountSignal.kind, "linkedin"),
    )).orderBy(desc(accountSignal.publishedAt)).limit(200),
    latestScan(orgId, companyKey),
  ]);

  const tone = meanSentiment(posts.map((p) => ({ sentiment: p.sentiment, at: p.publishedAt })));

  // Themes carry their own mean rather than inheriting the headline. "Everyone
  // is talking about restructuring, and that part is where the negativity is"
  // is the sentence this feature exists to support, and one shared number
  // cannot say it.
  const byTheme = new Map<string, { sentiment: number | null; at: Date | null }[]>();
  for (const p of posts) {
    if (!p.theme) continue;
    const list = byTheme.get(p.theme) ?? [];
    list.push({ sentiment: p.sentiment, at: p.publishedAt });
    byTheme.set(p.theme, list);
  }
  const themes: ThemeRow[] = [...byTheme.entries()]
    .map(([theme, rows]) => {
      const band = meanSentiment(rows);
      return { theme, n: rows.length, score: band.score };
    })
    .sort((a, b) => b.n - a.n || a.theme.localeCompare(b.theme));

  // Only posts the judge could quote. A "top post" with no evidence behind it
  // is the black box the rest of this product refuses to be, and the strongest
  // opinions are the ones a human actually wants to read first.
  const top = posts
    .filter((p) => p.sentiment !== null && p.evidence)
    .sort((a, b) =>
      Math.abs(b.sentiment ?? 0) - Math.abs(a.sentiment ?? 0)
      || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .slice(0, TOP_POSTS);

  return {
    companyKey,
    companyName,
    tone,
    posts,
    top,
    themes,
    stored: posts.length,
    judged: posts.filter((p) => p.judgedAt !== null).length,
    scored: posts.filter((p) => p.sentiment !== null).length,
    scannedAt: lastRun,
  };
}

async function latestScan(orgId: string, companyKey: string): Promise<Date | null> {
  const [row] = await db.select({ at: job.updatedAt }).from(job).where(and(
    eq(job.orgId, orgId),
    eq(job.kind, "intel_scan"),
    eq(job.status, "done"),
    sql`${job.payloadJson}->>'companyKey' = ${companyKey}`,
  )).orderBy(desc(job.updatedAt)).limit(1);
  return row?.at ?? null;
}

/** Companies this workspace has already scanned, for the picker. */
export async function scannedCompanies(
  orgId: string,
): Promise<{ key: string; name: string; n: number }[]> {
  const rows = await db.select({
    key: accountSignal.companyKey,
    name: accountSignal.companyName,
    n: sql<number>`count(*)::int`,
  }).from(accountSignal).where(and(
    eq(accountSignal.orgId, orgId),
    eq(accountSignal.kind, "linkedin"),
  )).groupBy(accountSignal.companyKey, accountSignal.companyName);
  return rows.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}
