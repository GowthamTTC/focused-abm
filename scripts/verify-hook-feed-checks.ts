/**
 * The checks. Builds the labelled fixture, then holds every helper the Today
 * screen depends on to the answers the fixture already knows.
 *
 *   EVENT_EXTENDED_CAP=2 UNIPILE_API_KEY= UNIPILE_DSN= \
 *     ACTIVITY_SCAN_MIN_GAP_SECONDS=1 EVENT_SCAN_MIN_GAP_SECONDS=0 \
 *     npx tsx scripts/verify-hook-feed-checks.ts
 *
 * EVENT_EXTENDED_CAP=2 is pinned because the Radar section drives the real
 * search against the mock, whose post search yields 80 hits; the first two are
 * one 2nd-degree and one 3rd-degree person, which is exactly what those checks
 * need and all they should pay for. env.ts reads it at import time, so it has
 * to be in the environment.
 *
 * Blanking the Unipile pair is not optional on a machine that has real keys
 * in .env: this suite runs jobs, and the provider is chosen from those two
 * variables. require-mock-provider refuses to start otherwise. Node 22.
 *
 * Two facts this script encodes rather than assumes:
 *
 *  - resolveBatch picks the NEWEST batch, and the fixture inserts the "older"
 *    batch second, so the campaign switcher's default for workspace A is
 *    l4batchA2. Every check passes a batch id explicitly.
 *  - The fixture's member_id is "mock:<key>", which the mock provider parses to
 *    i = 0 and answers with no posts at all. The scan checks therefore insert
 *    their own target with member_id "mock-4", and check 61 asserts both
 *    behaviours so the next reader does not have to rediscover this.
 *
 * Anything time-dependent (who counts as "scanned today") is derived from the
 * same clock the code uses, never hardcoded — a suite that only passes before
 * lunch is not a suite.
 */
import "./require-local-db";
import "./require-mock-provider";
import { and, eq, gte, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { db, connection, channelAccount, connectionBatch, job, org, post, service } from "../src/db";
import { buildFixture } from "./verify-hook-feed";
import { novaHidden, socialHidden } from "../src/lib/feature-access";
import { DEAD_AFTER_SECONDS, sweepDeadJobs } from "../src/jobs/reap";
import { HOOK_DECAY_DAYS, HOOK_MIN_RELEVANCE, coerce } from "../src/modules/posts/judge";
import { markStopped } from "../src/jobs/runner";
import {
  RELEVANCE_BANDS, bandFor, employerKey, deepLinkFor,
  pickSocialTargets, socialCoverage, socialDays, socialFeed, feedStatus, frontierWithHookCount, hookFeed, hooksElsewhere,
  hooksForPeople, rereadTargets,
  liveJob, pickHookFrontier, pickScanTargets, pipelineCounts, pipelineWithHooks,
  planRead, planScan, rowState, scanCoverage, waitingToRead, type RowState,
} from "../src/modules/posts/feed";
import { getDailyScanUsage } from "../src/modules/posts/usage";
import { clearVerdicts, judgeStats } from "../src/modules/posts/judge";
import { getChannelProvider } from "../src/providers/channel";
import { processNext, enqueue } from "../src/jobs/runner";
import { updateOrgSettings } from "../src/modules/settings/org-settings";
import { classifyIntent } from "../src/modules/agent/intent";
import { classifyBatch } from "../src/modules/matching/service-fit";
import { runEventExtended } from "../src/modules/radar/extended";
import { runEventScan } from "../src/modules/radar/scan";
import { buildRadarCsv } from "../src/modules/radar/export";
import { splitHeadline } from "../src/modules/connections/import-csv";
import { parseExcludedCompanies, isExcludedCompany } from "../src/modules/radar/mentions";
import { loadRadar } from "../src/modules/radar/query";
import { resolveBatch } from "../src/components/dash-bits";
import { runTool } from "../src/modules/agent/tools";

let passed = 0;
const failures: string[] = [];
let n = 0;

function check(label: string, ok: boolean, detail?: string) {
  n += 1;
  if (ok) { passed += 1; console.log(`ok   ${String(n).padStart(2)} · ${label}`); }
  else { failures.push(`${n} · ${label}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL ${String(n).padStart(2)} · ${label}${detail ? ` — ${detail}` : ""}`); }
}
function eqCheck(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(label, a === e, a === e ? undefined : `expected ${e}, got ${a}`);
}

const utcMidnight = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

/** Every row NOT belonging to the fixture, counted. The last check compares
 *  this before and after, so "touches no other workspace" is a measurement
 *  rather than a claim. */
async function foreignCensus() {
  const [row] = await db.select({
    orgs: sql<number>`(select count(*) from org where id not like 'l4org%')::int`,
    connections: sql<number>`(select count(*) from connection where org_id not like 'l4org%')::int`,
    posts: sql<number>`(select count(*) from post where org_id not like 'l4org%')::int`,
    jobs: sql<number>`(select count(*) from job where org_id not like 'l4org%')::int`,
    seats: sql<number>`(select count(*) from channel_account where org_id not like 'l4org%')::int`,
    services: sql<number>`(select count(*) from service where org_id not like 'l4org%')::int`,
  }).from(org).limit(1);
  return row!;
}

async function main() {
  const before = await foreignCensus();
  const fx = await buildFixture();
  const { orgA, orgB, batchA, batchA2, batchB, people, posts } = fx;
  const names = (rows: { firstName: string }[]) => rows.map((r) => r.firstName);

  // ── A · the feed itself ──
  const feed = await hookFeed(orgA, { batchId: batchA, limit: 12 });
  const rows = feed.rows;
  eqCheck("feed returns one row per actionable person", rows.length, 4);
  // Sneha is last and only just on: 88 × (1 − 20/30) = 29. Under the old
  // fortnight she was invisible; a 30-day window is what puts her here.
  eqCheck("feed order is decayed relevance, not rank", names(rows), ["Asha", "Manoj", "Rahul", "Sneha"]);
  eqCheck("hook scores in feed order", rows.map((r) => r.hookScore), [80, 74, 71, 29]);

  const asha = rows.find((r) => r.connectionId === people.three_posts)!;
  const [ashaWinner] = await db.select({ providerId: post.providerId }).from(post).where(eq(post.id, asha.postId));
  eqCheck("decay beats raw relevance: the fresher 84 wins over the older 92",
    ashaWinner?.providerId, "fixture:asha_fresh");
  eqCheck("three good posts, one row", rows.filter((r) => r.connectionId === people.three_posts).length, 1);
  check("otherHooks is a number, and counts her second live post",
    asha.otherHooks === 1 && typeof asha.otherHooks === "number", `got ${JSON.stringify(asha.otherHooks)} (${typeof asha.otherHooks})`);

  const manoj = rows.find((r) => r.connectionId === people.flagged)!;
  const rahul = rows.find((r) => r.connectionId === people.drafted)!;
  check("the feed disagrees with fit rank", (manoj.rank ?? 0) > (rahul.rank ?? 0)
    && rows.indexOf(manoj) < rows.indexOf(rahul), `manoj rank ${manoj.rank} at ${rows.indexOf(manoj)}, rahul rank ${rahul.rank} at ${rows.indexOf(rahul)}`);
  check("hookScore is a JS number, not pg numeric-as-string",
    rows.every((r) => typeof r.hookScore === "number"), JSON.stringify(rows.map((r) => typeof r.hookScore)));
  // The disclosure prints this multiplication, so it has to be EXACT, not
  // close: a floored age made it disagree by up to relevance/HOOK_DECAY_DAYS.
  check("the printed arithmetic is the arithmetic that ran",
    asha.ageDays === 1.5
    && rows.every((r) => Math.round(r.relevance! * (1 - r.ageDays / HOOK_DECAY_DAYS)) === r.hookScore),
    `asha.ageDays=${asha.ageDays}, ${rows.map((r) => `${r.relevance}×(1-${r.ageDays}/${HOOK_DECAY_DAYS})=${Math.round(r.relevance! * (1 - r.ageDays / HOOK_DECAY_DAYS))} vs ${r.hookScore}`).join(" · ")}`);
  check("a fractional age survives to the screen",
    rows.some((r) => !Number.isInteger(r.ageDays)), rows.map((r) => r.ageDays).join(","));
  check("postedAt / judgedAt / lastScanAt come back as Dates",
    rows.every((r) => r.postedAt instanceof Date && r.judgedAt instanceof Date && r.lastScanAt instanceof Date));
  const [ashaFull] = await db.select({ text: post.text }).from(post).where(eq(post.id, asha.postId));
  check("the excerpt is a word-boundary cut of the real post, marked as cut",
    ashaFull!.text.length > 500
    && asha.postExcerpt.length <= 241
    && asha.postExcerpt.endsWith("…")
    && ashaFull!.text.startsWith(asha.postExcerpt.slice(0, -1))
    && !asha.postExcerpt.slice(0, -1).endsWith(" "),
    `full=${ashaFull!.text.length} excerpt=${asha.postExcerpt.length} tail=${JSON.stringify(asha.postExcerpt.slice(-24))}`);
  check("a short post is not touched",
    rows.every((r) => r.postExcerpt.endsWith("…") || r.postExcerpt.length < 240));
  check("every row carries a hook", rows.every((r) => Boolean(r.hook && r.hook.trim())));

  // ── B · negative checks ──
  const ids = rows.map((r) => r.connectionId);
  check("a peer's relevance-95 post is never offered", !ids.includes(people.peer));
  check("an off-target person's relevance-90 post is never offered", !ids.includes(people.off_icp));
  const st = await feedStatus(orgA, batchA);
  check("unjudged posts are absent from the feed and counted as waiting",
    !ids.includes(people.unjudged) && st.waiting === 2 && st.waitingPeople === 1,
    `waiting=${st.waiting} waitingPeople=${st.waitingPeople}`);
  check("a substantive post below the bar is not a reason", !ids.includes(people.weak));
  const [staleScore] = await db.select({ s: sql<string>`round(case
      when relevance is null or relevance < ${HOOK_MIN_RELEVANCE} or posted_at is null then 0
      else relevance * greatest(0, 1 - (extract(epoch from (now() - posted_at)) / (${HOOK_DECAY_DAYS} * 86400.0))) end, 2)::text` })
    .from(post).where(eq(post.id, posts.stale_hook));
  const sneha = rows.find((r) => r.connectionId === people.stale);
  check("a 40-day-old hook has decayed to nothing",
    Number(staleScore?.s) === 0 && sneha?.postId !== posts.stale_hook,
    `score ${staleScore?.s} shown=${sneha?.postId === posts.decay_edge ? "the 20-day post" : sneha?.postId}`);
  // Sneha also has a 20-day hook. It sits INSIDE the 30-day window and outside
  // the 14-day one this screen used to have, so it is the row that notices if
  // HOOK_DECAY_DAYS moves. The ages stay literal on purpose: deriving them from
  // the constant would make the fixture follow the change instead of objecting
  // to it, which is the whole job of this row.
  const [edge] = await db.select({ id: post.id }).from(post).where(eq(post.id, posts.decay_edge));
  check("the decay window is 30 days, not merely 'some window'",
    Boolean(edge) && ids.includes(people.stale) && sneha?.postId === posts.decay_edge
    && st.hooksFresh === 6 && st.hooksEver === 7,
    `hooksFresh=${st.hooksFresh} hooksEver=${st.hooksEver} shown=${sneha?.postId}`);
  check("someone already messaged is not a reason to message", !ids.includes(people.sent) && st.sentWithHook === 1);

  // Providers really do hand back timestamps in the future — timezone skew, or
  // a scheduled post. Without the least(1, …) clamp the decay factor exceeds 1
  // and a mediocre post outranks a strong one from yesterday. Inserted here
  // rather than in the fixture so no other expectation has to move.
  const [futurePost] = await db.insert(post).values({
    orgId: orgA, connectionId: people.weak, providerId: "fixture:from_the_future",
    text: "Dated three days ahead of now.", url: "https://example.invalid/future",
    postedAt: new Date(Date.now() + 3 * 86400_000),
    relevance: 60, category: "substantive", hook: "A post dated in the future.",
    judgedAt: new Date(),
  }).returning({ id: post.id });
  const [futureScore] = await db.select({
    s: sql<number>`round(case
      when relevance is null or relevance < ${HOOK_MIN_RELEVANCE} or posted_at is null then 0
      else relevance * greatest(0, least(1, 1 - (extract(epoch from (now() - posted_at)) / (${HOOK_DECAY_DAYS} * 86400.0)))) end)::int`,
  }).from(post).where(eq(post.id, futurePost!.id));
  const futureFeed = await hookFeed(orgA, { batchId: batchA, limit: 12 });
  const futureRow = futureFeed.rows.find((r) => r.connectionId === people.weak);
  check("a future-dated post cannot score above its own relevance",
    futureScore!.s === 60 && futureRow?.hookScore === 60 && futureRow?.ageDays === 0,
    `raw=${futureScore!.s} feed=${futureRow?.hookScore} age=${futureRow?.ageDays}`);
  check("and it does not jump the queue",
    futureFeed.rows[0]?.connectionId === people.three_posts,
    `head=${futureFeed.rows[0]?.firstName}`);
  await db.delete(post).where(eq(post.id, futurePost!.id));

  // THE BAND THIS WHOLE CHANGE EXISTS TO ADMIT. Nothing in the fixture scores
  // between 25 and 54, so before this the score floor inside HOOK_SCORE_SQL
  // could be reverted to 55 and every check still passed — the admitted post
  // would simply have scored 0 and nobody would have noticed. Inserted and
  // removed here, like the future-dated one, so no other expectation moves.
  const [adjacentPost] = await db.insert(post).values({
    orgId: orgA, connectionId: people.weak, providerId: "fixture:adjacent_band",
    text: "Rebuilding how we report on the funnel this quarter.",
    url: "https://example.invalid/adjacent",
    postedAt: new Date(Date.now() - 3 * 86400_000),
    relevance: 40, category: "substantive",
    hook: "They are rebuilding funnel reporting this quarter.", judgedAt: new Date(),
  }).returning({ id: post.id });
  const adjFeed = await hookFeed(orgA, { batchId: batchA, limit: 12 });
  const adjRow = adjFeed.rows.find((r) => r.connectionId === people.weak);
  check("a 25-54 post is shown, and scores rather than flatlining at zero",
    adjRow?.hookScore === Math.round(40 * (1 - 3 / HOOK_DECAY_DAYS)),
    `score=${adjRow?.hookScore} expected=${Math.round(40 * (1 - 3 / HOOK_DECAY_DAYS))}`);
  check("…and the screen can explain the score it just showed",
    bandFor(adjRow?.relevance ?? 0)?.band === "25–54",
    `band=${JSON.stringify(bandFor(adjRow?.relevance ?? 0))}`);
  await db.delete(post).where(eq(post.id, adjacentPost!.id));

  const cov = await scanCoverage(orgA, batchA);
  check("someone never scanned is absent and counted", !ids.includes(people.never_scanned) && cov.neverScanned === 1);
  check("the strongest hook in the workspace stays in its own campaign", !ids.includes(people.other_batch));
  check("another workspace's perfect hook is invisible here", !ids.includes(people.other_org));

  const feedB = await hookFeed(orgB, { batchId: batchB, limit: 12 });
  const bOwners = await db.select({ orgId: connection.orgId }).from(connection)
    .where(inArray(connection.id, feedB.rows.map((r) => r.connectionId)));
  const bPostOwners = await db.select({ orgId: post.orgId }).from(post)
    .where(inArray(post.id, feedB.rows.map((r) => r.postId)));
  check("tenancy sweep: workspace B sees only its own rows",
    names(feedB.rows).join(",") === "Zane"
    && bOwners.every((r) => r.orgId === orgB) && bPostOwners.every((r) => r.orgId === orgB),
    `${names(feedB.rows).join(",")} · connection orgs ${bOwners.map((r) => r.orgId).join()} · post orgs ${bPostOwners.map((r) => r.orgId).join()}`);

  await db.update(connection).set({ flagVerdict: "dropped" }).where(eq(connection.id, people.flagged));
  const droppedFeed = await hookFeed(orgA, { batchId: batchA, limit: 12 });
  const droppedStatus = await feedStatus(orgA, batchA);
  check("a dropped person leaves the feed and is counted instead",
    !droppedFeed.rows.some((r) => r.connectionId === people.flagged)
    && droppedStatus.droppedWithHook === 1 && droppedStatus.feedPeople === 3,
    `rows=${droppedFeed.rows.length} dropped=${droppedStatus.droppedWithHook} feedPeople=${droppedStatus.feedPeople}`);
  await db.update(connection).set({ flagVerdict: null }).where(eq(connection.id, people.flagged));

  // The same human twice in one CSV is two connection rows in one batch.
  const [dupPerson] = await db.insert(connection).values({
    orgId: orgA, batchId: batchA, firstName: "Asha", lastName: "Fixture (dupe)",
    companyRaw: "Asha Industries", positionRaw: "VP Marketing",
    linkedinUrl: "https://www.linkedin.com/in/three_posts",   // same person, same URL
    publicIdentifier: "three_posts_dupe", memberId: "mock:dupe",
    bucket: "pitchable", serviceSlug: "demand-gen", rank: 11, tier: 2,
    lastScanAt: new Date(), lastPostAt: new Date(),
  }).returning({ id: connection.id });
  await db.insert(post).values({
    orgId: orgA, connectionId: dupPerson!.id, providerId: "fixture:asha_fresh_dupe",
    text: "Our attribution model still can't explain half the pipeline.",
    url: "https://www.linkedin.com/feed/update/asha_fresh_dupe",
    postedAt: new Date(Date.now() - 86400000), relevance: 84, category: "substantive",
    hook: "They said the attribution model cannot explain half the pipeline.",
    judgedAt: new Date(),
  });
  const dupFeed = await hookFeed(orgA, { batchId: batchA, limit: 12 });
  check("one human, one row, even with a duplicated CSV import",
    dupFeed.rows.length === 4 && dupFeed.collapsed === 1,
    `rows=${dupFeed.rows.length} collapsed=${dupFeed.collapsed}`);
  await db.delete(post).where(eq(post.connectionId, dupPerson!.id));
  await db.delete(connection).where(eq(connection.id, dupPerson!.id));

  // ── One ACCOUNT, one card ────────────────────────────────────────────────
  // This app sells to companies, so two colleagues posting the same week is one
  // reason to reach out. The normaliser has to see through spelling: a CSV and
  // a LinkedIn sync rarely agree on whether the employer has a comma and an Inc.
  eqCheck("company key normalises punctuation and legal suffixes",
    ["Northwind Data, Inc.", "northwind data", "Northwind Data LLC", "  NORTHWIND   DATA  "]
      .map((c) => employerKey(c)),
    ["northwind data", "northwind data", "northwind data", "northwind data"]);
  eqCheck("salesforce.com and Salesforce are one account",
    [employerKey("Salesforce.com"), employerKey("Salesforce, Inc.")], ["salesforce", "salesforce"]);
  // The suffix list is anchored and needs a separator, so these keep their letters.
  eqCheck("a suffix inside a name is not stripped",
    [employerKey("Costco"), employerKey("Limited Run Games"), employerKey("Incode")],
    ["costco", "limited run games", "incode"]);
  // THE TRAP. 57% of pitchable rows carry no company. If a blank were a key,
  // every one of them would collapse into a single card.
  for (const blank of [null, undefined, "", "   ", ","]) {
    check(`a blank company (${JSON.stringify(blank)}) yields no key`, employerKey(blank) === null);
  }

  const coFolk = await db.insert(connection).values([
    { orgId: orgA, batchId: batchA, firstName: "Ravi", lastName: "Colleague",
      companyRaw: "Northwind Data, Inc.", positionRaw: "VP Marketing",
      linkedinUrl: "https://www.linkedin.com/in/ravi_colleague",
      publicIdentifier: "ravi_colleague", memberId: "mock:ravi_colleague",
      bucket: "pitchable", serviceSlug: "demand-gen", rank: 20, tier: 2 },
    // Same employer, spelled differently, and a WEAKER post — so the check also
    // proves the survivor is chosen by hook score rather than by insert order.
    { orgId: orgA, batchId: batchA, firstName: "Nita", lastName: "Colleague",
      companyRaw: "northwind data llc", positionRaw: "Head of Growth",
      linkedinUrl: "https://www.linkedin.com/in/nita_colleague",
      publicIdentifier: "nita_colleague", memberId: "mock:nita_colleague",
      bucket: "pitchable", serviceSlug: "demand-gen", rank: 21, tier: 2 },
    // Two strangers with NO company: they must BOTH keep their card.
    { orgId: orgA, batchId: batchA, firstName: "Ola", lastName: "Nocompany",
      companyRaw: null, positionRaw: "Fractional CMO",
      linkedinUrl: "https://www.linkedin.com/in/ola_nocompany",
      publicIdentifier: "ola_nocompany", memberId: "mock:ola_nocompany",
      bucket: "pitchable", serviceSlug: "demand-gen", rank: 22, tier: 2 },
    { orgId: orgA, batchId: batchA, firstName: "Pia", lastName: "Nocompany",
      companyRaw: "   ", positionRaw: "Advisor",
      linkedinUrl: "https://www.linkedin.com/in/pia_nocompany",
      publicIdentifier: "pia_nocompany", memberId: "mock:pia_nocompany",
      bucket: "pitchable", serviceSlug: "demand-gen", rank: 23, tier: 2 },
  ]).returning({ id: connection.id, first: connection.firstName });
  const coId = (n: string) => coFolk.find((c) => c.first === n)!.id;
  await db.insert(post).values(([
    ["Ravi", 91, "The strongest of the two colleagues — this is the card that must survive."],
    ["Nita", 62, "A weaker post from the same company — must be collapsed away."],
    ["Ola", 77, "No employer on the row; still a person in their own right."],
    ["Pia", 74, "Also no employer; must NOT be merged with the other blank."],
  ] as const).map(([who, rel, hook]) => ({
    orgId: orgA, connectionId: coId(who), providerId: `fixture:${who.toLowerCase()}_co`,
    text: `${hook} Filler so the excerpt has something to cut.`,
    url: `https://www.linkedin.com/feed/update/${who.toLowerCase()}_co`,
    postedAt: new Date(Date.now() - 86400000), relevance: rel,
    category: "substantive", hook, judgedAt: new Date(),
  })));

  const coFeed = await hookFeed(orgA, { batchId: batchA, limit: 12 });
  const coNames = coFeed.rows.map((r) => r.firstName);
  check("two colleagues at one company yield ONE card",
    coNames.filter((n) => n === "Ravi" || n === "Nita").length === 1,
    `got ${JSON.stringify(coNames)}`);
  check("the survivor is the colleague with the stronger post",
    coNames.includes("Ravi") && !coNames.includes("Nita"), `got ${JSON.stringify(coNames)}`);
  check("the collapse is reported, not silent", coFeed.sameCompany === 1,
    `sameCompany=${coFeed.sameCompany}`);
  // The one that matters most: blanks are not an account.
  check("two people with NO company both keep their card",
    coNames.includes("Ola") && coNames.includes("Pia"), `got ${JSON.stringify(coNames)}`);
  check("a company collapse is NOT counted as a duplicate human",
    coFeed.collapsed === 0, `collapsed=${coFeed.collapsed}`);

  await db.delete(post).where(inArray(post.connectionId, coFolk.map((c) => c.id)));
  await db.delete(connection).where(inArray(connection.id, coFolk.map((c) => c.id)));

  // ── Review's reason block: the same rule, over ids a caller already holds ──
  const everyone = Object.values(people);
  const reasons = await hooksForPeople(orgA, everyone);
  // Batch scoping is the CALLER's job here — Review hands over the ids it is
  // already showing — so a person in another batch of the same workspace is
  // legitimately answered when asked for by id.
  eqCheck("a reason is offered for exactly the people who have one",
    [...reasons.keys()].map((k) => Object.entries(people).find(([, v]) => v === k)![0]).sort(),
    ["drafted", "flagged", "other_batch", "sent", "stale", "three_posts"]);
  const ashaReason = reasons.get(people.three_posts)!;
  check("the reason is the same post, score and age the feed chose",
    ashaReason.postId === asha.postId && ashaReason.hookScore === asha.hookScore
    && ashaReason.ageDays === asha.ageDays && ashaReason.hook === asha.hook,
    `${ashaReason.postId === asha.postId} score=${ashaReason.hookScore}/${asha.hookScore} age=${ashaReason.ageDays}/${asha.ageDays}`);
  check("its excerpt is cut and marked like the feed's",
    ashaReason.excerpt === asha.postExcerpt && ashaReason.excerpt.endsWith("…"),
    `${ashaReason.excerpt.length} vs ${asha.postExcerpt.length}`);
  check("a peer with a live hook is never handed a reason to reach out",
    !reasons.has(people.peer) && !reasons.has(people.off_icp));
  check("a stale or sub-threshold post is not a reason",
    // Sneha HAS a reason now — her 20-day post — so the thing to assert is that
    // it is not the 40-day one, which is what "stale" meant here.
    reasons.get(people.stale)?.postId === posts.decay_edge
    && !reasons.has(people.weak) && !reasons.has(people.never_scanned));
  check("another workspace's person gets nothing, even asked for by id",
    !(await hooksForPeople(orgA, [people.other_org])).has(people.other_org));
  check("no ids means no query and no reasons", (await hooksForPeople(orgA, [])).size === 0);

  // ── Nova: the question the intent regex was taught to allow, and a tool
  //    that can actually answer it. No model call — the routing and the tool
  //    body are the parts with logic in them. ──
  for (const [ask, want] of [
    ["who posted something I can open with?", "reasons_to_reach_out"],
    ["any reason to reach out today?", "reasons_to_reach_out"],
    ["show me hooks", "reasons_to_reach_out"],
    // Radar owns events; a metro scan is not a reason to message someone.
    ["who posted about the conference in Bengaluru?", null],
    ["top 10 accounts", null],
  ] as const) {
    const intent = classifyIntent(ask, []);
    check(`Nova routes "${ask.slice(0, 42)}"${want ? "" : " away"}`,
      want ? intent.tool === want : intent.tool !== "reasons_to_reach_out",
      `tool=${intent.tool} offTopic=${intent.offTopic}`);
  }

  const novaReasons = await runTool({ orgId: orgA }, "reasons_to_reach_out", { n: 8 });
  check("the reason tool answers with the people, their words and the link",
    novaReasons.text.includes("Asha") && novaReasons.text.includes("attribution model")
    && novaReasons.text.includes("hook 80") && (novaReasons.cards?.length ?? 0) === 5
    && novaReasons.open === "/dashboard",
    novaReasons.text.slice(0, 140));
  check("and it is org-scoped — no other workspace's person appears",
    !novaReasons.text.includes("Zane") && !novaReasons.text.includes("Vikram")
    && !novaReasons.text.includes("Priya"));
  // Org-wide on purpose: Nova has no campaign, so the older batch's person is
  // legitimately in scope where Today's campaign-scoped feed excludes her.
  check("it is workspace-wide, not campaign-scoped", novaReasons.text.includes("Gita"),
    novaReasons.text.slice(0, 200));

  const novaLeft = await runTool({ orgId: orgA }, "whats_left", {});
  check("whats_left no longer calls the queue clear while posts sit unread",
    novaLeft.text.includes("not read against your ICPs: 2")
    && /People with a post you can open with, nobody messaged yet: 5/.test(novaLeft.text),
    novaLeft.text.slice(-300));

  const novaSnap = await runTool({ orgId: orgA }, "workspace_snapshot", {});
  check("the snapshot reports what has been looked at, not only what exists",
    /With a post you can open with: 5/.test(novaSnap.text)
    && /ever scanned/.test(novaSnap.text) && /not read yet: 2/.test(novaSnap.text),
    novaSnap.text.slice(-260));

  // ── C · the numbers on screen ──
  eqCheck("feedStatus, batch- and pitchable-scoped", {
    stored: st.stored, read: st.read, waiting: st.waiting, waitingPeople: st.waitingPeople,
    notSubstantive: st.notSubstantive, adjacent: st.adjacent, hooksEver: st.hooksEver,
    hooksFresh: st.hooksFresh, feedPeople: st.feedPeople, sentWithHook: st.sentWithHook,
    droppedWithHook: st.droppedWithHook,
    scoredNoHook: st.scoredNoHook,
  }, {
    stored: 11, read: 9, waiting: 2, waitingPeople: 1, notSubstantive: 1, adjacent: 1,
    hooksEver: 7, hooksFresh: 6, feedPeople: 4, sentWithHook: 1, droppedWithHook: 0,
    scoredNoHook: 0,
  });
  eqCheck("the header count cannot disagree with the list", st.feedPeople, rows.length);
  const js = await judgeStats(orgA);
  check("the pitchable join is present: feedStatus is stricter than the org-wide helper",
    st.hooksEver < (js?.withHook ?? 0), `feedStatus.hooksEver=${st.hooksEver} judgeStats.withHook=${js?.withHook}`);
  const wait = await waitingToRead(orgA);
  // Hardcoded, not mirrored: the fixture holds five unjudged posts in total —
  // two on a pitchable person, one on a peer, one off-target, one in the other
  // workspace. Only the first two are work a press can do, so dropping either
  // the org filter or the pitchable join moves this number.
  const [allUnjudged] = await db.select({ n: sql<number>`count(*)::int` }).from(post)
    .where(isNull(post.judgedAt));
  check("the Read button's number is one a press can drive to zero",
    wait.posts === 2 && wait.people === 1 && allUnjudged!.n === 5,
    `posts=${wait.posts} people=${wait.people} unjudged rows in db=${allUnjudged!.n}`);

  // Every number pinned, because the fixture's scan stamps are anchored to UTC
  // midnight rather than to "hours ago" — so these hold at any hour, and
  // swapping the scannable boundary for the 14-day one breaks them.
  eqCheck("scanCoverage", {
    pitchable: cov.pitchable, scannedEver: cov.scannedEver, neverScanned: cov.neverScanned,
    scannedFresh: cov.scannedFresh, scannedStale: cov.scannedStale,
    scannable: cov.scannable, unreachable: cov.unreachable, newestIsDate: cov.newestScanAt instanceof Date,
  }, {
    pitchable: 9, scannedEver: 8, neverScanned: 1,
    scannedFresh: 8, scannedStale: 0,
    scannable: 3, unreachable: 0, newestIsDate: true,
  });
  check("the recency buckets partition the campaign exactly",
    cov.scannedEver + cov.neverScanned === cov.pitchable
    && cov.scannedFresh + cov.scannedStale <= cov.scannedEver,
    `ever ${cov.scannedEver} + never ${cov.neverScanned} vs ${cov.pitchable}; fresh ${cov.scannedFresh} + stale ${cov.scannedStale} vs ever ${cov.scannedEver}`);
  check("what the button can queue never exceeds who is reachable",
    cov.scannable <= cov.pitchable - cov.unreachable && cov.unreachable <= cov.pitchable,
    `scannable ${cov.scannable}, reachable ${cov.pitchable - cov.unreachable}`);
  check("scannable overlaps the recency buckets on purpose, and is the not-today set",
    cov.scannable >= cov.neverScanned - cov.unreachable,
    `scannable ${cov.scannable} vs never-and-reachable ${cov.neverScanned - cov.unreachable}`);

  const pipe = await pipelineCounts(orgA, batchA);
  eqCheck("pipelineCounts replaces four reads with one aggregate", {
    imported: pipe.imported, matched: pipe.matched, researched: pipe.researched,
    messaged: pipe.messaged, ready: pipe.ready, decisions: pipe.decisions,
    failed: pipe.failed, touched: pipe.touched, t1Remaining: pipe.t1Remaining, frontier: pipe.frontier,
    peers: pipe.peers, offIcp: pipe.offIcp, excluded: pipe.excluded, unclassified: pipe.unclassified,
  }, {
    imported: 11, matched: 9, researched: 3, messaged: 1, ready: 1, decisions: 1,
    failed: 0, touched: 3, t1Remaining: 2, frontier: 6,
    peers: 1, offIcp: 1, excluded: 0, unclassified: 0,
  });

  // `ready` must exclude a row whose flag was cleared while its verdict stayed
  // 'dropped' — the state a re-enrich can leave behind.
  await db.update(connection).set({ flag: null, flagVerdict: "dropped" }).where(eq(connection.id, people.drafted));
  const pipeDropped = await pipelineCounts(orgA, batchA);
  check("a cleared flag with a standing 'dropped' verdict is not ready to send",
    pipeDropped.ready === 0, `ready=${pipeDropped.ready}`);
  await db.update(connection).set({ flag: null, flagVerdict: null }).where(eq(connection.id, people.drafted));

  const withHooks = await pipelineWithHooks(orgA, batchA);
  eqCheck("the pipeline sub-lines count people with a live reason",
    { readyWithHook: withHooks.readyWithHook, decisionsWithHook: withHooks.decisionsWithHook },
    { readyWithHook: 1, decisionsWithHook: 1 });

  eqCheck("the relevance bands are the ones the prompt defines",
    [bandFor(100)?.band, bandFor(80)?.band, bandFor(79)?.band, bandFor(55)?.band,
     bandFor(54)?.band, bandFor(25)?.band, bandFor(24), bandFor(null)],
    ["80–100", "80–100", "55–79", "55–79", "25–54", "25–54", null, null]);
  // ── Features switched off for one seat ──────────────────────────────────
  // The nav is a courtesy; the route guard and the action guard are the gate.
  // These pin the predicate all three share.
  for (const [who, hidden] of [
    [{ email: "apingel@arielgroup.com", name: "Adam Pingel" }, true],
    [{ email: "someone.else@arielgroup.com", name: "Someone Else" }, true],
    [{ email: "adam@example.com", name: "Adam of Ariel Group" }, true],
    [{ email: "APINGEL@ARIELGROUP.COM", name: null }, true],
    // Everyone else keeps both features.
    [{ email: "gowthamdarani@gmail.com", name: "Gowtham" }, false],
    [{ email: null, name: null }, false],
    // Word boundary, and it is not hypothetical: a real connection in this very
    // fixture is called Arielle. A substring match would switch her seat off.
    [{ email: "arielle@example.com", name: "Arielle Fixture" }, false],
    // A domain that merely ends with the string is a different company.
    [{ email: "someone@notarielgroup.com", name: "Someone" }, false],
  ] as const) {
    check(`social ${hidden ? "hidden" : "shown "} for ${who.email ?? "(no email)"}`,
      socialHidden(who) === hidden);
    // Same seat, same answer today — but they are separate product decisions
    // and separate functions, so this asserts the pairing rather than assuming it.
    check(`nova   ${hidden ? "hidden" : "shown "} for ${who.email ?? "(no email)"}`,
      novaHidden(who) === hidden);
  }

  // THE BUG THAT MADE THIS CHANGE NECESSARY, now pinned. coerce() decides
  // whether a hook STRING is written at all, and the feed requires a non-null
  // hook — so if coerce's floor is higher than the feed's, lowering the feed's
  // threshold admits posts that can never render and the change silently does
  // nothing. That is exactly what happened at 55. They must be one number.
  eqCheck("a post at the threshold keeps its hook, one below loses it",
    [coerce("substantive", HOOK_MIN_RELEVANCE, "kept").hook,
     coerce("substantive", HOOK_MIN_RELEVANCE - 1, "dropped").hook],
    ["kept", null]);
  eqCheck("only substantive may score, whatever the model said",
    [coerce("congrats", 90, "no").relevance, coerce("congrats", 90, "no").hook,
     coerce("substantive", 90, "yes").relevance],
    [0, null, 90]);

  // The invariant that keeps them honest: the screen must never admit a score
  // it cannot describe, so the lowest band IS the threshold.
  check("every score the feed will show has a band to explain it",
    Math.min(...RELEVANCE_BANDS.map((b) => b.min)) === HOOK_MIN_RELEVANCE
    && bandFor(HOOK_MIN_RELEVANCE) !== null && bandFor(HOOK_MIN_RELEVANCE - 1) === null,
    `min band=${Math.min(...RELEVANCE_BANDS.map((b) => b.min))} threshold=${HOOK_MIN_RELEVANCE}`);

  // The old page tallied these in JavaScript over every researched row.
  const enriched = await db.select().from(connection)
    .where(and(eq(connection.batchId, batchA), eq(connection.enrichStatus, "done")));
  const oldReady = enriched.filter((p) => p.outreachMessage && !p.outreachStatus
    && (!p.flag || p.flagVerdict === "variant") && p.flagVerdict !== "dropped" && p.flagVerdict !== "verify").length;
  const oldDecisions = enriched.filter((p) => p.flag && !p.flagVerdict).length;
  const oldSent = enriched.filter((p) => p.sentAt).length;
  eqCheck("no displayed number regressed against the old JS tally",
    [pipe.ready, pipe.decisions, pipe.messaged], [oldReady, oldDecisions, oldSent]);

  const elsewhere = await hooksElsewhere(orgA, batchA);
  eqCheck("the re-sync trap is named, not hidden",
    { label: elsewhere?.label, people: elsewhere?.people },
    { label: "Fixture batch A (older)", people: 1 });
  const elsewhereBack = await hooksElsewhere(orgA, batchA2);
  check("and it is symmetric", elsewhereBack?.label === "Fixture batch A", `got ${elsewhereBack?.label}`);

  const usage = await getDailyScanUsage(orgA);
  const [expUsed] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.orgId, orgA), gte(connection.lastScanAt, utcMidnight())));
  check("the scan meter is workspace-wide and matches the brake's own boundary",
    usage.used === expUsed!.n && usage.cap === 100
    && usage.resetsAt.getTime() === utcMidnight().getTime() + 86400000,
    `used=${usage.used} expected=${expUsed!.n} cap=${usage.cap}`);
  check("the meter is wider than one campaign", usage.used > cov.scannedEver - 1,
    `org-wide ${usage.used} vs campaign ${cov.scannedEver}`);

  // A row stamped before UTC midnight but after IST-local midnight: the two
  // boundaries disagree about it, and the meter must side with the brake.
  const [tzProbe] = await db.insert(connection).values({
    orgId: orgA, batchId: batchA, firstName: "Tz", lastName: "Probe",
    bucket: "peer_competitor", memberId: "mock:tz",
    lastScanAt: new Date(utcMidnight().getTime() - 2 * 3600_000),
  }).returning({ id: connection.id });
  const istMidnight = new Date(utcMidnight().getTime() - 5.5 * 3600_000);
  const [istCount] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.orgId, orgA), gte(connection.lastScanAt, istMidnight)));
  const afterProbe = await getDailyScanUsage(orgA);
  check("the meter uses UTC midnight, so it cannot disagree with the brake off-UTC",
    afterProbe.used === expUsed!.n && istCount!.n === expUsed!.n + 1,
    `utc=${afterProbe.used} ist-boundary=${istCount!.n} baseline=${expUsed!.n}`);
  await db.delete(connection).where(eq(connection.id, tzProbe!.id));

  const [fwh, fwhIndia, fwhFrance] = await Promise.all([
    frontierWithHookCount(orgA, batchA),
    frontierWithHookCount(orgA, batchA, "India"),
    frontierWithHookCount(orgA, batchA, "France"),
  ]);
  check("the picker's number counts the frontier the button will select",
    fwh === 2 && pipe.frontier === 6 && fwhIndia === 2 && fwhFrance === 0,
    `withHook=${fwh} india=${fwhIndia} france=${fwhFrance} frontier=${pipe.frontier}`);

  // ── D · row states: nobody vanishes ──
  eqCheck("row states on the three feed rows",
    [rowState(asha), rowState(manoj), rowState(rahul)],
    ["notResearched", "needsDecision", "readyToSend"]);

  const STATES: RowState[] = ["readyToSend", "needsDecision", "notResearched", "researchFailed",
    "doneNoDraft", "drafting", "parked", "skipped"];
  let combos = 0, covered = 0;
  for (const enrichStatus of ["pending", "queued", "running", "done", "failed", "skipped"]) {
    for (const hasDraft of [true, false]) {
      for (const flag of [null, "appears to have left the company"]) {
        for (const flagVerdict of [null, "dropped", "verify", "variant"]) {
          combos += 1;
          if (STATES.includes(rowState({ enrichStatus, hasDraft, flag, flagVerdict }))) covered += 1;
        }
      }
    }
  }
  check("rowState is exhaustive — no row can fall through and vanish",
    covered === combos && combos > 0, `${covered} of ${combos} combinations returned a known state`);

  for (const [label, id, field, value, want] of [
    ["a failed research run stays visible", people.three_posts, "enrichStatus", "failed", "researchFailed"],
    ["a queued row stays visible", people.drafted, "enrichStatus", "queued", "drafting"],
    ["a parked flag stays visible", people.flagged, "flagVerdict", "verify", "parked"],
  ] as const) {
    const before = await db.select({
      enrichStatus: connection.enrichStatus, flagVerdict: connection.flagVerdict,
    }).from(connection).where(eq(connection.id, id));
    await db.update(connection).set({ [field]: value }).where(eq(connection.id, id));
    const f = await hookFeed(orgA, { batchId: batchA, limit: 12 });
    const row = f.rows.find((r) => r.connectionId === id);
    check(label, Boolean(row) && rowState(row!) === want, row ? `state ${rowState(row)}` : "row disappeared");
    await db.update(connection).set({
      enrichStatus: before[0]!.enrichStatus, flagVerdict: before[0]!.flagVerdict,
    }).where(eq(connection.id, id));
  }

  eqCheck("the deep-link ladder degrades and never yields a dead anchor", [
    deepLinkFor({ postUrl: "https://p", activityUrl: "https://a", linkedinUrl: "https://l" }),
    deepLinkFor({ postUrl: null, activityUrl: "https://a", linkedinUrl: "https://l" }),
    deepLinkFor({ postUrl: null, activityUrl: null, linkedinUrl: "https://www.linkedin.com/in/x/" }),
    deepLinkFor({ postUrl: null, activityUrl: null, linkedinUrl: null }),
  ], ["https://p", "https://a", "https://www.linkedin.com/in/x/recent-activity/all/", null]);

  // ── E · target pickers and caps ──
  const targets = await pickScanTargets(orgA, batchA, 40);
  const targetIds = targets.map((t) => t.id);
  check("scan targets: never-looked-at first",
    targetIds[0] === people.never_scanned, `first=${targetIds[0]}`);
  check("scan targets include the long-stale and exclude today's cohort",
    targetIds.includes(people.stale) && !targetIds.includes(people.three_posts)
    && !targetIds.includes(people.peer) && !targetIds.includes(people.other_batch),
    targetIds.join(","));
  eqCheck("scan targets are exactly the reachable not-today set, oldest first",
    targetIds, [people.never_scanned, people.stale, people.scanned_3d]);
  // A LinkedIn URL the runner cannot pull an "/in/" slug out of is not
  // reachable: it resolves nothing, stores nothing, and still burns a cap slot.
  await db.update(connection).set({
    memberId: null, publicIdentifier: null,
    linkedinUrl: "https://www.linkedin.com/company/acme",
  }).where(eq(connection.id, people.scanned_3d));
  const [oddUrl, covOdd] = await Promise.all([
    pickScanTargets(orgA, batchA, 40), scanCoverage(orgA, batchA),
  ]);
  check("a LinkedIn URL with no /in/ slug counts as unreachable, not as a target",
    !oddUrl.some((t) => t.id === people.scanned_3d) && covOdd.unreachable === 1 && covOdd.scannable === 2,
    `unreachable=${covOdd.unreachable} scannable=${covOdd.scannable}`);
  await db.update(connection).set({
    memberId: "mock:scanned_3d", publicIdentifier: "scanned_3d",
    linkedinUrl: "https://www.linkedin.com/in/scanned_3d",
  }).where(eq(connection.id, people.scanned_3d));

  await db.update(connection).set({ memberId: null, publicIdentifier: null, linkedinUrl: null })
    .where(eq(connection.id, people.never_scanned));
  const noIdent = await pickScanTargets(orgA, batchA, 40);
  const covNoIdent = await scanCoverage(orgA, batchA);
  check("someone with no identifier is never queued, and is counted as unreachable",
    !noIdent.some((t) => t.id === people.never_scanned) && covNoIdent.unreachable === 1,
    `unreachable=${covNoIdent.unreachable}`);
  await db.update(connection).set({
    memberId: "mock:never_scanned", publicIdentifier: "never_scanned",
    linkedinUrl: "https://www.linkedin.com/in/never_scanned",
  }).where(eq(connection.id, people.never_scanned));

  const scanned = await db.select({ id: connection.id, lastScanAt: connection.lastScanAt })
    .from(connection).where(and(eq(connection.orgId, orgA), eq(connection.batchId, batchA)));
  await db.update(connection).set({ lastScanAt: new Date() })
    .where(and(eq(connection.orgId, orgA), eq(connection.batchId, batchA)));
  const noneLeft = await pickScanTargets(orgA, batchA, 40);
  check("a second press the same day cannot burn LinkedIn calls invisibly",
    noneLeft.length === 0, `${noneLeft.length} targets still offered`);
  for (const s of scanned) {
    await db.update(connection).set({ lastScanAt: s.lastScanAt }).where(eq(connection.id, s.id));
  }

  await updateOrgSettings(orgA, { postScanDailyCap: 5 });
  const capped = await getDailyScanUsage(orgA);
  const clamped = await pickScanTargets(orgA, batchA, Math.min(40, capped.remaining));
  check("the cap clamps the press instead of letting the worker die at 0/0",
    capped.remaining === 0 && clamped.length === 0,
    `remaining=${capped.remaining} targets=${clamped.length}`);
  await updateOrgSettings(orgA, { postScanDailyCap: 100 });

  const hookFrontier = await pickHookFrontier(orgA, batchA, 30, "");
  eqCheck("the hook branch selects the reason-bearing frontier", hookFrontier.map((r) => r.id),
    [people.three_posts, people.stale]);
  await db.update(connection).set({ enrichStatus: "done" }).where(eq(connection.id, people.three_posts));
  const frontierAfter = await pickHookFrontier(orgA, batchA, 30, "");
  eqCheck("the frontier is 'never researched', never 'never selected'",
    frontierAfter.map((r) => r.id), [people.stale]);
  await db.update(connection).set({ enrichStatus: "pending" }).where(eq(connection.id, people.three_posts));
  const [noFrance, inIndia] = await Promise.all([
    pickHookFrontier(orgA, batchA, 30, "France"),
    pickHookFrontier(orgA, batchA, 30, "India"),
  ]);
  check("the hook branch still honours the country filter",
    noFrance.length === 0 && inIndia.map((r) => r.id).join() === [people.three_posts, people.stale].join(),
    `france=${noFrance.length} india=${inIndia.length}`);

  // ── F · job effects, against the mock provider ──
  const provider = getChannelProvider();
  check("running against the mock provider, not a real seat", provider.name === "mock", provider.name);
  const [mockNone, mockSome] = await Promise.all([
    provider.fetchRecentPosts({ accountId: "mock-seat", identifier: "mock:three_posts", limit: 5 }),
    provider.fetchRecentPosts({ accountId: "mock-seat", identifier: "mock-4", limit: 5 }),
  ]);
  check("the fixture's own member ids are deliberately unscannable by the mock",
    mockNone.length === 0 && mockSome.length === 3,
    `mock:three_posts=${mockNone.length} mock-4=${mockSome.length}`);

  await db.delete(job).where(inArray(job.orgId, [orgA, orgB]));
  // processNext() takes the oldest queued job in the WHOLE database, so this
  // suite would execute a stranger's job. Refuse rather than delete it: an
  // unqualified `delete from job` destroyed other workspaces' queues while the
  // final check claimed to have touched nobody else.
  const [foreign] = await db.select({ id: job.id, orgId: job.orgId }).from(job)
    .where(and(notInArray(job.orgId, [orgA, orgB]), inArray(job.status, ["queued", "running", "stopping"])))
    .limit(1);
  if (foreign) {
    throw new Error(`Workspace ${foreign.orgId} has a live job (${foreign.id}) and this suite runs the worker, so it would execute it. Let that queue drain first.`);
  }
  const [seat] = await db.insert(channelAccount).values({
    orgId: orgA, unipileAccountId: `mock-seat-${Date.now()}`,
    displayName: "Mock seat (verification)", status: "operational",
  }).returning({ id: channelAccount.id });
  const [scanTarget] = await db.insert(connection).values({
    orgId: orgA, batchId: batchA, firstName: "Scan", lastName: "Target",
    companyRaw: "Scan Target Industries", positionRaw: "VP Marketing",
    publicIdentifier: "scan-target-4", memberId: "mock-4",
    bucket: "pitchable", serviceSlug: "demand-gen", rank: 12, tier: 2,
  }).returning({ id: connection.id });

  const queued = await pickScanTargets(orgA, batchA, 40);
  check("the new row is picked up as scannable", queued.some((t) => t.id === scanTarget!.id));
  const scanJob = await enqueue(orgA, "activity_scan", { connectionIds: [scanTarget!.id] });
  const [storedJob] = await db.select().from(job).where(eq(job.id, scanJob!.id));
  eqCheck("the enqueued payload is the literal id array, in order",
    { kind: storedJob!.kind, ids: (storedJob!.payloadJson as { connectionIds: string[] }).connectionIds },
    { kind: "activity_scan", ids: [scanTarget!.id] });

  await processNext();
  const [ranJob] = await db.select().from(job).where(eq(job.id, scanJob!.id));
  eqCheck("the scan runs to completion",
    { status: ranJob!.status, progress: ranJob!.progress, total: ranJob!.total },
    { status: "done", progress: 1, total: 1 });

  const stored = await db.select().from(post).where(eq(post.connectionId, scanTarget!.id));
  const [scannedRow] = await db.select({
    lastPostAt: connection.lastPostAt, lastScanAt: connection.lastScanAt,
  }).from(connection).where(eq(connection.id, scanTarget!.id));
  check("the posts it already paid for are kept, with text, link and date",
    stored.length === 3 && stored.every((p) => Boolean(p.text && p.url && p.postedAt))
    && scannedRow!.lastPostAt instanceof Date && scannedRow!.lastScanAt instanceof Date,
    `${stored.length} posts`);
  check("judgement columns start empty, so nothing reads as uninteresting",
    stored.every((p) => p.relevance === null && p.category === null && p.hook === null && p.judgedAt === null));

  // Re-scan: idempotent, and it must not un-judge what it already knows.
  await db.update(post).set({
    relevance: 70, category: "substantive", hook: "A verdict that must survive a re-scan.",
    judgedAt: new Date(),
  }).where(eq(post.id, stored[0]!.id));
  await db.update(connection).set({ lastScanAt: null }).where(eq(connection.id, scanTarget!.id));
  await db.delete(job).where(inArray(job.orgId, [orgA, orgB]));
  const scanJob2 = await enqueue(orgA, "activity_scan", { connectionIds: [scanTarget!.id] });
  await processNext();
  const stored2 = await db.select().from(post).where(eq(post.connectionId, scanTarget!.id));
  check("a re-scan updates rather than duplicating", stored2.length === 3, `${stored2.length} posts`);
  const kept = stored2.find((p) => p.id === stored[0]!.id)!;
  check("an existing verdict survives a re-scan of unchanged text",
    kept.relevance === 70 && kept.category === "substantive" && kept.judgedAt !== null,
    `relevance=${kept.relevance} judgedAt=${kept.judgedAt}`);

  const chained = await db.select({ kind: job.kind, status: job.status, payloadJson: job.payloadJson })
    .from(job).where(and(eq(job.orgId, orgA), eq(job.kind, "post_judge")));
  check("the scan queues its own reading pass — one press, two steps",
    chained.length === 1 && chained[0]!.status === "queued"
    && JSON.stringify(chained[0]!.payloadJson) === "{}",
    JSON.stringify(chained));
  void scanJob2;

  // ── The real guard chains. planScan/planRead are what the two server actions
  //    call; the actions are three lines of redirect around them. Asserting a
  //    re-implementation of the guards inside the test would prove nothing, so
  //    these call the shipped code. ──
  // The scan section above leaves the auto-chained post_judge queued, which is
  // correct behaviour and would make every plan below say "busy". Its stored
  // posts have served their purpose too, and leaving them would change the
  // read plan's count from the fixture's known 2 to whatever the mock returned.
  await db.delete(job).where(inArray(job.orgId, [orgA, orgB]));
  await db.delete(post).where(eq(post.connectionId, scanTarget!.id));
  const jobsBefore = await db.select({ n: sql<number>`count(*)::int` }).from(job);

  const busyJob = await enqueue(orgA, "activity_scan", { connectionIds: [] });
  const [busyScan, busyRead] = await Promise.all([planScan(orgA, batchA, 40), planRead(orgA)]);
  check("a run in flight refuses both presses",
    busyScan.ok === false && busyScan.reason === "busy"
    && busyRead.ok === false && busyRead.reason === "busy",
    `${JSON.stringify(busyScan)} ${JSON.stringify(busyRead)}`);

  // Stopped before it started: the worker only picks up 'queued', so nothing
  // will ever acknowledge this row and it must not block the screen for good.
  await db.update(job).set({ status: "stopping", updatedAt: new Date(Date.now() - 60 * 60_000) })
    .where(eq(job.id, busyJob!.id));
  const staleScan = await planScan(orgA, batchA, 40);
  check("a stale 'stopping' job does not block the screen forever",
    staleScan.ok === true, JSON.stringify(staleScan).slice(0, 120));
  await db.delete(job).where(eq(job.id, busyJob!.id));

  const freeScan = await planScan(orgA, batchA, 40);
  const wouldPick = await pickScanTargets(orgA, batchA, 40);
  check("with nothing running, the plan is exactly the targets that were picked",
    freeScan.ok === true && JSON.stringify(freeScan.ids) === JSON.stringify(wouldPick.map((t) => t.id)),
    JSON.stringify(freeScan).slice(0, 140));
  const askedTooMuch = await planScan(orgA, batchA, 5000);
  check("the plan clamps what was asked for", askedTooMuch.ok === true && askedTooMuch.ids.length <= 80);

  await updateOrgSettings(orgA, { postScanDailyCap: 1 });
  const cappedPlan = await planScan(orgA, batchA, 40);
  check("the cap refuses the press rather than letting the worker die at 0/0",
    cappedPlan.ok === false && cappedPlan.reason === "cap", JSON.stringify(cappedPlan));
  await updateOrgSettings(orgA, { postScanDailyCap: 100 });

  await db.update(channelAccount).set({ status: "needs_reauth" }).where(eq(channelAccount.id, seat!.id));
  const noSeatPlan = await planScan(orgA, batchA, 40);
  check("no operational seat refuses the press before anything is queued",
    noSeatPlan.ok === false && noSeatPlan.reason === "noseat", JSON.stringify(noSeatPlan));
  await db.update(channelAccount).set({ status: "operational" }).where(eq(channelAccount.id, seat!.id));

  const [offer] = await db.select({ id: service.id }).from(service)
    .where(and(eq(service.orgId, orgA), eq(service.status, "active"))).limit(1);
  await db.update(service).set({ status: "archived" }).where(eq(service.orgId, orgA));
  const noOffersPlan = await planRead(orgA);
  check("with no active ICP there is nothing to judge against, so no run is offered",
    noOffersPlan.ok === false && noOffersPlan.reason === "nooffers", JSON.stringify(noOffersPlan));
  await db.update(service).set({ status: "active" }).where(eq(service.id, offer!.id));

  const readPlan = await planRead(orgA);
  check("the read plan promises exactly the posts one press can read",
    readPlan.ok === true && readPlan.posts === 2, JSON.stringify(readPlan));
  // Only what judgePosts would have read: marking a peer's post judged is a
  // state the product cannot reach, and later checks would inherit it.
  const readable = await db.select({ id: post.id }).from(post)
    .innerJoin(connection, eq(connection.id, post.connectionId))
    .where(and(eq(post.orgId, orgA), isNull(post.judgedAt), eq(connection.bucket, "pitchable")));
  await db.update(post).set({ judgedAt: new Date(), relevance: 0, category: "personal" })
    .where(inArray(post.id, readable.map((r) => r.id)));
  const nothingToRead = await planRead(orgA);
  check("nothing left to read refuses the press instead of queuing a no-op",
    nothingToRead.ok === false && nothingToRead.reason === "none", JSON.stringify(nothingToRead));

  check("liveJob is org-scoped", (await liveJob(orgB)) === null);

  const jobsAfter = await db.select({ n: sql<number>`count(*)::int` }).from(job);
  check("not one of those refusals inserted a job",
    jobsAfter[0]!.n === jobsBefore[0]!.n,
    `before=${jobsBefore[0]!.n} after=${jobsAfter[0]!.n}`);

  // ── Re-reading after an ICP rewrite. Destructive by design, so it sits with
  //    the other end-of-run scenario. ──
  const rereadIds = await rereadTargets(orgA);
  const [judgedPitchable] = await db.select({ n: sql<number>`count(*)::int` }).from(post)
    .innerJoin(connection, eq(connection.id, post.connectionId))
    .where(and(eq(post.orgId, orgA), eq(connection.bucket, "pitchable"), isNotNull(post.judgedAt)));
  // No hardcoded total: an earlier check reads the last unjudged posts, so the
  // figure depends on where in the run this sits. What must hold is the joint
  // predicate — judged AND matched — and membership is what proves it.
  const [ashaWinnerId] = await db.select({ id: post.id }).from(post)
    .where(eq(post.providerId, "fixture:asha_fresh"));
  const nonPitchableJudged = await db.select({ id: post.id, providerId: post.providerId }).from(post)
    .innerJoin(connection, eq(connection.id, post.connectionId))
    .where(and(eq(post.orgId, orgA), isNotNull(post.judgedAt),
      sql`${connection.bucket} <> 'pitchable'`));
  check("a re-read targets the judged posts of matched people",
    rereadIds.length === judgedPitchable!.n && rereadIds.includes(ashaWinnerId!.id),
    `targets=${rereadIds.length} judged-pitchable=${judgedPitchable!.n} has-asha=${rereadIds.includes(ashaWinnerId!.id)}`);
  // The trap this scoping exists to avoid: a cleared verdict on someone the
  // judge will never select sits unjudged forever and inflates the Read button
  // into a promise no press can keep.
  check("and never a verdict nothing would re-read",
    nonPitchableJudged.length > 0
    && nonPitchableJudged.every((p) => !rereadIds.includes(p.id)),
    `${nonPitchableJudged.length} judged non-matched: ${nonPitchableJudged.map((p) => p.providerId).join(",")}`);

  const readBefore = await waitingToRead(orgA);
  await clearVerdicts(orgA, rereadIds);
  const readAfter = await waitingToRead(orgA);
  const feedAfter = await hookFeed(orgA, { batchId: batchA, limit: 12 });
  check("clearing re-queues exactly those posts and empties the feed until the run",
    readAfter.posts === readBefore.posts + rereadIds.length && feedAfter.rows.length === 0,
    `before=${readBefore.posts} after=${readAfter.posts} rows=${feedAfter.rows.length}`);
  const stillJudged = await db.select({ judgedAt: post.judgedAt }).from(post)
    .where(inArray(post.id, nonPitchableJudged.map((p) => p.id)));
  check("and their verdicts survive the clear, so nothing is stranded",
    stillJudged.length === nonPitchableJudged.length && stillJudged.every((r) => r.judgedAt !== null),
    `${stillJudged.filter((r) => r.judgedAt === null).length} were stranded`);
  const rereadPlan = await planRead(orgA);
  check("every cleared post is work a press can actually do",
    rereadPlan.ok === true && rereadPlan.posts === readAfter.posts,
    JSON.stringify(rereadPlan));
  await buildFixture();

  // ── The one destructive scenario, deliberately last: a workspace that has
  //    scanned nobody must read as UNOBSERVED, never as quiet. It empties the
  //    workspace, and buildFixture() mints fresh ids, so anything after it
  //    would be asserting against rows that no longer exist. ──
  await db.update(connection).set({ lastScanAt: null }).where(eq(connection.orgId, orgA));
  await db.delete(post).where(eq(post.orgId, orgA));
  const unobserved = await runTool({ orgId: orgA }, "reasons_to_reach_out", { n: 8 });
  const unobservedSnap = await runTool({ orgId: orgA }, "workspace_snapshot", {});
  const unobservedLeft = await runTool({ orgId: orgA }, "whats_left", {});
  check("with nobody scanned, Nova says unobserved rather than quiet",
    /none scanned/.test(unobserved.text)
    && /it is unobserved/.test(unobserved.text)
    && /nothing is known about who is talking/.test(unobservedSnap.text)
    && /no reason list to work from/.test(unobservedLeft.text),
    unobserved.text.slice(0, 200));

  // ── G · cleanup ──
  await db.delete(post).where(eq(post.connectionId, scanTarget!.id));
  await db.delete(connection).where(eq(connection.id, scanTarget!.id));
  await db.delete(job).where(eq(job.orgId, orgA));
  await db.delete(channelAccount).where(eq(channelAccount.id, seat!.id));
  await buildFixture();

  // ── H · Radar's event search ──────────────────────────────────────
  //
  //  Driven, not hand-written. A hand-written event row would only prove the
  //  fixture author's beliefs, and the whole point of this section is that the
  //  INSERT PATH was lying: it stamped bucket='pitchable', match_method='rule',
  //  match_confidence=60 on people it had never graded, which made the
  //  classifyBatch call twenty lines below it select zero rows.
  //
  //  The mock's post search is deterministic. searchPosts delegates to
  //  searchPeople, which yields hits from i=200 over relationAt(i % 120):
  //    i=200 -> "VP Marketing at Meridian SaaS Labs",          distance "2"
  //    i=201 -> "Chief Marketing Officer at Lumen Data Systems", distance "3"
  //  Both rule-classify to pitchable against this fixture's ICP (title_include
  //  ["marketing","growth"], seniority ["cxo","vp"]) in classifyBatch pass 1 —
  //  zero model calls — and both are then demoted by the distance rule. That
  //  pairing is why the run command pins EVENT_EXTENDED_CAP=2: one 2nd-degree
  //  and one 3rd-degree person, for free.
  const [radarSeat] = await db.insert(channelAccount).values({
    orgId: orgA, unipileAccountId: `mock-seat-radar-${orgA}`,
    displayName: "Mock seat (radar)", status: "operational",
  }).returning({ id: channelAccount.id });

  const usageBeforeSearch = await getDailyScanUsage(orgA);
  const batchesBefore = await db.select({ id: connectionBatch.id }).from(connectionBatch)
    .where(eq(connectionBatch.orgId, orgA));

  const search = await runEventExtended(orgA, {
    country: "united-states", eventName: "Fixture Summit", days: 7, degree: "extended",
  });
  const evtBatchId = search.batchId;
  const evtRows = await db.select().from(connection).where(eq(connection.batchId, evtBatchId));

  check("the event search imports the authors and grades them for real",
    evtRows.length === 2
    && evtRows.every((r) => r.matchMethod === "rule")
    && evtRows.every((r) => (r.matchWhy ?? "").includes("Title matched pattern")),
    `${evtRows.length} rows · methods ${evtRows.map((r) => r.matchMethod).join(",")} · why ${evtRows.map((r) => (r.matchWhy ?? "").slice(0, 40)).join(" | ")}`);

  const [fabricated] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.orgId, orgA), sql`match_why like 'Posted about "%'`));
  check("nothing anywhere still carries the fabricated event verdict", fabricated!.n === 0);

  const [strangersPitchable] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.orgId, orgA), inArray(connection.networkDistance, ["2", "3"]),
      eq(connection.bucket, "pitchable")));
  check("a person you are not connected to is never pitchable",
    strangersPitchable!.n === 0
    && evtRows.every((r) => r.bucket === "excluded" && r.serviceSlug === null)
    && evtRows.every((r) => (r.matchWhy ?? "").startsWith("Not a 1st-degree connection (")),
    `pitchable strangers=${strangersPitchable!.n} · buckets ${evtRows.map((r) => r.bucket).join(",")}`);

  // The check that fails a `network_distance = '1'` implementation — which
  // would empty every CSV and sync workspace in production, because
  // create-batch.ts never writes the column.
  const [probeBatch] = await db.insert(connectionBatch).values({
    orgId: orgA, source: "csv", label: "Degree probe", statsJson: {},
  }).returning({ id: connectionBatch.id });
  for (const [key, distance] of [["null", null], ["first", "1"], ["third", "3"]] as const) {
    await db.insert(connection).values({
      orgId: orgA, batchId: probeBatch!.id, firstName: "Probe", lastName: key,
      headlineRaw: "VP Marketing at Meridian SaaS Labs",
      positionRaw: "VP Marketing", companyRaw: "Meridian SaaS Labs",
      publicIdentifier: `probe-${key}`, networkDistance: distance,
    });
  }
  await classifyBatch(orgA, probeBatch!.id, {});
  const probes = await db.select({
    lastName: connection.lastName, bucket: connection.bucket, serviceSlug: connection.serviceSlug,
  }).from(connection).where(eq(connection.batchId, probeBatch!.id));
  const probeOf = (k: string) => probes.find((r) => r.lastName === k)!;
  check("NULL and '1' are 1st degree; only '2'/'3' are demoted",
    probeOf("null").bucket === "pitchable" && probeOf("null").serviceSlug === "demand-gen"
    && probeOf("first").bucket === "pitchable" && probeOf("first").serviceSlug === "demand-gen"
    && probeOf("third").bucket === "excluded" && probeOf("third").serviceSlug === null,
    probes.map((r) => `${r.lastName}=${r.bucket}/${r.serviceSlug}`).join(" "));
  await db.delete(connection).where(eq(connection.batchId, probeBatch!.id));
  await db.delete(connectionBatch).where(eq(connectionBatch.id, probeBatch!.id));

  const usageAfterSearch = await getDailyScanUsage(orgA);
  check("importing strangers spends none of the daily post-scan budget",
    usageAfterSearch.used === usageBeforeSearch.used
    && evtRows.every((r) => r.lastScanAt === null),
    `used ${usageBeforeSearch.used} -> ${usageAfterSearch.used} · stamped ${evtRows.filter((r) => r.lastScanAt !== null).length}`);

  const resolved = await resolveBatch(orgA);
  check("an event search is not a campaign, but is still switchable to",
    resolved.batch?.id !== evtBatchId
    && resolved.batches.some((b) => b.id === evtBatchId)
    && resolved.batches.length === batchesBefore.length + 1,
    `default=${resolved.batch?.id} event=${evtBatchId} listed=${resolved.batches.some((b) => b.id === evtBatchId)}`);

  const [evtScan, evtHook, evtPipe, evtCov] = await Promise.all([
    pickScanTargets(orgA, evtBatchId, 40),
    pickHookFrontier(orgA, evtBatchId, 10, ""),
    pipelineCounts(orgA, evtBatchId),
    scanCoverage(orgA, evtBatchId),
  ]);
  check("the event batch offers nothing to spend money on",
    evtScan.length === 0 && evtHook.length === 0
    && evtPipe.matched === 0 && evtPipe.excluded === 2 && evtPipe.unclassified === 0
    && evtCov.pitchable === 0,
    `scan=${evtScan.length} hook=${evtHook.length} matched=${evtPipe.matched} excluded=${evtPipe.excluded} covPitchable=${evtCov.pitchable}`);

  // The exact predicate buildWorkbook uses for "Target Pool (ranked): all N
  // pitchable targets" — asserted here rather than importing exceljs.
  const [inDeliverable] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.batchId, evtBatchId), eq(connection.bucket, "pitchable")));
  check("the client workbook's Target Pool carries none of them", inDeliverable!.n === 0);

  // Radar must still find its own people WHILE they are excluded. This is the
  // check that stops a future "let's filter /radar by pitchable" from making
  // the whole feature vanish.
  const radarView = await loadRadar(orgA, "sf-bay-area", 7, "extended", "united-states");
  check("Radar returns a view at all for the event pool", radarView !== null);
  const mentioned = radarView?.mentioned ?? [];
  const radarIds = new Set(mentioned.map((p) => p.id));
  check("Radar still finds its own people while their bucket is excluded",
    evtRows.every((r) => radarIds.has(r.id)),
    `mentioned=${mentioned.length} of ${evtRows.length} imported`);
  check("and the degree reaches the screen",
    mentioned.filter((p) => p.networkDistance === "2").length === 1
    && mentioned.filter((p) => p.networkDistance === "3").length === 1,
    mentioned.map((p) => `${p.firstName}=${p.networkDistance}`).join(" "));

  // ── The 1st-degree path: scan your own connections for the event name ──
  //
  // The mock answers only identifiers it can parse to a number. i=10 is
  // "travelling", so its first post names SaaStr; every posting persona's
  // second post mentions ABM. Two people are enough to prove both halves.
  // By public_identifier, NOT by the `people` id map: check 109's cleanup
  // rebuilt the fixture, which mints fresh row ids, so every id captured at the
  // top of this run is stale from here on.
  const [tenId] = await db.update(connection).set({ memberId: "mock-10", country: "United States" })
    .where(and(eq(connection.orgId, orgA), eq(connection.publicIdentifier, "three_posts")))
    .returning({ id: connection.id });
  const [fourId] = await db.update(connection).set({ memberId: "mock-4", country: "United States" })
    .where(and(eq(connection.orgId, orgA), eq(connection.publicIdentifier, "drafted")))
    .returning({ id: connection.id });
  check("the 1st-degree fixture targets resolve after the rebuild",
    Boolean(tenId && fourId), `ten=${tenId?.id} four=${fourId?.id}`);

  const firstScan = await runEventScan(orgA, {
    metro: "sf-bay-area", country: "united-states", eventName: "SaaStr",
    limit: 50, firstDegreeOnly: true,
  });
  const [saastr] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.orgId, orgA), eq(connection.mentionKind, "event"),
      eq(connection.eventQuery, "SaaStr")));
  check("the 1st-degree scan finds the event in a connection's own posts",
    firstScan.scanned > 0 && firstScan.mentioned === 1 && saastr!.n === 1,
    `scanned=${firstScan.scanned} mentioned=${firstScan.mentioned} stamped=${saastr!.n}`);

  // The regression this exists to prevent: with the freshness window in force,
  // a second event minutes later used to skip everyone before consulting their
  // posts and report nobody. Layer 02 stores those posts, so the answer is on
  // file — no LinkedIn request, no cap slot.
  const secondScan = await runEventScan(orgA, {
    metro: "sf-bay-area", country: "united-states", eventName: "ABM",
    limit: 50, firstDegreeOnly: true,
  });
  const [abm] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.orgId, orgA), eq(connection.mentionKind, "event"),
      eq(connection.eventQuery, "ABM")));
  check("a second event minutes later is answered from stored posts, not LinkedIn",
    secondScan.scanned === 0 && secondScan.skippedFresh > 0
    && secondScan.fromStored === 2 && secondScan.mentioned === 2 && abm!.n === 2,
    `scanned=${secondScan.scanned} skipped=${secondScan.skippedFresh} fromStored=${secondScan.fromStored} stamped=${abm!.n}`);

  const usageAfterFirstDegree = await getDailyScanUsage(orgA);
  check("and answering from storage spends no post-scan budget",
    usageAfterFirstDegree.used === (await getDailyScanUsage(orgA)).used,
    "meter is stable across the stored-post pass");

  // ── The Radar CSV export ──
  const csvOut = await buildRadarCsv(orgA, {
    metro: "sf-bay-area", days: 7, pool: "extended", country: "united-states",
  });
  const csvLines = csvOut.csv.trimEnd().split("\r\n");
  eqCheck("the CSV header is the eight columns asked for, query first",
    csvLines[0],
    '"Search query","Name","Connection","Title","Company","Location","LinkedIn profile","Posted date","LinkedIn post link","LinkedIn post text"');
  check("one row per person on screen, and the count is reported",
    csvOut.rows === 2 && csvLines.length === 3, `rows=${csvOut.rows} lines=${csvLines.length}`);

  // Every column populated: a CSV whose post columns are blank is the failure
  // this feature exists to avoid, and the searched post is what fills them.
  const cells = csvLines[1]!.match(/"(?:[^"]|"")*"/g)!.map((c) => c.slice(1, -1).replace(/""/g, '"'));
  check("every column carries real data, including the query, post link and text",
    cells.length === 10
    && cells[0] === "Fixture Summit"
    && cells[1]!.trim().length > 0
    && ["2nd", "3rd"].includes(cells[2]!)
    && cells[6]!.startsWith("https://www.linkedin.com/in/")
    && /^\d{4}-\d{2}-\d{2}$/.test(cells[7]!)
    && cells[8]!.startsWith("https://www.linkedin.com/feed/update/")
    && cells[9]!.length > 0,
    cells.map((c, i) => `${i}:${c.slice(0, 26)}`).join(" | "));

  // Excluding the event host. Matches an employment CLAIM, never a mention:
  // dropping everyone who says "Salesforce" anywhere would drop most of a
  // Dreamforce audience, which is the opposite of what this is for.
  const excl = parseExcludedCompanies("Salesforce, HubSpot");
  eqCheck("the exclude box parses into terms", excl, ["salesforce", "hubspot"]);
  eqCheck("blank and one-character entries are ignored",
    parseExcludedCompanies(" , a ,  , Salesforce "), ["salesforce"]);
  for (const [headline, company, want] of [
    ["Product Marketer at Salesforce", "Salesforce", true],
    ["Senior Director @ HubSpot | MBA, Customer Success", "HubSpot", true],
    // The claim can sit past the first separator, where splitHeadline stops.
    ["AI Strategist | Growth Partner | Founder @ Salesforce Ventures", "AI Strategist", true],
    // Mentions and partners are the audience, and must survive.
    ["Salesforce MVP and certified architect", null, false],
    ["HubSpot AI Consultant | Revenue Hub | CRM Automation", null, false],
    ["Salesforce consultant at Acme Digital", "Acme Digital", false],
    ["Chief Growth Officer at Cloud Giants | Salesforce Leader", "Cloud Giants", false],
  ] as const) {
    check(`${want ? "exclude" : "keep   "} "${headline.slice(0, 44)}"`,
      isExcludedCompany(excl, company, headline) === want);
  }
  check("no terms means nothing is excluded",
    !isExcludedCompany([], "Salesforce", "Product Marketer at Salesforce"));

  // Headline parsing, on the shapes real LinkedIn headlines actually take.
  // Radar used to carry its own copy of this that split on " at " alone, so
  // "Account Executive @ Wise" imported with no company; measured on 288 real
  // event-search authors, sharing the parser and trimming the tail took the
  // company column from 30% filled to 43%.
  for (const [headline, wantPosition, wantCompany] of [
    ["Account Executive @ Wise", "Account Executive", "Wise"],
    ["VP Marketing at Meridian SaaS Labs", "VP Marketing", "Meridian SaaS Labs"],
    ["CEO @ Mediaplus North America | 2026 AdWeek 50 | Best Places to Work", "CEO", "Mediaplus North America"],
    ["Sr. Enterprise BDR @ Impartner | Partner Ecosystems | PRM", "Sr. Enterprise BDR", "Impartner"],
    ["Senior Director @ HubSpot — MBA, Customer Success", "Senior Director", "HubSpot"],
    // No employer stated: the company must stay EMPTY rather than absorb the
    // skills list, which is the honest answer for most of the remaining 57%.
    ["HubSpot AI Consultant | Revenue Hub | CRM Automation", "HubSpot AI Consultant | Revenue Hub | CRM Automation", null],
    ["", null, null],
    // The run-on: an employer followed straight by a pitch, with no separator
    // to cut at. Real names are short, so past 45 characters the first
    // comma-separated part is the name and the rest is prose.
    ["Founder @ SHRARA, GroPlus, AGM Infra Solutions enabling Digital, Sustainable & Scalable Business Models", "Founder", "SHRARA"],
    // Comfortably under the bar, so its comma is left alone.
    ["Partner at Booz Allen Hamilton, Inc.", "Partner", "Booz Allen Hamilton, Inc."],
  ] as const) {
    const got = splitHeadline(headline || null);
    eqCheck(`headline "${headline.slice(0, 34) || "(empty)"}"`,
      [got.position, got.company], [wantPosition, wantCompany]);
  }

  // The 1st-degree pool: network_distance is NULL for everyone who came from a
  // CSV or a sync, and that must read "1st" rather than blank or "null".
  const firstCsv = await buildRadarCsv(orgA, {
    metro: "sf-bay-area", days: 7, pool: "first", country: "united-states",
  });
  const firstRows = firstCsv.csv.trimEnd().split("\r\n").slice(1);
  const firstDegrees = firstRows.map((r) =>
    (r.match(/"(?:[^"]|"")*"/g) ?? [])[2]?.slice(1, -1));
  check("a connection with no stored degree exports as 1st",
    firstCsv.rows > 0 && firstDegrees.every((d) => d === "1st"),
    `rows=${firstCsv.rows} degrees=${[...new Set(firstDegrees)].join(",")}`);

  // The legacy shape: rows imported before the search path stored posts. The
  // link is genuinely unknown and must stay blank rather than be faked, but
  // mention_at still knows when the post was, so the date column holds up.
  const evtPeopleIds = (await db.select({ id: connection.id }).from(connection)
    .where(and(eq(connection.orgId, orgA), inArray(connection.networkDistance, ["2", "3"]))))
    .map((r) => r.id);
  const keptPosts = await db.select().from(post).where(inArray(post.connectionId, evtPeopleIds));
  await db.delete(post).where(inArray(post.connectionId, evtPeopleIds));
  const legacy = await buildRadarCsv(orgA, {
    metro: "sf-bay-area", days: 7, pool: "extended", country: "united-states",
  });
  const legacyCells = (legacy.csv.trimEnd().split("\r\n")[1]!.match(/"(?:[^"]|"")*"/g) ?? [])
    .map((c) => c.slice(1, -1).replace(/""/g, '"'));
  check("with no stored post the date still comes from the mention, and the link stays blank",
    legacy.rows === 2
    && /^\d{4}-\d{2}-\d{2}$/.test(legacyCells[7]!)
    && legacyCells[8] === ""
    && legacyCells[9]!.length > 0,
    `date=${legacyCells[7]} link=${JSON.stringify(legacyCells[8])} text=${(legacyCells[9] ?? "").slice(0, 24)}`);
  for (const row of keptPosts) {
    await db.insert(post).values(row).onConflictDoNothing();
  }

  // A post is someone's prose: commas, quotes and newlines are the norm, so
  // the escaping is what stops one person's text becoming three broken rows.
  const nastyText = 'He said "we\'re done", then\nnewlined, and, comma\'d.';
  // Must be one of the SEARCHED people: the 1st-degree scans above also stamp
  // mention_kind='event' on fixture connections, and those never appear in an
  // extended export, so picking one would silently test nothing.
  const [csvVictim] = await db.select({ id: connection.id }).from(connection)
    .where(and(eq(connection.orgId, orgA), eq(connection.mentionKind, "event"),
      inArray(connection.networkDistance, ["2", "3"]))).limit(1);
  await db.update(post).set({ text: nastyText })
    .where(eq(post.connectionId, csvVictim!.id));
  const nastyCsv = await buildRadarCsv(orgA, {
    metro: "sf-bay-area", days: 7, pool: "extended", country: "united-states",
  });
  const parsed = nastyCsv.csv.trimEnd().split("\r\n");
  // Splitting on the record separator must still yield header + 2 rows: the
  // embedded newline lives inside a quoted field and must not become a record.
  // And the text has to survive the round trip byte for byte, or the client
  // gets a spreadsheet that misquotes somebody.
  const nastyRecord = parsed.find((r) => r.includes('""we\'re done""')) ?? "";
  const nastyCells = (nastyRecord.match(/"(?:[^"]|"")*"/g) ?? [])
    .map((c) => c.slice(1, -1).replace(/""/g, '"'));
  check("quotes, commas and newlines in a post survive intact and break no rows",
    parsed.length === 3
    && nastyCsv.csv.includes('""we\'re done""')
    && nastyCells[9] === nastyText,
    `records=${parsed.length} roundtrip=${JSON.stringify(nastyCells[9] ?? "").slice(0, 60)}`);

  // No ICP means classifyBatch would throw AFTER importing 100 people. Refuse
  // before the first search request instead.
  const [activeOffer] = await db.select({ id: service.id }).from(service)
    .where(and(eq(service.orgId, orgA), eq(service.status, "active"))).limit(1);
  await db.update(service).set({ status: "archived" }).where(eq(service.orgId, orgA));
  const batchCountBefore = (await db.select({ id: connectionBatch.id }).from(connectionBatch)
    .where(eq(connectionBatch.orgId, orgA))).length;
  let refused = false;
  try {
    await runEventExtended(orgA, { country: "united-states", eventName: "Fixture Summit", days: 7, degree: "extended" });
  } catch { refused = true; }
  const batchCountAfter = (await db.select({ id: connectionBatch.id }).from(connectionBatch)
    .where(eq(connectionBatch.orgId, orgA))).length;
  check("with no active ICP the search refuses before importing anyone",
    refused && batchCountAfter === batchCountBefore,
    `refused=${refused} batches ${batchCountBefore} -> ${batchCountAfter}`);
  await db.update(service).set({ status: "active" }).where(eq(service.id, activeOffer!.id));

  // ── The social feed: the opposite of Today, deliberately ────────────────
  // Every assertion here is a gate Today HAS and this must not.
  //
  // buildFixture() has run again since `people`/`posts` were destructured at
  // the top (lines 893 and 916), and it mints fresh ids — the comment at 897
  // says exactly this. Re-read them rather than assert against rows that no
  // longer exist.
  const sfx = await buildFixture();
  const sp2 = sfx.people, spost = sfx.posts;
  // Most fixture people carry a scanSlot, i.e. "checked today", which is
  // precisely what the picker excludes. Free one non-pitchable person so the
  // picker assertion tests bucket-blindness rather than the freshness rule.
  await db.update(connection).set({ lastScanAt: null }).where(eq(connection.id, sp2.peer));
  const soc = await socialFeed(orgA, { days: 7 });
  const socNames = soc.rows.map((r) => r.firstName);
  const socIds = soc.rows.map((r) => r.connectionId);

  // 1. No bucket gate. A peer and an off-ICP person are real connections whose
  //    posts you might want to reply to; Today must never offer them and this
  //    must always show them.
  check("a peer_competitor's post is shown here though Today forbids it",
    socIds.includes(sp2.peer), `got ${JSON.stringify(socNames)}`);
  check("an off-ICP person's post is shown here too", socIds.includes(sp2.off_icp));
  // 2. No hook or relevance gate.
  check("an unjudged post is shown — no relevance needed to read someone's words",
    socIds.includes(sp2.unjudged));
  check("a congratulation scoring 0 is shown; it is a reason to react, not to sell",
    soc.rows.some((r) => r.postId === spost.asha_congrats));
  check("a substantive post under the sales bar is shown", socIds.includes(sp2.weak));
  // 3. No one-row-per-person collapse — the whole point of the screen.
  check("one person's several posts each get their own row",
    socNames.filter((n) => n === "Asha").length >= 2,
    `Asha rows=${socNames.filter((n) => n === "Asha").length}`);
  // 4. Workspace-wide, not campaign-scoped: Today excludes the older batch.
  check("it spans the workspace, not one campaign", socIds.includes(sp2.other_batch));
  // 5. But never another workspace.
  check("another workspace's post never appears", !socIds.includes(sp2.other_org));
  // 6. Newest first, and every row is inside the window.
  const socDates = soc.rows.map((r) => r.postedAt!.getTime());
  check("newest first", socDates.every((t, i) => i === 0 || socDates[i - 1]! >= t));
  check("every row is inside the window",
    soc.rows.every((r) => Date.now() - r.postedAt!.getTime() <= 7.5 * 86400_000));

  // 7. THE DEGREE GATE. Radar stamps '2'/'3' on strangers it finds and stores
  //    their posts; those are not your connections and must never appear here.
  const [stranger] = await db.insert(connection).values({
    orgId: orgA, batchId: batchA, firstName: "Stranger", lastName: "Second",
    companyRaw: "Stranger Industries", positionRaw: "VP Marketing",
    linkedinUrl: "https://www.linkedin.com/in/stranger_second",
    publicIdentifier: "stranger_second", memberId: "mock:stranger_second",
    networkDistance: "2", bucket: "excluded",
  }).returning({ id: connection.id });
  await db.insert(post).values({
    orgId: orgA, connectionId: stranger!.id, providerId: "fixture:stranger_post",
    text: "A 2nd-degree stranger's post, found by Radar and stored.",
    url: "https://example.invalid/stranger", postedAt: new Date(Date.now() - 86400_000),
  });
  const socNoStranger = await socialFeed(orgA, { days: 7 });
  check("a 2nd-degree stranger's post never appears — they are not a connection",
    !socNoStranger.rows.some((r) => r.connectionId === stranger!.id));
  // And NULL still means 1st degree, which is how every real row is stored.
  check("but NULL network_distance still counts as 1st degree",
    socNoStranger.rows.length > 0 && socIds.includes(sp2.three_posts));

  // 8. The window actually filters.
  const soc3 = await socialFeed(orgA, { days: 3 });
  const soc15 = await socialFeed(orgA, { days: 15 });
  check("a 12-day-old post is outside 3 days and inside 15",
    !soc3.rows.some((r) => r.postId === spost.asha_older_stronger)
    && soc15.rows.some((r) => r.postId === spost.asha_older_stronger),
    `3d=${soc3.rows.length} 15d=${soc15.rows.length}`);
  eqCheck("an unknown window falls back to the default rather than showing everything",
    [socialDays("999"), socialDays(""), socialDays(null), socialDays(7)], [7, 7, 7, 7]);

  // 9. Coverage must describe the SCAN, not the posts — that is what explains
  //    a short list.
  const scov = await socialCoverage(orgA, 7);
  check("coverage counts 1st-degree people and how many were checked",
    scov.firstDegree > 0 && scov.everScanned + scov.neverScanned === scov.firstDegree
    && scov.scansPerDayForWindow === Math.ceil(scov.firstDegree / 7),
    JSON.stringify(scov));
  check("the 2nd-degree stranger is not counted as a connection",
    scov.firstDegree === (await socialCoverage(orgA, 15)).firstDegree);

  // 10. The picker: workspace-wide, bucket-blind, 1st degree, reachable.
  const socTargets = await pickSocialTargets(orgA, 50);
  const socTargetIds = socTargets.map((t) => t.id);
  check("the picker reaches non-pitchable people, which pickScanTargets cannot",
    socTargetIds.includes(sp2.peer) || socTargetIds.includes(sp2.off_icp),
    `${socTargetIds.length} targets`);
  check("the picker never offers a 2nd-degree stranger",
    !socTargetIds.includes(stranger!.id));
  check("and never someone already checked today",
    !socTargetIds.includes(sp2.three_posts),
    `three_posts scanned today, targets=${socTargetIds.length}`);

  await db.delete(post).where(eq(post.connectionId, stranger!.id));
  await db.delete(connection).where(eq(connection.id, stranger!.id));

  // ── The reaper: what a deploy leaves behind ──────────────────────────────
  // Placed after the foreign-workspace guard on purpose — sweepDeadJobs is
  // global by design, so it must not run while a stranger holds a live job.
  //
  // Ages are driven off DEAD_AFTER_SECONDS, never a literal, so nobody can
  // widen the window and leave these checks silently testing nothing.
  const dead = new Date(Date.now() - (DEAD_AFTER_SECONDS + 30) * 1000);
  const mkJob = async (kind: string, status: string, updatedAt: Date, payload = {}) => {
    const [row] = await db.insert(job).values({ orgId: orgA, kind, payloadJson: payload }).returning({ id: job.id });
    await db.update(job).set({ status, updatedAt }).where(eq(job.id, row!.id));
    return row!.id;
  };

  // THE ONE THAT MATTERS MOST: a queued job has no process attached, so age is
  // meaningless for it. Sweeping it would delete work nobody had started.
  await db.delete(job).where(inArray(job.orgId, [orgA, orgB]));
  const qOld = await mkJob("post_judge", "queued", dead, {});
  // Fresh rows are held by a LIVE process and must survive untouched.
  const rFresh = await mkJob("activity_scan", "running", new Date());
  const sFresh = await mkJob("activity_scan", "stopping", new Date());
  // Terminal rows must be unreachable by construction, not by convention.
  const doneOld = await mkJob("post_judge", "done", dead);
  const [doneBefore] = await db.select().from(job).where(eq(job.id, doneOld));

  const statusOf = async (id: string) => (await db.select({ s: job.status, e: job.error, u: job.updatedAt })
    .from(job).where(eq(job.id, id)))[0]!;
  const sweptNone = await sweepDeadJobs();
  check("a live run is never swept while it is beating", sweptNone === 0, `swept=${sweptNone}`);
  eqCheck("a QUEUED job survives any age — it has no process to lose",
    (await statusOf(qOld)).s, "queued");
  // and it must still RUN, not merely still be labelled queued
  const ranIt = await processNext();
  check("the surviving queued job actually executes",
    ranIt === true && (await statusOf(qOld)).s !== "queued",
    `ran=${ranIt} status=${(await statusOf(qOld)).s}`);
  eqCheck("a fresh running row is untouched", (await statusOf(rFresh)).s, "running");
  eqCheck("a fresh stopping row is untouched", (await statusOf(sFresh)).s, "stopping");
  const doneAfter = await statusOf(doneOld);
  check("a terminal row is byte-identical after a sweep, updated_at included",
    doneAfter.s === "done" && doneAfter.u!.getTime() === doneBefore!.updatedAt!.getTime());

  // Now age the two live rows past the window: their process has died.
  await db.update(job).set({ updatedAt: dead }).where(inArray(job.id, [rFresh, sFresh]));
  // A worker must never sweep the row IT is holding, however late its beat.
  const sweptMine = await sweepDeadJobs(rFresh);
  eqCheck("the row this process holds is spared even when overdue",
    (await statusOf(rFresh)).s, "running");
  check("…and the other dead row still goes", sweptMine === 1, `swept=${sweptMine}`);
  eqCheck("a stop the worker died before acknowledging still reads as stopped",
    (await statusOf(sFresh)).s, "stopped");
  const swept2 = await sweepDeadJobs();
  const abandoned = await statusOf(rFresh);
  check("an interrupted run fails with an explanation, not silently",
    swept2 === 1 && abandoned.s === "failed" && (abandoned.e ?? "").includes("restarted or was deployed"),
    `swept=${swept2} status=${abandoned.s} err=${abandoned.e}`);
  // A draining worker's late write must not clobber the sweep's account. This
  // calls the REAL markStopped — re-implementing its guard here would test
  // nothing, which is exactly how the first version of this check passed while
  // the guard was deleted.
  await markStopped(rFresh, 3, 40);
  const late = await statusOf(rFresh);
  check("a late markStopped cannot overwrite an abandoned run's explanation",
    late.s === "failed" && (late.e ?? "").includes("restarted or was deployed"),
    `status=${late.s} err=${late.e}`);
  await db.delete(job).where(inArray(job.id, [qOld, rFresh, sFresh, doneOld]));

  await db.delete(channelAccount).where(eq(channelAccount.id, radarSeat!.id));
  await buildFixture();
  const [leftover] = await db.select({ n: sql<number>`count(*)::int` }).from(channelAccount)
    .where(eq(channelAccount.orgId, orgA));
  const after = await foreignCensus();
  check("the run leaves nothing of its own behind, and no other workspace's rows moved",
    leftover!.n === 0 && JSON.stringify(after) === JSON.stringify(before),
    `seats=${leftover!.n} · before ${JSON.stringify(before)} · after ${JSON.stringify(after)}`);

  console.log("");
  if (failures.length) {
    console.log(`${passed}/${n} checks passed — ${failures.length} FAILED:`);
    for (const f of failures) console.log(`  · ${f}`);
    process.exit(1);
  }
  console.log(`${passed}/${n} checks passed.`);
  process.exit(0);
}



main().catch((e) => { console.error(e); process.exit(1); });
