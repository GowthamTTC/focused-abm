/**
 * Account Pulse — the shared contract. See docs/ACCOUNT-PULSE.md.
 *
 * §0 IS ENFORCED BY THESE TYPES. Nothing here carries a person: no name, no
 * connection id, no ordering of people, no drafted line. A band that wanted to
 * return one would have to change this file first, which is the point — the
 * boundary should be something you have to deliberately break, not something
 * you can drift across while adding a field.
 */

/** Two scores, never blended (§2). Press releases are positive by construction,
 *  so averaging the narrative with what employees say produces a number that
 *  moves when the PR team is busy. */
export interface Band {
  /** −100..100, or null when there was not enough to say. Null is the honest
   *  answer and callers must render it as "not enough read yet", never as 0. */
  score: number | null;
  /** How many judged items the score rests on. Printed with it, always. */
  n: number;
}

/** The floor below which a network score is suppressed entirely (§2).
 *  One bitter post from one laid-off director is not a sentiment reading. */
export const NETWORK_MIN_POSTS = 6;
export const NETWORK_MIN_PEOPLE = 3;

/** The window every band reads, matching the post feed's own decay horizon so
 *  Pulse and Today cannot disagree about what "recent" means. */
export const PULSE_WINDOW_DAYS = 30;

export interface NewsItem {
  kind: "news" | "filing" | "linkedin";
  sourceId: string;      // the canonical URL
  source: string;        // hostname
  title: string;
  url: string;
  body: string;
  publishedAt: Date | null;
}

/** A judged signal, as the panel reads it back. */
export interface SignalRow {
  id: string;
  kind: string;
  source: string | null;
  title: string | null;
  url: string | null;
  publishedAt: Date | null;
  sentiment: number | null;
  theme: string | null;
  evidence: string | null;
}

export interface NetworkBand extends Band {
  /** The coverage line's raw material. A short list here usually means most of
   *  the account has not been looked at, not that the account was quiet — and a
   *  full-looking band that does not say so is the most misleading thing this
   *  feature could ship (cf. the /social coverage line). */
  peopleAtAccount: number;
  peopleChecked: number;
  postsRead: number;
  /** Posts in this window against the account's own trailing baseline (§2).
   *  Silence is a signal but it is NOT negative sentiment, so volume is
   *  reported separately from tone and never folded into the score. */
  volume: number;
  baselineVolume: number;
  /** True when the band is switched off for this seat rather than empty for
   *  want of data — the panel must say which (§5a). */
  hidden: boolean;
}

export interface CompetitorHit {
  /** The peer's name as the signal list holds it. A competitor is a company;
   *  naming the person who mentioned it would breach §0. */
  peer: string;
  mentions: number;
  latestAt: Date | null;
  /** The sentence the match was found in.
   *
   *  "Korn Ferry (1)" with nothing behind it is exactly the black box the daily
   *  invariant forbids — the reader cannot tell a real incumbent from the word
   *  turning up in an unrelated sentence, and has no way to check. Radar's
   *  MentionHit has carried a snippet for this reason since it shipped; this
   *  band went out without one and should not have.
   *
   *  A quote from a post is the author's own words, not an identification of
   *  them, so it stays inside §0 — but keep it to the sentence, since a longer
   *  excerpt starts carrying enough context to say who wrote it. */
  snippet: string;
}

/** A trigger is a theme at a company and the offer it opens. There is
 *  deliberately no field for a person or an opening line (§0). */
export interface Trigger {
  theme: string;
  /** Slug from THIS workspace's catalog, or null when the theme is real but
   *  nothing in the catalog credibly opens on it. Null is a valid, useful
   *  answer and must not be back-filled with a catch-all. */
  serviceSlug: string | null;
  why: string;
  /** Which signals it rests on — ids into account_signal, so the panel can
   *  show its working and the user can disbelieve it. */
  evidenceIds: string[];
  confidence: number;
}

export interface AccountPulse {
  companyKey: string;
  companyName: string;
  news: SignalRow[];
  narrative: Band;
  network: NetworkBand;
  competitors: CompetitorHit[];
  triggers: Trigger[];
  refreshedAt: Date | null;
}

/** Mean of the scores that exist, ignoring nulls — with the count that survived.
 *  Shared by both bands so they cannot drift apart, and decayed the way
 *  HOOK_SCORE_SQL decays relevance: a strong signal from last week still
 *  counts, but less than the same signal from yesterday. */
export function meanSentiment(
  items: { sentiment: number | null; at: Date | null }[],
  now = Date.now(),
): Band {
  let weighted = 0, weight = 0, n = 0;
  for (const it of items) {
    if (it.sentiment === null || !Number.isFinite(it.sentiment)) continue;
    n += 1;
    // An item with no date still counts, at the floor weight — dropping it
    // would quietly bias the score toward whatever happens to be dated.
    const ageDays = it.at ? (now - it.at.getTime()) / 86400000 : PULSE_WINDOW_DAYS;
    const w = Math.max(0.1, Math.min(1, 1 - ageDays / PULSE_WINDOW_DAYS));
    weighted += it.sentiment * w;
    weight += w;
  }
  return { score: weight > 0 ? Math.round(weighted / weight) : null, n };
}
