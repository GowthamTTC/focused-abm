/**
 * The Competitors band — is somebody already selling into this account.
 *
 * For a leadership-development seat this is often worth more than the sentiment
 * score (§5b): walking into an incumbent is the kind of thing you want to know
 * before the first call rather than during it.
 *
 * A competitor is a company. Who mentioned it is a person, so it is not
 * returned and not selected (§0).
 */
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db, accountSignal, connection, post } from "@/db";
import { PULSE_WINDOW_DAYS, type CompetitorHit } from "@/modules/pulse/types";

const DAY = 86400000;

/** The NAMED FIRMS from scripts/propose-signals.ts, and only those.
 *
 *  That list also carries category words — "coaching", "leadership
 *  development", "corporate training" — which earn their place there, because
 *  it is matching COMPANY NAMES and a company called something-Coaching really
 *  is a peer. Here the same words would be matched against the text of news
 *  articles and posts, where they appear constantly and mean nothing. Left in,
 *  every account in the workspace would look contested, and a band that always
 *  says yes says nothing. */
export const DEFAULT_PEERS = [
  "FranklinCovey", "Korn Ferry", "Development Dimensions", "DDI",
  "Center for Creative Leadership", "Dale Carnegie", "Blanchard",
  "Crucial Learning", "VitalSmarts", "Wilson Learning", "BetterUp",
  "RHR International", "Hogan Assessments", "Gallup", "Mercer",
  "Heidrick", "Russell Reynolds", "Spencer Stuart", "Egon Zehnder",
];

/** RegExp-special characters in a peer name would otherwise be operators —
 *  and at least one real firm name contains a dot. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary, not substring. "Mercer" and "Gallup" are short enough to sit
 *  inside unrelated words, and a band that counts "Gallupville" as an incumbent
 *  is worse than no band. */
function mentions(text: string, peer: string): boolean {
  return new RegExp(`\\b${escapeRe(peer)}\\b`, "i").test(text);
}

export async function competitorHits(
  orgId: string,
  key: string,
  companyName: string,
  peers?: string[],
): Promise<CompetitorHit[]> {
  // undefined means "no opinion, use the defaults"; [] means the workspace
  // switched the band off. Collapsing the two would turn it back on for every
  // seat that had deliberately cleared it.
  const list = (peers ?? DEFAULT_PEERS).filter((p) => p.trim().length > 2);
  if (list.length === 0) return [];

  const since = new Date(Date.now() - PULSE_WINDOW_DAYS * DAY);
  const account = companyName.trim();

  const [signals, posts] = await Promise.all([
    // Already scoped to this account by companyKey, so the account name does
    // not have to appear in the text as well.
    db.select({ title: accountSignal.title, body: accountSignal.body, at: accountSignal.publishedAt })
      .from(accountSignal)
      .where(and(eq(accountSignal.orgId, orgId), eq(accountSignal.companyKey, key))),
    accountPosts(orgId, key, since),
  ]);

  const hits = new Map<string, { n: number; latest: Date | null }>();
  const record = (peer: string, at: Date | null) => {
    const cur = hits.get(peer) ?? { n: 0, latest: null };
    cur.n += 1;
    if (at && (!cur.latest || at > cur.latest)) cur.latest = at;
    hits.set(peer, cur);
  };

  for (const s of signals) {
    const text = `${s.title ?? ""}\n${s.body ?? ""}`;
    for (const peer of list) if (mentions(text, peer)) record(peer, s.at);
  }
  for (const p of posts) {
    // A post is not scoped to the account by construction the way a signal is,
    // so it only counts when it names both — otherwise any post mentioning a
    // peer anywhere in the network would be attributed to whichever account
    // happened to be open.
    if (account && !mentions(p.text, account)) continue;
    for (const peer of list) if (mentions(p.text, peer)) record(peer, p.at);
  }

  return [...hits.entries()]
    .map(([peer, v]) => ({ peer, mentions: v.n, latestAt: v.latest }))
    .sort((a, b) => b.mentions - a.mentions);
}

/** Posts by people at this account, in the window. Ids only leave this
 *  function as a filter; nothing about who wrote what is returned. */
async function accountPosts(orgId: string, key: string, since: Date) {
  const { companyKey } = await import("@/modules/radar/score");
  const people = await db.select({ id: connection.id, companyRaw: connection.companyRaw })
    .from(connection)
    .where(and(eq(connection.orgId, orgId), eq(connection.bucket, "pitchable")));
  const ids = people.filter((p) => companyKey(p.companyRaw) === key).map((p) => p.id);
  if (ids.length === 0) return [];
  const rows = await db.select({ text: post.text, at: post.postedAt }).from(post)
    .where(and(
      eq(post.orgId, orgId),
      inArray(post.connectionId, ids),
      isNotNull(post.postedAt),
      gte(post.postedAt, since),
    ));
  return rows;
}
