/**
 * The read side of posts — everything the Today screen asks the database.
 *
 * Layers 01-03 stored posts, judged them against this workspace's own offers,
 * and scored a hook. This turns those rows into the one question the screen
 * exists to answer: who is worth messaging this morning, and what did they say.
 *
 * Two rules run through every query here:
 *
 *  1. PITCHABLE ONLY, ALWAYS JOINED. `post` carries org_id but no bucket and no
 *     batch_id, and judgePosts only ever judges pitchable people. A count taken
 *     on `post` alone therefore includes peers and off-target people whose
 *     verdicts nobody will ever write — a status line built on it can never
 *     reach zero, and a "read N posts" button would promise work it cannot do.
 *     Every helper joins `connection` and filters the bucket. judgeStats() and
 *     unjudgedCount() in judge.ts / store.ts stay org-wide and bucket-blind on
 *     purpose; they answer a different question and are not used by the screen.
 *
 *  2. THE PRE-FILTER IS THE PLAN, NOT AN OPTIMISATION. HOOK_SCORE_SQL contains
 *     now(), which is STABLE rather than IMMUTABLE, so no expression index can
 *     exist and ordering by it is always a materialise-and-sort. Restricting to
 *     `hook is not null and relevance >= 55 and posted_at >= now() - 14 days`
 *     first is lossless — the score is exactly 0 outside those bounds — and it
 *     lets the feed ride post_org_posted_idx. Measured on Postgres 16 with
 *     15,000 posts: bitmap index scan on (org_id, posted_at) → window filter →
 *     419 primary-key lookups → top-N heapsort, 3.5 ms.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db, channelAccount, connection, connectionBatch, job, post, service } from "@/db";
import { HOOK_DECAY_DAYS, HOOK_MIN_RELEVANCE, HOOK_SCORE_SQL } from "@/modules/posts/judge";
import { getDailyScanUsage } from "@/modules/posts/usage";

// Both defined in judge.ts, which owns coerce() and HOOK_SCORE_SQL too, and
// re-exported here because every screen reads them from the feed.
export { HOOK_DECAY_DAYS, HOOK_MIN_RELEVANCE };
export const FEED_DEFAULT_ROWS = 12;
export const FEED_MAX_ROWS = 40;

/** No parameter: a bound number beside `||` makes the operator ambiguous. */
const FRESH = sql`now() - ${sql.raw(String(HOOK_DECAY_DAYS))} * interval '1 day'`;

/** One human's identity. linkedin_url has no unique constraint and CSV import
 *  does no dedupe, so the same person in one file is several connection rows.
 *  Every count that says "people" has to count THIS, or the screen claims more
 *  people than exist. */
const HUMAN = sql`coalesce(lower(${connection.linkedinUrl}), ${connection.id})`;

/** One EMPLOYER's identity, for the one-card-per-company rule below.
 *
 *  Deliberately NOT named companyKey: @/modules/radar/score exports a function
 *  by that name which is the canonical account key across accounts, radar and
 *  the shortlist, and it returns the SHARED sentinel "_none" for a blank rather
 *  than null. Grouping on that sentinel is right where company-less people
 *  belong in one bucket and catastrophic here, so the two must not be confused
 *  at an import site.
 *
 *  Returns null — meaning "no account, never group this row" — for a blank
 *  company, and that null is the whole point of the function. 57% of pitchable
 *  rows carry no company_raw (a LinkedIn headline frequently names no
 *  employer), so treating "" as a key would collapse 290 unrelated people in
 *  one workspace into a single card. A missing company is an absence of
 *  information, never evidence that two people share an employer.
 *
 *  Normalised so "Salesforce", "salesforce.com" and "Salesforce, Inc." are one
 *  account rather than three: lowercase, drop a trailing .com, strip trailing
 *  legal suffixes (repeatedly — "Acme Co Ltd" sheds both), then reduce
 *  punctuation to single spaces. The suffix list is anchored at the end and
 *  requires whitespace or a comma before it, so "Costco" keeps its "co" and
 *  "Limited Run Games" keeps its "Limited". */
const LEGAL_TAIL =
  /[\s,]+(?:incorporated|inc|llc|ltd|limited|corp|corporation|company|co|gmbh|bv|nv|ag|sa|sas|plc|pty|pvt|llp|srl)\.?$/;
export function employerKey(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim().toLowerCase().replace(/\.com$/, "");
  for (let prev = ""; prev !== s; ) { prev = s; s = s.replace(LEGAL_TAIL, "").trim(); }
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  // ONE exit for every blank form — null, "", "   ", ",". An earlier draft had
  // a fast `if (!s) return null` above as well, and that second guard made the
  // feed-level check that protects against merging all company-less people
  // stop biting: null and "   " returned early and never reached this line, so
  // a mutation here passed the check it exists to fail. A one-character residue
  // is likewise not an account name.
  return s.length >= 2 ? s : null;
}

/** What the runner can actually turn into a posts request: a member id, a
 *  public identifier, or a URL it can pull an "/in/" slug out of. A row whose
 *  only identifier is some other LinkedIn URL is not scannable — the runner
 *  resolves nothing, stores nothing, and still stamps last_scan_at, so
 *  counting it as reachable spends a cap slot on a guaranteed no-op.
 *
 *  The coalesce is load-bearing: a bare LIKE against a null url yields NULL,
 *  which makes the whole OR null for a row with no identifiers at all — and
 *  `not REACHABLE` then drops that row out of the very count that exists to
 *  find it. Postgres three-valued logic, caught by the harness. */
const REACHABLE = sql`(${connection.memberId} is not null
  or ${connection.publicIdentifier} is not null
  or coalesce(${connection.linkedinUrl}, '') like '%/in/%')`;

/** The excerpt a reader actually sees.
 *
 *  One definition, because two copies drifted the moment they existed: a `\s`
 *  inside a TS template literal collapses to a bare `s`, so a second hand-typed
 *  copy trimmed a trailing "s" instead of a trailing word. Both callers cut at
 *  the same place or the same post reads differently on two screens.
 *
 *  240 rather than the full text: two clamped lines is the design, but on a wide
 *  screen far more than that fits, so THIS is the cut — trimmed back to a word
 *  boundary and marked, rather than ending someone mid-word inside quotes. */
const EXCERPT_SQL = sql`case
  when length(${post.text}) <= 240 then ${post.text}
  else regexp_replace(left(${post.text}, 240), '\\s\\S*$', '') || '…'
end`;

/** The bands the judge was told to use, quoted so the screen explains a score
 *  in the same words that produced it. */
export const RELEVANCE_BANDS = [
  { min: 80, band: "80–100", sentence: "they name a problem or need one of your ICPs exists to solve" },
  { min: 55, band: "55–79", sentence: "they describe pressure or change in the area your ICPs work in, without naming the need" },
  // The floor. Quoted from the prompt like the others: the screen must be able
  // to explain every score it is willing to show, so the lowest band's `min`
  // and HOOK_MIN_RELEVANCE are the same number by construction (checked).
  { min: HOOK_MIN_RELEVANCE, band: "25–54", sentence: "substantive about their work, adjacent to your ICPs' territory but not in it" },
] as const;

export function bandFor(relevance: number | null) {
  if (relevance == null) return null;
  return RELEVANCE_BANDS.find((b) => relevance >= b.min) ?? null;
}

// ── The feed ─────────────────────────────────────────────────────────
/** One row per person: their strongest post after the 14-day fade.
 *
 *  Ordered by decayed relevance, which deliberately disagrees with fit rank —
 *  a rank-10 person who just described the exact problem you solve outranks a
 *  rank-2 person who said something adjacent last week. Every row carries the
 *  arithmetic that placed it so the screen can show its work.
 */
export async function hookFeed(orgId: string, opts: { batchId?: string; limit?: number }) {
  const want = Math.min(Math.max(opts.limit ?? FEED_DEFAULT_ROWS, 1), FEED_MAX_ROWS);

  // Pass 1 — every post that can score, ranked WITHIN each person.
  // HOOK_SCORE_SQL renders "post"."relevance" / "post"."posted_at" — always
  // table-qualified, even nested — so it is valid ONLY here, where the bare
  // `post` table is in the FROM. Never alias the post table, and never
  // reference HOOK_SCORE_SQL from the outer select.
  const best = db.select({
    postId: post.id,
    connectionId: post.connectionId,
    postExcerpt: sql<string>`${EXCERPT_SQL}`.as("post_excerpt"),
    postUrl: post.url,
    postedAt: post.postedAt,
    relevance: post.relevance,
    category: post.category,
    hook: post.hook,
    judgedAt: post.judgedAt,
    // round(...)::int is load-bearing: the bare expression is numeric, and pg
    // hands numeric back as a JavaScript string whatever the TS annotation says.
    hookScore: sql<number>`round(${HOOK_SCORE_SQL})::int`.as("hook_score"),
    // The same clock AND the same precision the score used. Flooring it here
    // was wrong: the score decays on the exact fractional age, so a floored age
    // made the disclosure print "84 × (1 − 1 of 14 days) = 75" — an equation
    // whose two sides disagree by up to relevance/14. greatest(0, …) mirrors
    // the score's own clamp for a future-dated post.
    ageDays: sql<number>`greatest(0, round(extract(epoch from (now() - ${post.postedAt})) / 86400.0, 1))::float8`.as("age_days"),
    hooksForPerson: sql<number>`count(*) over (partition by ${post.connectionId})::int`.as("hooks_for_person"),
    rn: sql<number>`row_number() over (
      partition by ${post.connectionId}
      order by ${HOOK_SCORE_SQL} desc, ${post.postedAt} desc nulls last, ${post.id} asc)`.as("rn"),
  }).from(post)
    .where(and(
      eq(post.orgId, orgId),
      isNotNull(post.hook),                  // hook can be null even above the threshold
      gte(post.relevance, HOOK_MIN_RELEVANCE),
      gte(post.postedAt, FRESH),
    ))
    .as("best");

  // Pass 2 — attach the person. rn is per-connection, so connection-side
  // filters can never change WHICH post won. Deliberately NOT partitioned by
  // human here: the winner would then be picked before the batch, sent and
  // dropped filters run, so a person whose best post belongs to another batch
  // or a sent row would drop out of the feed entirely.
  const fetch = (take: number) => db.select({
    postId: best.postId, postExcerpt: best.postExcerpt, postUrl: best.postUrl,
    postedAt: best.postedAt, relevance: best.relevance, category: best.category,
    hook: best.hook, judgedAt: best.judgedAt, hookScore: best.hookScore,
    ageDays: best.ageDays,
    otherHooks: sql<number>`(${best.hooksForPerson} - 1)`,
    connectionId: connection.id, batchId: connection.batchId,
    firstName: connection.firstName, lastName: connection.lastName,
    role: sql<string | null>`coalesce(${connection.positionRaw}, ${connection.headlineRaw})`,
    company: connection.companyRaw,
    rank: connection.rank, tier: connection.tier, score: connection.score,
    breakdown: connection.scoreBreakdownJson, matchWhy: connection.matchWhy,
    enrichStatus: connection.enrichStatus, enrichedAt: connection.enrichedAt,
    outreachMessage: connection.outreachMessage,
    hasDraft: sql<boolean>`${connection.outreachMessage} is not null`,
    flag: connection.flag, flagVerdict: connection.flagVerdict,
    linkedinUrl: connection.linkedinUrl, activityUrl: connection.activityUrl,
    lastScanAt: connection.lastScanAt,
  }).from(best)
    .innerJoin(connection, eq(connection.id, best.connectionId))
    .where(and(
      eq(best.rn, 1),
      eq(connection.orgId, orgId),
      // post has NO batch_id, so this join IS the campaign scoping. Optional
      // because Nova is org-scoped and has no campaign to speak of; every
      // screen passes one.
      opts.batchId ? eq(connection.batchId, opts.batchId) : undefined,
      eq(connection.bucket, "pitchable"),     // a bucket can change AFTER judging
      isNull(connection.sentAt),              // already messaged is not a reason to message
      or(isNull(connection.flagVerdict), ne(connection.flagVerdict, "dropped")),
    ))
    .orderBy(desc(best.hookScore), desc(best.postedAt))
    .limit(take);

  // One human, one row. connection.linkedin_url has no unique constraint and
  // createBatchFromCsv does no dedupe, so the same person twice in one CSV is
  // two connection rows in one batch, each scanned separately (post's unique
  // key is (connection_id, provider_id)). radar/query.ts collapses the same way.
  //
  // Widen and retry rather than guess one overfetch margin: a fixed window of
  // want*2+8 returns a short page as soon as the top scorers repeat three or
  // more times, and "showing 9" when 21 people qualify is a worse answer than
  // one more indexed query. Bounded at three passes so a pathological import
  // cannot turn one screen into an unbounded scan.
  //
  // Then one ACCOUNT, one row. This app sells to companies, so three people at
  // one employer posting in the same fortnight is ONE reason to reach out, not
  // three — and three messages into one account on one morning is how that
  // account gets burned. `raw` arrives ordered by hook score, so the first
  // occurrence of a company is its strongest post and the one that survives.
  //
  // Counted separately from `collapsed` and NEVER folded into it: a duplicate
  // connection row is not a person and must come off the people count, whereas
  // a colleague IS a real person who qualified and is merely not being shown.
  // Subtracting them from the same total would under-report how many people
  // the campaign actually has.
  let rows: Awaited<ReturnType<typeof fetch>> = [];
  let collapsed = 0;
  let sameCompany = 0;
  let take = want * 2 + 8;
  for (let pass = 0; pass < 3; pass += 1) {
    const raw = await fetch(take);
    const seen = new Set<string>();
    const seenCo = new Set<string>();
    rows = []; collapsed = 0; sameCompany = 0;
    for (const r of raw) {
      const key = (r.linkedinUrl || r.connectionId).toLowerCase();
      if (seen.has(key)) { collapsed += 1; continue; }
      seen.add(key);
      const co = employerKey(r.company);
      // A null key is a row with no company: it can never match another row,
      // so company-less people are all still shown, one card each.
      if (co !== null) {
        if (seenCo.has(co)) { sameCompany += 1; continue; }
        seenCo.add(co);
      }
      if (rows.length < want) rows.push(r);
    }
    // Short only because the window ran out, not because the pool did.
    if (rows.length >= want || raw.length < take) break;
    take *= 4;
  }
  return { rows, collapsed, sameCompany };
}

export type FeedRow = Awaited<ReturnType<typeof hookFeed>>["rows"][number];

/** Where "open the post" goes: the post itself, else their activity feed, else
 *  their profile's activity tab — in that order of precision. Null when we have
 *  none of the three, because a dead anchor is worse than an absent one. */
export function deepLinkFor(r: {
  postUrl: string | null; activityUrl: string | null; linkedinUrl: string | null;
}): string | null {
  if (r.postUrl) return r.postUrl;
  if (r.activityUrl) return r.activityUrl;
  if (r.linkedinUrl) return `${r.linkedinUrl.replace(/\/+$/, "")}/recent-activity/all/`;
  return null;
}

/** What it costs to act on a row, which is what the screen groups by. */
export type RowState =
  | "readyToSend" | "needsDecision" | "notResearched" | "researchFailed"
  | "doneNoDraft" | "drafting" | "parked" | "skipped";

/** Exhaustive over enrich_status, with a fallback, because a row that matches
 *  no case would silently disappear from the screen. The `done` predicates are
 *  the sidebar badge's own tests (shell.tsx), so a row can never disagree with
 *  the count in the nav. */
export function rowState(r: {
  enrichStatus: string;
  hasDraft: boolean;
  flag: string | null;
  flagVerdict: string | null;
}): RowState {
  if (r.enrichStatus === "queued" || r.enrichStatus === "running") return "drafting";
  if (r.enrichStatus === "failed") return "researchFailed";
  if (r.enrichStatus === "skipped") return "skipped";
  if (r.enrichStatus === "done") {
    if (r.flag && !r.flagVerdict) return "needsDecision";
    if (r.flagVerdict === "verify") return "parked";
    if (r.hasDraft && (!r.flag || r.flagVerdict === "variant")) return "readyToSend";
    return "doneNoDraft";
  }
  return "notResearched";                    // 'pending', and anything added later
}

// ── The numbers under the feed ───────────────────────────────────────
/** Everything the footer line and the eleven empty states need, batch- and
 *  pitchable-scoped so every number is one a button can drive to zero. */
export async function feedStatus(orgId: string, batchId: string) {
  const fresh = sql`${post.hook} is not null and ${post.postedAt} > ${FRESH}`;
  const [row] = await db.select({
    stored:         sql<number>`count(*)::int`,
    read:           sql<number>`count(*) filter (where ${post.judgedAt} is not null)::int`,
    waiting:        sql<number>`count(*) filter (where ${post.judgedAt} is null)::int`,
    waitingPeople:  sql<number>`count(distinct ${post.connectionId}) filter (where ${post.judgedAt} is null)::int`,
    notSubstantive: sql<number>`count(*) filter (where ${post.category} is not null and ${post.category} <> 'substantive')::int`,
    adjacent:       sql<number>`count(*) filter (where ${post.category} = 'substantive' and ${post.relevance} < ${HOOK_MIN_RELEVANCE})::int`,
    hooksEver:      sql<number>`count(*) filter (where ${post.hook} is not null)::int`,
    hooksFresh:     sql<number>`count(*) filter (where ${fresh})::int`,
    // EXACTLY the feed's own connection-side predicate, so the header count can
    // never disagree with the list beneath it.
    feedPeople:     sql<number>`count(distinct ${HUMAN}) filter (
                      where ${fresh} and ${connection.sentAt} is null
                        and (${connection.flagVerdict} is null or ${connection.flagVerdict} <> 'dropped'))::int`,
    sentWithHook:   sql<number>`count(distinct ${HUMAN}) filter (
                      where ${fresh} and ${connection.sentAt} is not null)::int`,
    droppedWithHook: sql<number>`count(distinct ${HUMAN}) filter (
                      where ${fresh} and ${connection.flagVerdict} = 'dropped')::int`,
    /** Scored high enough for an opener but the judge returned none, so the
     *  "nothing cleared the bar" sentence must not claim they scored too low. */
    scoredNoHook:   sql<number>`count(*) filter (where ${post.judgedAt} is not null
                      and ${post.hook} is null and ${post.relevance} >= ${HOOK_MIN_RELEVANCE})::int`,
    // sql<Date> over a raw aggregate would be a lie: drizzle's node-postgres
    // session replaces the TIMESTAMPTZ type parser with the identity function,
    // and only real column mappers convert afterwards. Take the string, build
    // the Date here, so callers can hand these to ago() safely.
    newestHook:     sql<string | null>`max(${post.postedAt}) filter (where ${post.hook} is not null)`,
    newestPost:     sql<string | null>`max(${post.postedAt})`,
  }).from(post)
    .innerJoin(connection, eq(connection.id, post.connectionId))
    .where(and(
      eq(post.orgId, orgId),
      eq(connection.batchId, batchId),
      eq(connection.bucket, "pitchable"),
    ));
  return {
    ...row!,
    newestHookAt: row!.newestHook ? new Date(row!.newestHook) : null,
    newestPostAt: row!.newestPost ? new Date(row!.newestPost) : null,
  };
}

/** The honest number for the Read button: org-wide, because post_judge is, and
 *  pitchable-scoped, mirroring judgePosts' own WHERE. */
export async function waitingToRead(orgId: string) {
  const [row] = await db.select({
    posts:  sql<number>`count(*)::int`,
    people: sql<number>`count(distinct ${post.connectionId})::int`,
  }).from(post)
    .innerJoin(connection, eq(connection.id, post.connectionId))
    .where(and(eq(post.orgId, orgId), isNull(post.judgedAt), eq(connection.bucket, "pitchable")));
  return row!;
}

/** How much of this campaign has ever been looked at.
 *
 *  Two independent axes, and mistaking them for one partition is how a coverage
 *  line starts adding up to more than the population it describes:
 *
 *   - HOW LONG AGO: neverScanned | scannedFresh (within the decay window) |
 *     scannedStale (older). These three partition the campaign's pitchable
 *     people, and `scannedEver + neverScanned` is exactly `pitchable`.
 *   - CAN WE, AND SHOULD WE TODAY: `unreachable` has none of the three
 *     identifiers, so it can never be scanned at all; `scannable` is what the
 *     button will actually queue — reachable, and not already looked at since
 *     UTC midnight, the same boundary the daily brake uses.
 *
 *  `scannable` therefore OVERLAPS the recency buckets on purpose: someone last
 *  looked at three weeks ago is both stale and scannable. Only `unreachable` is
 *  exclusive of the scanned buckets, because those carry the identifier test —
 *  which matters because the runner stamps last_scan_at whether or not a posts
 *  id resolved, so an identifier-less person would otherwise be counted both as
 *  scanned and as unscannable.
 */
export async function scanCoverage(orgId: string, batchId: string) {
  const pitch = sql`${connection.bucket} = 'pitchable'`;
  const ident = REACHABLE;
  const utcMidnight = new Date(); utcMidnight.setUTCHours(0, 0, 0, 0);
  const [row] = await db.select({
    pitchable:    sql<number>`count(*) filter (where ${pitch})::int`,
    scannedEver:  sql<number>`count(*) filter (where ${pitch} and ${connection.lastScanAt} is not null)::int`,
    neverScanned: sql<number>`count(*) filter (where ${pitch} and ${connection.lastScanAt} is null)::int`,
    scannedFresh: sql<number>`count(*) filter (where ${pitch} and ${ident} and ${connection.lastScanAt} >= ${FRESH})::int`,
    scannedStale: sql<number>`count(*) filter (where ${pitch} and ${ident} and ${connection.lastScanAt} < ${FRESH})::int`,
    // Exactly what pickScanTargets will select, so the button's count is a
    // promise it keeps.
    scannable:    sql<number>`count(*) filter (where ${pitch} and ${ident}
                    and (${connection.lastScanAt} is null or ${connection.lastScanAt} < ${utcMidnight}))::int`,
    unreachable:  sql<number>`count(*) filter (where ${pitch} and not ${ident})::int`,
    // Filtered to pitchable like every other column here: the sentence these
    // appear in is about matched people, so a peer's timestamp has no business
    // being the "newest scan" it quotes.
    newestScan:   sql<string | null>`max(${connection.lastScanAt}) filter (where ${pitch})`,
    oldestScan:   sql<string | null>`min(${connection.lastScanAt}) filter (where ${pitch} and ${connection.lastScanAt} is not null)`,
  }).from(connection)
    .where(and(eq(connection.orgId, orgId), eq(connection.batchId, batchId)));
  return {
    ...row!,
    newestScanAt: row!.newestScan ? new Date(row!.newestScan) : null,
    oldestScanAt: row!.oldestScan ? new Date(row!.oldestScan) : null,
  };
}

/** One aggregate for every pipeline number the page prints. Replaces four
 *  reads, two of which pulled whole rows to tally them in JavaScript.
 *
 *  `ready` and `decisions` are the sidebar badge's expressions verbatim, so the
 *  page and the nav can never print different numbers for the same words. */
export async function pipelineCounts(orgId: string, batchId: string) {
  const [row] = await db.select({
    imported:     sql<number>`count(*)::int`,
    matched:      sql<number>`count(*) filter (where ${connection.bucket} = 'pitchable')::int`,
    peers:        sql<number>`count(*) filter (where ${connection.bucket} = 'peer_competitor')::int`,
    offIcp:       sql<number>`count(*) filter (where ${connection.bucket} = 'off_icp')::int`,
    excluded:     sql<number>`count(*) filter (where ${connection.bucket} = 'excluded')::int`,
    unclassified: sql<number>`count(*) filter (where ${connection.bucket} is null)::int`,
    researched:   sql<number>`count(*) filter (where ${connection.enrichStatus} = 'done')::int`,
    touched:      sql<number>`count(*) filter (where ${connection.enrichStatus} <> 'pending')::int`,
    failed:       sql<number>`count(*) filter (where ${connection.enrichStatus} = 'failed')::int`,
    messaged:     sql<number>`count(*) filter (where ${connection.sentAt} is not null)::int`,
    // The sidebar badge's expression PLUS the verdict guard it was missing: a
    // re-enrich can clear `flag` while flag_verdict stays 'dropped' or
    // 'verify', and such a row is not ready to send — the feed hides it, Review
    // omits it, and rowState() calls it parked. shell.tsx carries the same
    // guard so the page and the nav still cannot disagree.
    ready:        sql<number>`count(*) filter (where ${connection.enrichStatus} = 'done'
                    and ${connection.outreachMessage} is not null and ${connection.sentAt} is null
                    and (${connection.flag} is null or ${connection.flagVerdict} = 'variant')
                    and coalesce(${connection.flagVerdict}, '') not in ('dropped', 'verify'))::int`,
    decisions:    sql<number>`count(*) filter (where ${connection.flag} is not null
                    and ${connection.flagVerdict} is null and ${connection.enrichStatus} = 'done')::int`,
    t1Remaining:  sql<number>`count(*) filter (where ${connection.tier} = 1 and ${connection.enrichStatus} <> 'done')::int`,
    frontier:     sql<number>`count(*) filter (where ${connection.bucket} = 'pitchable' and ${connection.enrichStatus} = 'pending')::int`,
  }).from(connection)
    .where(and(eq(connection.orgId, orgId), eq(connection.batchId, batchId)));
  return row!;
}

/** How many people in run A already have a live reason — the sub-lines that
 *  turn a pipeline count into a reason to open it today. */
export async function pipelineWithHooks(orgId: string, batchId: string) {
  const fresh = and(
    isNotNull(post.hook), gte(post.relevance, HOOK_MIN_RELEVANCE), gte(post.postedAt, FRESH),
  );
  const [row] = await db.select({
    readyWithHook: sql<number>`count(distinct ${connection.id}) filter (
      where ${connection.enrichStatus} = 'done' and ${connection.outreachMessage} is not null
        and ${connection.sentAt} is null
        and (${connection.flag} is null or ${connection.flagVerdict} = 'variant'))::int`,
    decisionsWithHook: sql<number>`count(distinct ${connection.id}) filter (
      where ${connection.flag} is not null and ${connection.flagVerdict} is null
        and ${connection.enrichStatus} = 'done')::int`,
  }).from(connection)
    .innerJoin(post, and(eq(post.connectionId, connection.id), fresh))
    .where(and(eq(connection.orgId, orgId), eq(connection.batchId, batchId)));
  return row!;
}

/** The re-sync trap: a new import or sync creates NEW connection rows, and the
 *  posts we already paid for stay attached to the old ones. Only asked when the
 *  feed came back empty, so the empty state can name where the hooks went. */
export async function hooksElsewhere(orgId: string, batchId: string) {
  const [row] = await db.select({
    batchId: connection.batchId,
    label:   connectionBatch.label,
    people:  sql<number>`count(distinct ${HUMAN})::int`,
  }).from(post)
    .innerJoin(connection, eq(connection.id, post.connectionId))
    .innerJoin(connectionBatch, eq(connectionBatch.id, connection.batchId))
    .where(and(
      eq(post.orgId, orgId), isNotNull(post.hook),
      gte(post.relevance, HOOK_MIN_RELEVANCE), gte(post.postedAt, FRESH),
      eq(connection.bucket, "pitchable"), isNull(connection.sentAt),
      // Same exclusion the feed applies, or this nudge sends someone to a
      // campaign that will not show them what it promised.
      or(isNull(connection.flagVerdict), ne(connection.flagVerdict, "dropped")),
      ne(connection.batchId, batchId),
    ))
    .groupBy(connection.batchId, connectionBatch.label)
    .orderBy(desc(sql`count(distinct ${post.connectionId})`))
    .limit(1);
  return row ?? null;
}

/** How many of the unresearched frontier have a live reason — the number in the
 *  research picker's new option, and the population that option selects. */
export async function frontierWithHookCount(orgId: string, batchId: string, country = "") {
  const conds = [
    eq(post.orgId, orgId), isNotNull(post.hook),
    gte(post.relevance, HOOK_MIN_RELEVANCE), gte(post.postedAt, FRESH),
    eq(connection.batchId, batchId), eq(connection.bucket, "pitchable"),
    eq(connection.enrichStatus, "pending"),
  ];
  // The country the picker currently shows, because the number sits inside an
  // option beside that select and pickHookFrontier applies it.
  if (country) conds.push(eq(connection.country, country));
  const [row] = await db.select({ n: sql<number>`count(distinct ${HUMAN})::int` })
    .from(post).innerJoin(connection, eq(connection.id, post.connectionId))
    .where(and(...conds));
  return row?.n ?? 0;
}

// ── Who the two buttons act on ───────────────────────────────────────
/** Scan targets: never-looked-at first, then longest-since. The payload array
 *  order IS the scan order — the runner iterates it as given — so the people
 *  most likely to yield something go first, before any cap can bite.
 *
 *  Two exclusions carry their weight:
 *  - no identifier of any kind: the runner still stamps last_scan_at for them
 *    and stores nothing, burning a cap slot and then looking permanently
 *    "scanned but silent".
 *  - already scanned since UTC midnight: the brake counts distinct PEOPLE with
 *    last_scan_at past that boundary, not requests, so re-scanning today's
 *    cohort would be free against the cap and cost real LinkedIn calls.
 */
export async function pickScanTargets(orgId: string, batchId: string, n: number) {
  const utcMidnight = new Date(); utcMidnight.setUTCHours(0, 0, 0, 0);
  return db.select({ id: connection.id }).from(connection)
    .where(and(
      eq(connection.orgId, orgId), eq(connection.batchId, batchId),
      eq(connection.bucket, "pitchable"),
      REACHABLE,
      or(isNull(connection.lastScanAt), lt(connection.lastScanAt, utcMidnight)),
    ))
    .orderBy(sql`${connection.lastScanAt} asc nulls first`, asc(connection.rank))
    .limit(n);
}

/** The research picker's hook branch: the unresearched frontier that has a live
 *  reason, strongest reason first and fit rank second. An innerJoin rather than
 *  a filter, so the any/7/30 branches keep their existing single-table plan. */
export async function pickHookFrontier(orgId: string, batchId: string, n: number, country: string) {
  const freshHook = db.select({
    connectionId: post.connectionId,
    hookScore: sql<number>`max(round(${HOOK_SCORE_SQL})::int)`.as("hook_score"),
  }).from(post)
    .where(and(eq(post.orgId, orgId), isNotNull(post.hook),
      gte(post.relevance, HOOK_MIN_RELEVANCE), gte(post.postedAt, FRESH)))
    .groupBy(post.connectionId).as("fresh_hook");

  const conds = [
    eq(connection.orgId, orgId), eq(connection.batchId, batchId),
    eq(connection.bucket, "pitchable"), eq(connection.enrichStatus, "pending"),
  ];
  if (country) conds.push(eq(connection.country, country));
  return db.select({ id: connection.id }).from(connection)
    .innerJoin(freshHook, eq(freshHook.connectionId, connection.id))
    .where(and(...conds))
    .orderBy(desc(freshHook.hookScore), asc(connection.rank))
    .limit(n);
}

// ── What a press will do, decided where it can be tested ─────────────
/** The guard chain behind "Scan more people's posts".
 *
 *  It lives here rather than inside the server action because an action calls
 *  requireUser() and redirect(), neither of which exists outside a request — so
 *  a guard chain written in the action can only be verified by re-implementing
 *  it in the test, which proves nothing. The action is a thin wrapper: call
 *  this, then redirect on the reason it returns.
 */
export type ScanPlan =
  | { ok: true; ids: string[] }
  | { ok: false; reason: "noseat" | "busy" | "cap" | "none" };

export async function planScan(orgId: string, batchId: string, want: number): Promise<ScanPlan> {
  const [seat] = await db.select({ id: channelAccount.id }).from(channelAccount)
    .where(and(eq(channelAccount.orgId, orgId), eq(channelAccount.status, "operational")))
    .limit(1);
  if (!seat) return { ok: false, reason: "noseat" };
  if (await liveJob(orgId)) return { ok: false, reason: "busy" };

  const { remaining } = await getDailyScanUsage(orgId);
  if (remaining === 0) return { ok: false, reason: "cap" };

  const bounded = Math.min(Math.max(want, 1), 80, remaining);
  const targets = await pickScanTargets(orgId, batchId, bounded);
  if (targets.length === 0) return { ok: false, reason: "none" };
  return { ok: true, ids: targets.map((t) => t.id) };
}

/** The guard chain behind "Read N unread posts", same reasoning. */
export type ReadPlan =
  | { ok: true; posts: number }
  | { ok: false; reason: "nooffers" | "busy" | "none" };

export async function planRead(orgId: string): Promise<ReadPlan> {
  const [offer] = await db.select({ id: service.id }).from(service)
    .where(and(eq(service.orgId, orgId), eq(service.status, "active"))).limit(1);
  if (!offer) return { ok: false, reason: "nooffers" };
  if (await liveJob(orgId)) return { ok: false, reason: "busy" };
  const { posts } = await waitingToRead(orgId);
  if (posts === 0) return { ok: false, reason: "none" };
  return { ok: true, posts };
}

/** Any run at all, not just a competing one.
 *
 *  enqueue() is a bare INSERT with no dedupe, the worker runs ONE job at a time
 *  FIFO with no org filter, and the shell banner shows only the newest job and
 *  binds its Stop button to that — so a second enqueue does not merely wait, it
 *  hijacks the banner and re-points Stop at the wrong run.
 *
 *  'stopping' rows are ignored once stale: the worker only ever picks up
 *  'queued', so a job stopped before it started could sit in 'stopping'
 *  forever, and the only reaper needs the global queue empty before it runs. */
export async function liveJob(orgId: string) {
  const stale = new Date(Date.now() - 30 * 60_000);
  const [row] = await db.select({ id: job.id, kind: job.kind, status: job.status })
    .from(job)
    .where(and(
      eq(job.orgId, orgId),
      inArray(job.status, ["queued", "running", "stopping"]),
      or(ne(job.status, "stopping"), gte(job.updatedAt, stale)),
    ))
    .limit(1);
  return row ?? null;
}

/** The best live reason for each of a given set of people.
 *
 *  Review already loads its rows, so this is one extra indexed query over ids
 *  it holds rather than a second pass over the batch. Same threshold and same
 *  14-day fade as the feed, so a reason shown here and a reason shown on Today
 *  can never disagree about the same person.
 *
 *  Keyed by connection id, not by human: Review is showing one specific row and
 *  its draft, so collapsing duplicates would attach a reason to the wrong one.
 *  Pitchable-joined like everything else here, so a peer who somehow reached a
 *  caller's list can never be handed a reason to reach out.
 */
export async function hooksForPeople(orgId: string, connectionIds: string[]) {
  const out = new Map<string, {
    postId: string; hook: string; excerpt: string; url: string | null;
    postedAt: Date | null; relevance: number | null; hookScore: number; ageDays: number;
  }>();
  if (connectionIds.length === 0) return out;

  const best = db.select({
    connectionId: post.connectionId,
    postId: post.id,
    hook: post.hook,
    excerpt: sql<string>`${EXCERPT_SQL}`.as("excerpt"),
    url: post.url,
    postedAt: post.postedAt,
    relevance: post.relevance,
    hookScore: sql<number>`round(${HOOK_SCORE_SQL})::int`.as("hook_score"),
    ageDays: sql<number>`greatest(0, round(extract(epoch from (now() - ${post.postedAt})) / 86400.0, 1))::float8`.as("age_days"),
    rn: sql<number>`row_number() over (
      partition by ${post.connectionId}
      order by ${HOOK_SCORE_SQL} desc, ${post.postedAt} desc nulls last, ${post.id} asc)`.as("rn"),
  }).from(post)
    .innerJoin(connection, eq(connection.id, post.connectionId))
    .where(and(
      eq(post.orgId, orgId),
      eq(connection.bucket, "pitchable"),
      inArray(post.connectionId, connectionIds),
      isNotNull(post.hook),
      gte(post.relevance, HOOK_MIN_RELEVANCE),
      gte(post.postedAt, FRESH),
    ))
    .as("best");

  const rows = await db.select().from(best).where(eq(best.rn, 1));
  for (const r of rows) {
    if (!r.hook) continue;
    out.set(r.connectionId, {
      postId: r.postId, hook: r.hook, excerpt: r.excerpt, url: r.url,
      postedAt: r.postedAt, relevance: r.relevance, hookScore: r.hookScore, ageDays: r.ageDays,
    });
  }
  return out;
}

/** The workspace's reasons in one line, for callers with no campaign.
 *
 *  Nova is org-scoped: it has no CampaignSwitcher and no batch to speak of, so
 *  it cannot use feedStatus. Same rules as the feed — pitchable, above the
 *  threshold, inside the fade, not already messaged, not dropped — counted
 *  across every batch, and counted per HUMAN so a re-import does not inflate it.
 */
export async function orgReasonSummary(orgId: string) {
  const fresh = sql`${post.hook} is not null and ${post.relevance} >= ${HOOK_MIN_RELEVANCE} and ${post.postedAt} > ${FRESH}`;
  const [row] = await db.select({
    people: sql<number>`count(distinct ${HUMAN}) filter (
      where ${fresh} and ${connection.sentAt} is null
        and (${connection.flagVerdict} is null or ${connection.flagVerdict} <> 'dropped'))::int`,
    unread: sql<number>`count(*) filter (where ${post.judgedAt} is null)::int`,
    newestHook: sql<string | null>`max(${post.postedAt}) filter (where ${fresh})`,
  }).from(post)
    .innerJoin(connection, eq(connection.id, post.connectionId))
    .where(and(eq(post.orgId, orgId), eq(connection.bucket, "pitchable")));
  const [scan] = await db.select({
    newestScan: sql<string | null>`max(${connection.lastScanAt}) filter (where ${connection.bucket} = 'pitchable')`,
    everScanned: sql<number>`count(*) filter (where ${connection.bucket} = 'pitchable' and ${connection.lastScanAt} is not null)::int`,
    pitchable: sql<number>`count(*) filter (where ${connection.bucket} = 'pitchable')::int`,
  }).from(connection).where(eq(connection.orgId, orgId));
  return {
    people: row?.people ?? 0,
    unread: row?.unread ?? 0,
    newestHookAt: row?.newestHook ? new Date(row.newestHook) : null,
    newestScanAt: scan?.newestScan ? new Date(scan.newestScan) : null,
    everScanned: scan?.everScanned ?? 0,
    pitchable: scan?.pitchable ?? 0,
  };
}

/** The posts a re-read would actually re-read.
 *
 *  Scoped to pitchable people on purpose. clearVerdicts() can blank the whole
 *  workspace, but judgePosts only ever selects pitchable rows — so clearing a
 *  peer's old verdict would strand it as permanently unjudged, and the "Read N
 *  unread posts" button would then promise work no press can do. This is the
 *  set where clearing and re-reading are the same population.
 */
export async function rereadTargets(orgId: string) {
  const rows = await db.select({ id: post.id }).from(post)
    .innerJoin(connection, eq(connection.id, post.connectionId))
    .where(and(
      eq(post.orgId, orgId),
      eq(connection.bucket, "pitchable"),
      isNotNull(post.judgedAt),
    ));
  return rows.map((r) => r.id);
}

// ── The social feed ──────────────────────────────────────────────────────
/*
 * Everything below is APPEND-ONLY and touches nothing above it.
 *
 * Today answers "who is worth messaging". This answers a different question —
 * "what did the people I know just say" — and the two must not share a query.
 * Today's every gate (a hook, a relevance score, one row per person, one per
 * employer, bucket = pitchable, campaign scoping) exists to keep a SALES list
 * short. Applying any of them here would be a bug: a reshare with no hook, a
 * congratulation scoring 0, three posts by one person in a week and a
 * peer_competitor you have known for years are all things you might want to
 * reply to, and Today structurally cannot show any of them.
 *
 * So the only filters here are: your 1st-degree connections, in this
 * workspace, posted inside the chosen window.
 */

/** 1st degree, spelled the way this database actually stores it.
 *
 *  NULL means 1st. Neither the CSV import nor the LinkedIn sync ever writes
 *  network_distance (create-batch.ts sets it from neither path) — only Radar's
 *  own search stamps '2'/'3' on strangers it found. So a bare
 *  eq(networkDistance, '1') returns ZERO rows on every real workspace. Copied
 *  verbatim from radar/query.ts, which learned this the same way. */
const FIRST_DEGREE = or(isNull(connection.networkDistance), eq(connection.networkDistance, "1"));

export const SOCIAL_WINDOWS = [3, 7, 15] as const;
export const SOCIAL_DEFAULT_DAYS = 7;
export const SOCIAL_DEFAULT_ROWS = 40;
export const SOCIAL_MAX_ROWS = 120;
/** Materially below planScan's 80. The daily scan cap is ONE org-wide budget
 *  shared with Today (getDailyScanUsage counts distinct people stamped since
 *  UTC midnight, bucket-blind), so every social slot is a slot Today loses.
 *  40 leaves most of a default day to the sales scan without needing a setting
 *  or letting a social-only user deadlock. */
export const SOCIAL_SCAN_MAX_RUN = 40;

export function socialDays(raw: string | number | null | undefined): number {
  const n = Number(raw);
  return (SOCIAL_WINDOWS as readonly number[]).includes(n) ? n : SOCIAL_DEFAULT_DAYS;
}

/** Every post by a 1st-degree connection inside the window. No relevance, no
 *  hook, no bucket, no campaign — and deliberately NOT one row per person. */
export async function socialFeed(
  orgId: string,
  opts: { days: number; limit?: number },
) {
  const want = Math.min(Math.max(opts.limit ?? SOCIAL_DEFAULT_ROWS, 1), SOCIAL_MAX_ROWS);
  const since = sql`now() - ${sql.raw(String(socialDays(opts.days)))} * interval '1 day'`;

  const fetch = (take: number) => db.select({
    postId: post.id,
    providerId: post.providerId,
    excerpt: sql<string>`${EXCERPT_SQL}`.as("post_excerpt"),
    text: post.text,
    postUrl: post.url,
    postedAt: post.postedAt,
    ageDays: sql<number>`greatest(0, round(extract(epoch from (now() - ${post.postedAt})) / 86400.0, 1))::float8`.as("age_days"),
    connectionId: connection.id,
    firstName: connection.firstName,
    lastName: connection.lastName,
    role: sql<string | null>`coalesce(${connection.positionRaw}, ${connection.headlineRaw})`,
    company: connection.companyRaw,
    linkedinUrl: connection.linkedinUrl,
    activityUrl: connection.activityUrl,
    // Carried only so the card can say "you already messaged them" — never to
    // filter. A reply is still worth making after an outreach went out.
    sentAt: connection.sentAt,
    bucket: connection.bucket,
  }).from(post)
    .innerJoin(connection, eq(connection.id, post.connectionId))
    .where(and(
      eq(post.orgId, orgId),
      FIRST_DEGREE,
      isNotNull(post.postedAt),
      gte(post.postedAt, since),
    ))
    .orderBy(desc(post.postedAt))
    .limit(take);

  // Dedupe on (human, post) — NOT on human alone, which would throw away the
  // second and third things they said this week, and that is the feature. The
  // same human can be several connection rows (linkedin_url has no unique
  // constraint and CSV import does no dedupe) and post is unique per
  // (connection_id, provider_id), so one post reachable through two rows is two
  // records here. Widen-and-retry mirrors hookFeed's loop.
  let rows: Awaited<ReturnType<typeof fetch>> = [];
  let collapsed = 0;
  let take = want * 2 + 8;
  for (let pass = 0; pass < 3; pass += 1) {
    const raw = await fetch(take);
    const seen = new Set<string>();
    rows = []; collapsed = 0;
    for (const r of raw) {
      const human = (r.linkedinUrl || r.connectionId).toLowerCase();
      const key = `${human}::${r.providerId}`;
      if (seen.has(key)) { collapsed += 1; continue; }
      seen.add(key);
      if (rows.length < want) rows.push(r);
    }
    if (rows.length >= want || raw.length < take) break;
    take *= 4;
  }
  return { rows, collapsed };
}

export type SocialRow = Awaited<ReturnType<typeof socialFeed>>["rows"][number];

/** What the screen must admit about itself.
 *
 *  A page of 50 cards drawn from 6% of the network, with no line saying so, is
 *  the most misleading thing this feature could ship: it reads as "my network
 *  was quiet" when the truth is "nobody has looked at most of them". */
export async function socialCoverage(orgId: string, days: number) {
  const since = sql`now() - ${sql.raw(String(socialDays(days)))} * interval '1 day'`;
  const [row] = await db.select({
    firstDegree: sql<number>`count(distinct ${HUMAN})::int`,
    reachable: sql<number>`count(distinct ${HUMAN}) filter (where ${REACHABLE})::int`,
    everScanned: sql<number>`count(distinct ${HUMAN}) filter (where ${connection.lastScanAt} is not null)::int`,
    // The number that explains an empty screen: the dropdown filters posted_at,
    // but what actually limits the list is how many people were CHECKED lately.
    scannedInWindow: sql<number>`count(distinct ${HUMAN}) filter (where ${connection.lastScanAt} >= ${since})::int`,
    newestScan: sql<string | null>`max(${connection.lastScanAt})`,
  }).from(connection)
    .where(and(eq(connection.orgId, orgId), FIRST_DEGREE));

  const firstDegree = row?.firstDegree ?? 0;
  const d = socialDays(days);
  return {
    firstDegree,
    reachable: row?.reachable ?? 0,
    everScanned: row?.everScanned ?? 0,
    neverScanned: firstDegree - (row?.everScanned ?? 0),
    scannedInWindow: row?.scannedInWindow ?? 0,
    newestScan: row?.newestScan ? new Date(row.newestScan) : null,
    /** People a day that would have to be checked to keep THIS window honest
     *  for everyone. Printed against the cap, because at 100/day every one of
     *  3/7/15 asks for more than a day allows on a network this size. */
    scansPerDayForWindow: d > 0 ? Math.ceil(firstDegree / d) : 0,
  };
}

/** Who to check next, workspace-wide.
 *
 *  A separate picker rather than an edit to pickScanTargets, which is
 *  campaign-scoped and pitchable-only and pinned by the harness. Shares only
 *  its two non-negotiable predicates: REACHABLE, because the runner stamps
 *  last_scan_at even when nothing resolves and an identifier-less row would
 *  burn a cap slot on a guaranteed no-op; and the since-UTC-midnight test, so
 *  one person is never checked twice in a day.
 *
 *  Order: never-checked first, then longest-ago. Within the never-checked tier,
 *  pitchable people lead — they are the ones Today also wants, so a shared cap
 *  buys both screens at once — then the rest. rank is NULL for exactly the
 *  people this feed exists to reach, so it cannot be the sort key. */
export async function pickSocialTargets(orgId: string, n: number) {
  const utcMidnight = new Date(); utcMidnight.setUTCHours(0, 0, 0, 0);
  return db.select({ id: connection.id }).from(connection)
    .where(and(
      eq(connection.orgId, orgId),
      FIRST_DEGREE,
      REACHABLE,
      or(isNull(connection.lastScanAt), lt(connection.lastScanAt, utcMidnight)),
    ))
    .orderBy(
      sql`${connection.lastScanAt} asc nulls first`,
      sql`case when ${connection.bucket} = 'pitchable' then 0 else 1 end`,
      asc(connection.id),
    )
    .limit(n);
}

/** The guard chain behind "Check more connections", mirroring planScan. */
export async function planSocialScan(orgId: string, want: number): Promise<ScanPlan> {
  const [seat] = await db.select({ id: channelAccount.id }).from(channelAccount)
    .where(and(eq(channelAccount.orgId, orgId), eq(channelAccount.status, "operational")))
    .limit(1);
  if (!seat) return { ok: false, reason: "noseat" };
  if (await liveJob(orgId)) return { ok: false, reason: "busy" };

  const { remaining } = await getDailyScanUsage(orgId);
  if (remaining === 0) return { ok: false, reason: "cap" };

  // Clamped three ways. The worker re-reads the cap before every person and
  // THROWS on hitting it, failing the whole run and raising the app-wide
  // banner, so handing it more ids than the budget allows is not a nicety.
  const bounded = Math.min(Math.max(want, 1), SOCIAL_SCAN_MAX_RUN, remaining);
  const targets = await pickSocialTargets(orgId, bounded);
  if (targets.length === 0) return { ok: false, reason: "none" };
  return { ok: true, ids: targets.map((t) => t.id) };
}
