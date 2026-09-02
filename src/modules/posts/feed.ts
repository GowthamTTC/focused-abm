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
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db, connection, connectionBatch, post } from "@/db";
import { HOOK_SCORE_SQL } from "@/modules/posts/judge";

/** Below this the judge writes no hook at all (prompts/post-relevance/v1.md). */
export const HOOK_MIN_RELEVANCE = 55;
/** MUST stay in lockstep with the 14 inside HOOK_SCORE_SQL (judge.ts). Two
 *  separate literals: change one alone and this pre-filter either drops rows
 *  that would have scored or admits rows that score exactly 0. */
export const HOOK_DECAY_DAYS = 14;
export const FEED_DEFAULT_ROWS = 12;
export const FEED_MAX_ROWS = 40;

/** No parameter: a bound number beside `||` makes the operator ambiguous. */
const FRESH = sql`now() - ${sql.raw(String(HOOK_DECAY_DAYS))} * interval '1 day'`;

/** The bands the judge was told to use, quoted so the screen explains a score
 *  in the same words that produced it. */
export const RELEVANCE_BANDS = [
  { min: 80, band: "80–100", sentence: "they name a problem or need one of your ICPs exists to solve" },
  { min: HOOK_MIN_RELEVANCE, band: "55–79", sentence: "they describe pressure or change in the area your ICPs work in, without naming the need" },
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
export async function hookFeed(orgId: string, opts: { batchId: string; limit?: number }) {
  const want = Math.min(Math.max(opts.limit ?? FEED_DEFAULT_ROWS, 1), FEED_MAX_ROWS);

  // Pass 1 — every post that can score, ranked WITHIN each person.
  // HOOK_SCORE_SQL renders "post"."relevance" / "post"."posted_at" — always
  // table-qualified, even nested — so it is valid ONLY here, where the bare
  // `post` table is in the FROM. Never alias the post table, and never
  // reference HOOK_SCORE_SQL from the outer select.
  const best = db.select({
    postId: post.id,
    connectionId: post.connectionId,
    // post.text is unbounded in the DB; only the model's input was capped.
    postExcerpt: sql<string>`left(${post.text}, 400)`.as("post_excerpt"),
    postUrl: post.url,
    postedAt: post.postedAt,
    relevance: post.relevance,
    category: post.category,
    hook: post.hook,
    judgedAt: post.judgedAt,
    // round(...)::int is load-bearing: the bare expression is numeric, and pg
    // hands numeric back as a JavaScript string whatever the TS annotation says.
    hookScore: sql<number>`round(${HOOK_SCORE_SQL})::int`.as("hook_score"),
    // Same clock the sort used, so the printed arithmetic reconciles exactly.
    ageDays: sql<number>`floor(extract(epoch from (now() - ${post.postedAt})) / 86400.0)::int`.as("age_days"),
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
  // filters can never change WHICH post won.
  const raw = await db.select({
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
      eq(connection.batchId, opts.batchId),   // post has NO batch_id — this join IS the scoping
      eq(connection.bucket, "pitchable"),     // a bucket can change AFTER judging
      isNull(connection.sentAt),              // already messaged is not a reason to message
      or(isNull(connection.flagVerdict), ne(connection.flagVerdict, "dropped")),
    ))
    .orderBy(desc(best.hookScore), desc(best.postedAt))
    .limit(want * 2 + 8);                     // overfetch for the collapse below

  // One human, one row. connection.linkedin_url has no unique constraint and
  // createBatchFromCsv does no dedupe, so the same person twice in one CSV is
  // two connection rows in one batch, each scanned separately (post's unique
  // key is (connection_id, provider_id)). radar/query.ts collapses the same way.
  const seen = new Set<string>();
  const rows: typeof raw = [];
  let collapsed = 0;
  for (const r of raw) {
    const key = (r.linkedinUrl || r.connectionId).toLowerCase();
    if (seen.has(key)) { collapsed += 1; continue; }
    seen.add(key);
    if (rows.length < want) rows.push(r);
  }
  return { rows, collapsed };
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
    feedPeople:     sql<number>`count(distinct ${post.connectionId}) filter (
                      where ${fresh} and ${connection.sentAt} is null
                        and (${connection.flagVerdict} is null or ${connection.flagVerdict} <> 'dropped'))::int`,
    sentWithHook:   sql<number>`count(distinct ${post.connectionId}) filter (
                      where ${fresh} and ${connection.sentAt} is not null)::int`,
    droppedWithHook: sql<number>`count(distinct ${post.connectionId}) filter (
                      where ${fresh} and ${connection.flagVerdict} = 'dropped')::int`,
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
  const ident = sql`(${connection.memberId} is not null or ${connection.publicIdentifier} is not null or ${connection.linkedinUrl} is not null)`;
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
    newestScan:   sql<string | null>`max(${connection.lastScanAt})`,
    oldestScan:   sql<string | null>`min(${connection.lastScanAt}) filter (where ${connection.lastScanAt} is not null)`,
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
    ready:        sql<number>`count(*) filter (where ${connection.enrichStatus} = 'done'
                    and ${connection.outreachMessage} is not null and ${connection.sentAt} is null
                    and (${connection.flag} is null or ${connection.flagVerdict} = 'variant'))::int`,
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
    people:  sql<number>`count(distinct ${post.connectionId})::int`,
  }).from(post)
    .innerJoin(connection, eq(connection.id, post.connectionId))
    .innerJoin(connectionBatch, eq(connectionBatch.id, connection.batchId))
    .where(and(
      eq(post.orgId, orgId), isNotNull(post.hook), gte(post.postedAt, FRESH),
      eq(connection.bucket, "pitchable"), isNull(connection.sentAt),
      ne(connection.batchId, batchId),
    ))
    .groupBy(connection.batchId, connectionBatch.label)
    .orderBy(desc(sql`count(distinct ${post.connectionId})`))
    .limit(1);
  return row ?? null;
}

/** How many of the unresearched frontier have a live reason — the number in the
 *  research picker's new option, and the population that option selects. */
export async function frontierWithHookCount(orgId: string, batchId: string) {
  const [row] = await db.select({ n: sql<number>`count(distinct ${post.connectionId})::int` })
    .from(post).innerJoin(connection, eq(connection.id, post.connectionId))
    .where(and(
      eq(post.orgId, orgId), isNotNull(post.hook),
      gte(post.relevance, HOOK_MIN_RELEVANCE), gte(post.postedAt, FRESH),
      eq(connection.batchId, batchId), eq(connection.bucket, "pitchable"),
      eq(connection.enrichStatus, "pending"),
    ));
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
      or(isNotNull(connection.memberId), isNotNull(connection.publicIdentifier), isNotNull(connection.linkedinUrl)),
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
