/**
 * Verification harness for the post-hook dashboard (layer 04).
 *
 *   npx tsx scripts/verify-hook-feed.ts      # local Postgres only
 *
 * The screen's whole claim is "here is someone worth messaging today, and here
 * are their own words". That claim is only checkable against rows whose right
 * answer is known by construction, so this builds two workspaces where every
 * interesting case is present and labelled: a person with three posts (must
 * appear ONCE, with the post that wins after decay), a peer whose post is
 * brilliant (must never be offered — judging skips peers and so must the feed),
 * posts that were stored but never judged (must read as "not read yet", never
 * as "not interesting"), a post below the hook threshold, a strong hook that
 * has decayed past the 14-day window, someone already messaged, someone never
 * scanned, a second batch in the same workspace, and a second workspace whose
 * perfect hook must never be visible.
 *
 * Writes rows, so it refuses to run against anything but a local database.
 */
import "./require-local-db";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db, org, accountShortlist, activityLog, appUser, channelAccount, connectionBatch,
  connection, exportLog, job, networkSnapshot, novaChat, novaChatMessage, post, service,
} from "../src/db";
import type { IcpJson } from "../src/db/schema";

const HOUR = 3600_000;
const DAY = 86_400_000;

/** Scan stamps are anchored to UTC MIDNIGHT, not to `now`.
 *
 *  The daily brake counts people stamped since UTC midnight, so a fixture that
 *  said "scanned 3 hours ago" put its people on the wrong side of that boundary
 *  whenever the suite ran before 07:00 UTC — four checks went red for no reason
 *  but the wall clock. Anchoring makes "scanned today" true by construction at
 *  every hour; the `min(..., now - 1min)` keeps the stamp in the past when the
 *  suite runs just after midnight. */
function stampToday(slot: number): Date {
  const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
  return new Date(Math.min(midnight.getTime() + 30 * 60_000 + slot * 10 * 60_000, Date.now() - 60_000));
}
function stampDaysBeforeToday(days: number): Date {
  const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
  return new Date(midnight.getTime() - days * DAY + HOUR);
}

const ICP: IcpJson = {
  summary: "B2B marketing leaders who own pipeline.",
  fit_signals: ["owns demand generation"],
  pain_points: ["attribution"],
  personas: [{
    slug: "cmo", name: "Marketing leader",
    title_include: ["marketing", "growth"], title_exclude: [],
    seniority: ["cxo", "vp"], function_tags: ["marketing"],
  }],
  disqualifiers: [],
};

export interface Fixture {
  orgA: string;
  orgB: string;
  batchA: string;
  batchA2: string;
  batchB: string;
  people: Record<string, string>;
  posts: Record<string, string>;
  now: number;
}

/** Wipe anything a previous run of this fixture left behind.
 *
 *  The fixture OWNS the l4org* workspaces outright, so everything hanging off
 *  them goes — including any login created to open the screen by hand, and any
 *  Nova chat held as that login, both of which hold a foreign key into org and
 *  would otherwise make the rebuild fail on the second run. */
async function reset() {
  const orgs = await db.select({ id: org.id }).from(org);
  const mine = orgs.filter((o) => o.id.startsWith("l4org")).map((o) => o.id);
  if (mine.length === 0) return;
  await db.delete(post).where(inArray(post.orgId, mine));
  await db.delete(job).where(inArray(job.orgId, mine));
  await db.delete(connection).where(inArray(connection.orgId, mine));
  await db.delete(connectionBatch).where(inArray(connectionBatch.orgId, mine));
  await db.delete(service).where(inArray(service.orgId, mine));
  await db.delete(channelAccount).where(inArray(channelAccount.orgId, mine));
  const chats = await db.select({ id: novaChat.id }).from(novaChat).where(inArray(novaChat.orgId, mine));
  if (chats.length > 0) {
    await db.delete(novaChatMessage).where(inArray(novaChatMessage.chatId, chats.map((c) => c.id)));
    await db.delete(novaChat).where(inArray(novaChat.orgId, mine));
  }
  await db.delete(appUser).where(inArray(appUser.orgId, mine));
  // Everything else that holds a foreign key into org and accumulates just by
  // USING the workspace — a login writes an activity_log row, opening a page
  // writes a snapshot — each of which would block the org delete on the next run.
  await db.delete(activityLog).where(inArray(activityLog.orgId, mine));
  await db.delete(networkSnapshot).where(inArray(networkSnapshot.orgId, mine));
  await db.delete(exportLog).where(inArray(exportLog.orgId, mine));
  await db.delete(accountShortlist).where(inArray(accountShortlist.orgId, mine));
  for (const id of mine) await db.delete(org).where(eq(org.id, id));
}

/** Taken once per process, never released.
 *
 *  Advisory locks are per SESSION and drizzle runs on a pool, so a second
 *  buildFixture() in the same process lands on a different connection which
 *  cannot see the lock this process already holds — and would refuse its own
 *  run. One flag, checked before the lock. */
let holdsFixtureLock = false;

export async function buildFixture(): Promise<Fixture> {
  // Fixed primary keys plus an unconditional reset() means two overlapping runs
  // destroy each other's rows mid-flight, and one of them then reports a green
  // suite over data the other rebuilt.
  if (!holdsFixtureLock) {
    const [lock] = await db.execute(sql`select pg_try_advisory_lock(hashtext('verify-hook-feed')) as ok`)
      .then((r) => r.rows as { ok: boolean }[]);
    if (!lock?.ok) {
      throw new Error("Another verify-hook-feed run holds the fixture lock — wait for it to finish.");
    }
    holdsFixtureLock = true;
  }
  await reset();
  const now = Date.now();

  const orgA = "l4orgA";
  const orgB = "l4orgB";
  await db.insert(org).values([
    { id: orgA, name: "Layer4 Workspace A", settingsJson: { enrichLimit: 10, classifyLlmPeopleCap: 1000, postScanDailyCap: 100 } },
    { id: orgB, name: "Layer4 Workspace B", settingsJson: { enrichLimit: 10, classifyLlmPeopleCap: 1000 } },
  ]);
  await db.insert(service).values([
    { orgId: orgA, slug: "demand-gen", name: "Demand generation", icpJson: ICP },
    { orgId: orgB, slug: "leadership", name: "Leadership development", icpJson: ICP },
  ]);

  const [batchA] = await db.insert(connectionBatch).values({
    id: "l4batchA", orgId: orgA, source: "csv", label: "Fixture batch A", statsJson: { imported: 9 },
  }).returning();
  // A second, OLDER batch in the same workspace: the campaign switcher must not
  // leak its people into batch A's feed, and a person in it must not be
  // double-counted.
  const [batchA2] = await db.insert(connectionBatch).values({
    id: "l4batchA2", orgId: orgA, source: "sync", label: "Fixture batch A (older)", statsJson: { imported: 1 },
  }).returning();
  const [batchB] = await db.insert(connectionBatch).values({
    id: "l4batchB", orgId: orgB, source: "csv", label: "Fixture batch B", statsJson: { imported: 1 },
  }).returning();

  type Person = {
    key: string; first: string; batch: string; org: string;
    bucket: string | null; rank?: number; tier?: number; enrich?: string;
    message?: boolean; sent?: boolean; flag?: string; verdict?: string;
    scanSlot?: number | null; scanDaysAgo?: number | null; lastPostDaysAgo?: number | null;
  };

  const people: Person[] = [
    // three good posts, one person — the dedupe case
    { key: "three_posts", first: "Asha", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 1, tier: 1, enrich: "pending", scanSlot: 5, lastPostDaysAgo: 1 },
    // drafted but unsent: a fresh hook is a reason to send TODAY
    { key: "drafted", first: "Rahul", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 2, tier: 1, enrich: "done", message: true, scanSlot: 4, lastPostDaysAgo: 2 },
    // posts stored, never judged — must read as "not read yet", not "not interesting"
    { key: "unjudged", first: "Meera", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 3, tier: 1, enrich: "pending", scanSlot: 6, lastPostDaysAgo: 1 },
    // a peer with a brilliant post — judging skips peers, and the feed must too
    { key: "peer", first: "Vikram", batch: batchA!.id, org: orgA, bucket: "peer_competitor", rank: 4, enrich: "pending", scanSlot: 3, lastPostDaysAgo: 1 },
    // off-ICP with a strong post
    { key: "off_icp", first: "Priya", batch: batchA!.id, org: orgA, bucket: "off_icp", rank: 5, enrich: "pending", scanSlot: 3, lastPostDaysAgo: 1 },
    // never scanned, no posts — the frontier
    { key: "never_scanned", first: "Karthik", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 6, tier: 2, enrich: "pending", scanSlot: null, lastPostDaysAgo: null },
    // already messaged
    { key: "sent", first: "Divya", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 7, tier: 2, enrich: "done", message: true, sent: true, scanSlot: 2, lastPostDaysAgo: 1 },
    // judged, substantive, but below the hook threshold
    { key: "weak", first: "Arjun", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 8, tier: 2, enrich: "pending", scanSlot: 1, lastPostDaysAgo: 3 },
    // a strong hook that has decayed past the 14-day window
    { key: "stale", first: "Sneha", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 9, tier: 2, enrich: "pending", scanDaysAgo: 20, lastPostDaysAgo: 40 },
    // scanned days ago but INSIDE the decay window: the row that separates the
    // recency split from the not-today set, so a boundary swap cannot pass.
    { key: "scanned_3d", first: "Latha", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 11, tier: 2, enrich: "pending", scanDaysAgo: 3, lastPostDaysAgo: null },
    // flagged as needing a decision, with a good post
    { key: "flagged", first: "Manoj", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 10, tier: 2, enrich: "done", message: true, flag: "appears to have left the company", scanSlot: 0, lastPostDaysAgo: 2 },
    // same workspace, different batch
    { key: "other_batch", first: "Gita", batch: batchA2!.id, org: orgA, bucket: "pitchable", rank: 1, tier: 1, enrich: "pending", scanSlot: 5, lastPostDaysAgo: 1 },
    // different workspace entirely
    { key: "other_org", first: "Zane", batch: batchB!.id, org: orgB, bucket: "pitchable", rank: 1, tier: 1, enrich: "pending", scanSlot: 6, lastPostDaysAgo: 1 },
  ];

  const ids: Record<string, string> = {};
  for (const p of people) {
    const [row] = await db.insert(connection).values({
      orgId: p.org, batchId: p.batch,
      firstName: p.first, lastName: "Fixture",
      companyRaw: "Fixture Co", positionRaw: "VP Marketing",
      linkedinUrl: `https://www.linkedin.com/in/${p.key}`,
      publicIdentifier: p.key, memberId: `mock:${p.key}`,
      location: "Bengaluru, Karnataka, India", country: "India",
      bucket: p.bucket, serviceSlug: p.bucket === "pitchable" ? "demand-gen" : null,
      matchConfidence: 80, matchWhy: "fixture", matchMethod: "rule",
      score: 100 - (p.rank ?? 0), tier: p.tier ?? null, rank: p.rank ?? null,
      enrichStatus: p.enrich ?? "pending",
      outreachMessage: p.message ? "Fixture draft message." : null,
      sentAt: p.sent ? new Date(now - 6 * HOUR) : null,
      outreachStatus: p.sent ? "sent" : null,
      flag: p.flag ?? null, flagVerdict: p.verdict ?? null,
      enrichedAt: p.enrich === "done" ? new Date(now - 2 * DAY) : null,
      lastScanAt: p.scanDaysAgo != null ? stampDaysBeforeToday(p.scanDaysAgo)
        : p.scanSlot != null ? stampToday(p.scanSlot) : null,
      lastPostAt: p.lastPostDaysAgo == null ? null : new Date(now - p.lastPostDaysAgo * DAY),
    }).returning({ id: connection.id });
    ids[p.key] = row!.id;
  }

  type P = {
    key: string; who: string; org: string; text: string; daysAgo: number;
    relevance: number | null; category: string | null; hook: string | null; judged: boolean;
  };
  const rows: P[] = [
    // Asha: three posts. The 84 from a day and a half ago must win the 92 from
    // 12 days ago after decay, and the congratulation must never surface. The
    // 1.5 makes the age fractional, which is what the disclosure has to print.
    { key: "asha_fresh", who: "three_posts", org: orgA, daysAgo: 1.5, relevance: 84, category: "substantive", hook: "They said the attribution model cannot explain half the pipeline.", judged: true,
      // Deliberately long (616 chars): the excerpt the reader sees is cut in
      // SQL, so something here has to be longer than that cut.
      text: "Our attribution model still can't explain half the pipeline. Boards want certainty; buyers want fewer forms. We spent the quarter rebuilding the model from the session level up, and the honest answer is that multi-touch attribution cannot survive a buying committee that does most of its research without ever identifying itself. So we stopped trying to explain every deal and started instrumenting the handful of moments that actually change a decision: the pricing conversation, the security review, and the reference call. It is less tidy and far more useful, and it has already changed where we spend the budget." },
    { key: "asha_older_stronger", who: "three_posts", org: orgA, daysAgo: 12, relevance: 92, category: "substantive", hook: "They cut the content calendar in half and doubled engagement.", judged: true,
      text: "We cut our content calendar in half and doubled engagement. Less, but sharper, wins in B2B." },
    { key: "asha_congrats", who: "three_posts", org: orgA, daysAgo: 0, relevance: 0, category: "congrats", hook: null, judged: true,
      text: "Huge congratulations to the team on the award!" },
    { key: "rahul_hook", who: "drafted", org: orgA, daysAgo: 2, relevance: 76, category: "substantive", hook: "They are rebuilding the demand engine with half the team.", judged: true,
      text: "Rebuilding the demand engine with half the team we had last year. Ask me how that's going." },
    { key: "meera_unjudged_a", who: "unjudged", org: orgA, daysAgo: 1, relevance: null, category: null, hook: null, judged: false,
      text: "Spent the morning arguing about lead scoring again." },
    { key: "meera_unjudged_b", who: "unjudged", org: orgA, daysAgo: 2, relevance: null, category: null, hook: null, judged: false,
      text: "Second unjudged post, same person." },
    { key: "peer_hook", who: "peer", org: orgA, daysAgo: 1, relevance: 95, category: "substantive", hook: "A peer's post that must never be offered as a reason to reach out.", judged: true,
      text: "We just launched our own ABM practice — competitors, take note." },
    // Unjudged posts belonging to people judgePosts will never select. If the
    // pitchable join is ever dropped from waitingToRead or feedStatus, these
    // are what make the numbers move.
    { key: "peer_unjudged", who: "peer", org: orgA, daysAgo: 1, relevance: null, category: null, hook: null, judged: false,
      text: "A peer's unjudged post — the read queue must never count it." },
    { key: "off_icp_hook", who: "off_icp", org: orgA, daysAgo: 1, relevance: 90, category: "substantive", hook: "An off-target person's post that must never surface.", judged: true,
      text: "Coaching founders to find their zone of genius." },
    { key: "off_icp_unjudged", who: "off_icp", org: orgA, daysAgo: 2, relevance: null, category: null, hook: null, judged: false,
      text: "An off-target person's unjudged post — likewise never counted." },
    { key: "sent_hook", who: "sent", org: orgA, daysAgo: 1, relevance: 80, category: "substantive", hook: "They posted again after we messaged them.", judged: true,
      text: "Following up on last week's thread about pipeline forecasting." },
    { key: "weak_post", who: "weak", org: orgA, daysAgo: 3, relevance: 40, category: "substantive", hook: null, judged: true,
      text: "Nice weather for a walk between calls." },
    { key: "stale_hook", who: "stale", org: orgA, daysAgo: 40, relevance: 88, category: "substantive", hook: "A strong hook that is far too old to open with.", judged: true,
      text: "Forty days ago we rebuilt the whole funnel and nobody noticed." },
    // Just outside the 14-day window: the row that catches HOOK_DECAY_DAYS
    // drifting away from the 14 inside HOOK_SCORE_SQL.
    { key: "decay_edge", who: "stale", org: orgA, daysAgo: 20, relevance: 88, category: "substantive", hook: "Twenty days old — inside a 28-day window, outside a 14-day one.", judged: true,
      text: "Twenty days ago we changed how we forecast, and it is still settling." },
    { key: "flagged_hook", who: "flagged", org: orgA, daysAgo: 2, relevance: 79, category: "substantive", hook: "They are hiring for a role that suggests a new mandate.", judged: true,
      text: "Building out a new revenue operations function from scratch this quarter." },
    { key: "other_batch_hook", who: "other_batch", org: orgA, daysAgo: 1, relevance: 99, category: "substantive", hook: "Belongs to the older batch in the same workspace.", judged: true,
      text: "The strongest hook in the workspace, but in a different batch." },
    { key: "other_org_hook", who: "other_org", org: orgB, daysAgo: 0, relevance: 100, category: "substantive", hook: "Another workspace's hook — never visible here.", judged: true,
      text: "A perfect hook that belongs to a different workspace entirely." },
    { key: "other_org_unjudged", who: "other_org", org: orgB, daysAgo: 1, relevance: null, category: null, hook: null, judged: false,
      text: "Another workspace's unjudged post — org A's read queue must not see it." },
  ];

  const postIds: Record<string, string> = {};
  for (const r of rows) {
    const [row] = await db.insert(post).values({
      orgId: r.org,
      connectionId: ids[r.who]!,
      providerId: `fixture:${r.key}`,
      text: r.text,
      url: `https://www.linkedin.com/feed/update/${r.key}`,
      postedAt: new Date(now - r.daysAgo * DAY),
      relevance: r.relevance,
      category: r.category,
      hook: r.hook,
      judgedAt: r.judged ? new Date(now - r.daysAgo * DAY + HOUR) : null,
    }).returning({ id: post.id });
    postIds[r.key] = row!.id;
  }

  return { orgA, orgB, batchA: batchA!.id, batchA2: batchA2!.id, batchB: batchB!.id, people: ids, posts: postIds, now };
}

// Exact basename: "verify-hook-feed-checks.ts" imports this module, and a
// substring guard would build the fixture twice, concurrently, and deadlock on
// its own primary keys.
if (process.argv[1]?.endsWith("verify-hook-feed.ts")) {
  buildFixture().then((f) => {
    console.log("fixture built:", JSON.stringify({ orgA: f.orgA, batchA: f.batchA, people: Object.keys(f.people).length, posts: Object.keys(f.posts).length }, null, 2));
    process.exit(0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
