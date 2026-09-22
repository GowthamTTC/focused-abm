/**
 * The Network band — a score, never a feed.
 *
 * What the people you know at this account have been sounding like. It returns
 * one number and the counts behind it; it never returns a person, which is §0
 * of docs/ACCOUNT-PULSE.md and the reason the Social gate costs this seat so
 * little (§5a).
 */
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db, connection, post } from "@/db";
import { companyKey } from "@/modules/radar/score";
import {
  meanSentiment,
  NETWORK_MIN_PEOPLE,
  NETWORK_MIN_POSTS,
  PULSE_WINDOW_DAYS,
  type NetworkBand,
} from "@/modules/pulse/types";

const DAY = 86400000;

/** The in-repo test for a flag that means "they are not there any more".
 *  Copied in spirit from /alerts, which shows the same regex to the user as a
 *  job-change alert. */
const LEFT = /left|no longer|moved|changed|former|different company/i;

const EMPTY = (hidden: boolean): NetworkBand => ({
  score: null, n: 0,
  peopleAtAccount: 0, peopleChecked: 0, postsRead: 0,
  volume: 0, baselineVolume: 0,
  hidden,
});

export async function networkBand(
  orgId: string,
  key: string,
  hidden: boolean,
): Promise<NetworkBand> {
  // A seat with the band switched off pays for nothing. Returning early rather
  // than computing and discarding also means the panel cannot accidentally
  // start showing a number it was told not to.
  if (hidden) return EMPTY(true);

  // companyKey() normalises punctuation and case in a way that is awkward to
  // reproduce faithfully in SQL, and getting it subtly different here would
  // silently split one account into two. Selecting the org's pitchable people
  // and mapping in JS keeps ONE definition of what a company key is; the row
  // count is the pitchable network, which the accounts list already loads whole.
  const people = await db.select({
    id: connection.id,
    companyRaw: connection.companyRaw,
    flag: connection.flag,
    flagVerdict: connection.flagVerdict,
    lastScanAt: connection.lastScanAt,
  }).from(connection)
    .where(and(eq(connection.orgId, orgId), eq(connection.bucket, "pitchable")));

  const here = people.filter((p) => companyKey(p.companyRaw) === key);
  if (here.length === 0) return EMPTY(false);

  // THE MOST IMPORTANT LINE IN THIS FILE. company_raw is frozen at import
  // (§6), so somebody laid off in July still reads as staff — and their post is
  // reliably the most negative in the set. Without this gate the band would
  // over-report negativity hardest at exactly the restructuring accounts Pulse
  // was built for, and it would do it while looking perfectly reasonable.
  const current = here.filter((p) => p.flagVerdict !== "dropped" && !LEFT.test(p.flag ?? ""));

  const peopleAtAccount = here.length;
  const peopleChecked = current.filter((p) => p.lastScanAt !== null).length;
  if (current.length === 0) {
    return { ...EMPTY(false), peopleAtAccount, peopleChecked };
  }

  const ids = current.map((p) => p.id);
  const now = Date.now();
  const windowStart = new Date(now - PULSE_WINDOW_DAYS * DAY);
  // The window before this one, same length, so "quieter than usual" is measured
  // against the account's own habit rather than against other accounts.
  const baselineStart = new Date(now - 2 * PULSE_WINDOW_DAYS * DAY);

  const [recent, baseline] = await Promise.all([
    db.select({
      connectionId: post.connectionId,
      sentiment: post.sentiment,
      postedAt: post.postedAt,
    }).from(post)
      .where(and(
        eq(post.orgId, orgId),
        inArray(post.connectionId, ids),
        isNotNull(post.postedAt),
        gte(post.postedAt, windowStart),
      )),
    db.select({ n: sql<number>`count(*)::int` }).from(post)
      .where(and(
        eq(post.orgId, orgId),
        inArray(post.connectionId, ids),
        isNotNull(post.postedAt),
        gte(post.postedAt, baselineStart),
        lt(post.postedAt, windowStart),
      )),
  ]);

  const band = meanSentiment(
    recent.map((r) => ({ sentiment: r.sentiment, at: r.postedAt })),
    now,
  );
  const distinctPeople = new Set(recent.map((r) => r.connectionId)).size;

  // The floor. One bitter post from one person is not a sentiment reading, and
  // showing it as one is worse than showing nothing — the counts below still
  // tell the honest story, which is usually "nobody has looked yet".
  const tooThin = recent.length < NETWORK_MIN_POSTS || distinctPeople < NETWORK_MIN_PEOPLE;

  return {
    score: tooThin ? null : band.score,
    n: band.n,
    peopleAtAccount,
    peopleChecked,
    postsRead: recent.length,
    volume: recent.length,
    baselineVolume: baseline[0]?.n ?? 0,
    hidden: false,
  };
}
