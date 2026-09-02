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
import { eq, inArray } from "drizzle-orm";
import {
  db, org, accountShortlist, activityLog, appUser, channelAccount, connectionBatch,
  connection, exportLog, job, networkSnapshot, novaChat, novaChatMessage, post, service,
} from "../src/db";
import type { IcpJson } from "../src/db/schema";

const HOUR = 3600_000;
const DAY = 86_400_000;

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

export async function buildFixture(): Promise<Fixture> {
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
    scannedHoursAgo?: number | null; lastPostDaysAgo?: number | null;
  };

  const people: Person[] = [
    // three good posts, one person — the dedupe case
    { key: "three_posts", first: "Asha", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 1, tier: 1, enrich: "pending", scannedHoursAgo: 2, lastPostDaysAgo: 1 },
    // drafted but unsent: a fresh hook is a reason to send TODAY
    { key: "drafted", first: "Rahul", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 2, tier: 1, enrich: "done", message: true, scannedHoursAgo: 3, lastPostDaysAgo: 2 },
    // posts stored, never judged — must read as "not read yet", not "not interesting"
    { key: "unjudged", first: "Meera", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 3, tier: 1, enrich: "pending", scannedHoursAgo: 1, lastPostDaysAgo: 1 },
    // a peer with a brilliant post — judging skips peers, and the feed must too
    { key: "peer", first: "Vikram", batch: batchA!.id, org: orgA, bucket: "peer_competitor", rank: 4, enrich: "pending", scannedHoursAgo: 4, lastPostDaysAgo: 1 },
    // off-ICP with a strong post
    { key: "off_icp", first: "Priya", batch: batchA!.id, org: orgA, bucket: "off_icp", rank: 5, enrich: "pending", scannedHoursAgo: 4, lastPostDaysAgo: 1 },
    // never scanned, no posts — the frontier
    { key: "never_scanned", first: "Karthik", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 6, tier: 2, enrich: "pending", scannedHoursAgo: null, lastPostDaysAgo: null },
    // already messaged
    { key: "sent", first: "Divya", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 7, tier: 2, enrich: "done", message: true, sent: true, scannedHoursAgo: 5, lastPostDaysAgo: 1 },
    // judged, substantive, but below the hook threshold
    { key: "weak", first: "Arjun", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 8, tier: 2, enrich: "pending", scannedHoursAgo: 6, lastPostDaysAgo: 3 },
    // a strong hook that has decayed past the 14-day window
    { key: "stale", first: "Sneha", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 9, tier: 2, enrich: "pending", scannedHoursAgo: 24 * 20, lastPostDaysAgo: 40 },
    // flagged as needing a decision, with a good post
    { key: "flagged", first: "Manoj", batch: batchA!.id, org: orgA, bucket: "pitchable", rank: 10, tier: 2, enrich: "done", message: true, flag: "appears to have left the company", scannedHoursAgo: 7, lastPostDaysAgo: 2 },
    // same workspace, different batch
    { key: "other_batch", first: "Gita", batch: batchA2!.id, org: orgA, bucket: "pitchable", rank: 1, tier: 1, enrich: "pending", scannedHoursAgo: 2, lastPostDaysAgo: 1 },
    // different workspace entirely
    { key: "other_org", first: "Zane", batch: batchB!.id, org: orgB, bucket: "pitchable", rank: 1, tier: 1, enrich: "pending", scannedHoursAgo: 1, lastPostDaysAgo: 1 },
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
      lastScanAt: p.scannedHoursAgo == null ? null : new Date(now - p.scannedHoursAgo * HOUR),
      lastPostAt: p.lastPostDaysAgo == null ? null : new Date(now - p.lastPostDaysAgo * DAY),
    }).returning({ id: connection.id });
    ids[p.key] = row!.id;
  }

  type P = {
    key: string; who: string; org: string; text: string; daysAgo: number;
    relevance: number | null; category: string | null; hook: string | null; judged: boolean;
  };
  const rows: P[] = [
    // Asha: three posts. The 84 from yesterday must win the 92 from 12 days ago
    // after decay, and the congratulation must never surface.
    { key: "asha_fresh", who: "three_posts", org: orgA, daysAgo: 1, relevance: 84, category: "substantive", hook: "They said the attribution model cannot explain half the pipeline.", judged: true,
      text: "Our attribution model still can't explain half the pipeline. Boards want certainty; buyers want fewer forms." },
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
    { key: "off_icp_hook", who: "off_icp", org: orgA, daysAgo: 1, relevance: 90, category: "substantive", hook: "An off-target person's post that must never surface.", judged: true,
      text: "Coaching founders to find their zone of genius." },
    { key: "sent_hook", who: "sent", org: orgA, daysAgo: 1, relevance: 80, category: "substantive", hook: "They posted again after we messaged them.", judged: true,
      text: "Following up on last week's thread about pipeline forecasting." },
    { key: "weak_post", who: "weak", org: orgA, daysAgo: 3, relevance: 40, category: "substantive", hook: null, judged: true,
      text: "Nice weather for a walk between calls." },
    { key: "stale_hook", who: "stale", org: orgA, daysAgo: 40, relevance: 88, category: "substantive", hook: "A strong hook that is far too old to open with.", judged: true,
      text: "Forty days ago we rebuilt the whole funnel and nobody noticed." },
    { key: "flagged_hook", who: "flagged", org: orgA, daysAgo: 2, relevance: 79, category: "substantive", hook: "They are hiring for a role that suggests a new mandate.", judged: true,
      text: "Building out a new revenue operations function from scratch this quarter." },
    { key: "other_batch_hook", who: "other_batch", org: orgA, daysAgo: 1, relevance: 99, category: "substantive", hook: "Belongs to the older batch in the same workspace.", judged: true,
      text: "The strongest hook in the workspace, but in a different batch." },
    { key: "other_org_hook", who: "other_org", org: orgB, daysAgo: 0, relevance: 100, category: "substantive", hook: "Another workspace's hook — never visible here.", judged: true,
      text: "A perfect hook that belongs to a different workspace entirely." },
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
