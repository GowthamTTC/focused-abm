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
  // Insights Learning & Development, by its full name and its product. Bare
  // "Insights" is a word people write constantly and would make every account
  // look contested — the same trap the note above describes.
  "Insights Learning", "Insights Discovery", "Insights Live",
  "Hemsley Fraser", "Duke Corporate Education", "Harvard Business Publishing",
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

/** The sentence the peer name sits in, collapsed and trimmed.
 *
 *  Deliberately the sentence rather than radar's flat 180 characters from the
 *  start of the post: that band quotes the whole opening, which here would
 *  often be about something else entirely and would not show the match. */
function sentenceAround(text: string, peer: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const re = new RegExp(`[^.!?]*\\b${escapeRe(peer)}\\b[^.!?]*`, "i");
  const m = flat.match(re);
  const out = (m?.[0] ?? flat).trim();
  return out.length > 200 ? `${out.slice(0, 197)}…` : out;
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
  // companyName is kept in the signature for the caller's convenience and for
  // future sources that are not already scoped by key; neither source below
  // needs it, because both are scoped by companyKey before they get here.
  void companyName;

  const [signals, posts] = await Promise.all([
    // Already scoped to this account by companyKey, so the account name does
    // not have to appear in the text as well.
    db.select({ title: accountSignal.title, body: accountSignal.body, at: accountSignal.publishedAt })
      .from(accountSignal)
      .where(and(eq(accountSignal.orgId, orgId), eq(accountSignal.companyKey, key))),
    accountPosts(orgId, key, since),
  ]);

  const hits = new Map<string, { n: number; latest: Date | null; snippet: string }>();
  const record = (peer: string, at: Date | null, text: string) => {
    const cur = hits.get(peer) ?? { n: 0, latest: null, snippet: "" };
    cur.n += 1;
    // Keep the NEWEST hit's snippet, matching how radar/mentions.ts picks its
    // best hit: the current evidence is what a reader wants to see, not the
    // first thing ever found.
    if (!cur.snippet || (at && (!cur.latest || at > cur.latest))) cur.snippet = sentenceAround(text, peer);
    if (at && (!cur.latest || at > cur.latest)) cur.latest = at;
    hits.set(peer, cur);
  };

  for (const s of signals) {
    const text = `${s.title ?? ""}\n${s.body ?? ""}`;
    for (const peer of list) if (mentions(text, peer)) record(peer, s.at, text);
  }
  for (const p of posts) {
    // No test that the post names the employer. It was there at first, and it
    // made the band almost never fire: accountPosts has already restricted
    // these to people whose company_raw maps to this account, so the post is
    // scoped by WHO WROTE IT, and people do not name their own employer when
    // they talk about their week. Requiring it meant an incumbent could run a
    // session with the leadership team, someone could post about it, and the
    // band would still read "none".
    for (const peer of list) if (mentions(p.text, peer)) record(peer, p.at, p.text);
  }

  return [...hits.entries()]
    .map(([peer, v]) => ({ peer, mentions: v.n, latestAt: v.latest, snippet: v.snippet }))
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
