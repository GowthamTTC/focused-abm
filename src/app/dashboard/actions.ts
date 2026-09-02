"use server";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { db, connection, channelAccount, job, service } from "@/db";
import { requireUser } from "@/auth/session";
import { enqueue } from "@/jobs/runner";
import { getOrgSettings, updateOrgSettings, clampToLimit } from "@/modules/settings/org-settings";
import { markSelection } from "@/modules/matching/service-fit";
import { getDailyEnrichUsage } from "@/modules/enrich/usage";
import { getDailyScanUsage } from "@/modules/posts/usage";
import { pickHookFrontier, pickScanTargets, waitingToRead } from "@/modules/posts/feed";
import { enrichOnePerson } from "@/modules/accounts/shortlist";

/** Any run at all, not just a competing one.
 *
 *  enqueue() is a bare INSERT with no dedupe, the worker runs ONE job at a time
 *  FIFO with no org filter, and the shell banner shows only the newest job and
 *  binds its Stop button to that. So a second enqueue does not just wait — it
 *  hijacks the banner and re-points Stop at the wrong run. Matching any kind is
 *  the right conservatism. Checked inside the action, not only at render:
 *  a stale tab or a double submit never reaches the render guard. */
async function runningJob(orgId: string) {
  const [row] = await db.select({ id: job.id, kind: job.kind }).from(job)
    .where(and(eq(job.orgId, orgId), inArray(job.status, ["queued", "running", "stopping"])))
    .limit(1);
  return row ?? null;
}

/** One-click morning ritual: select the next tranche (guardrail-clamped,
 *  default 30) AND queue the enrichment run. The daily cap still rules the
 *  worker — leftovers wait for the reset. */
/** The sentence-form picker: "Research my top [N] matches [in country]
 *  [who posted recently]". Selects by rank WITHIN the filters, then runs. */
export async function researchPick(batchId: string, formData: FormData) {
  const user = await requireUser();
  const { enrichLimit } = await getOrgSettings(user.orgId);
  const want = Number(formData.get("n") ?? 30) || 30;
  const country = String(formData.get("country") ?? "").trim();
  const posted = String(formData.get("posted") ?? "any");
  const n = clampToLimit(Math.min(Math.max(want, 1), 80), enrichLimit);
  await updateOrgSettings(user.orgId, { pickN: want, pickCountry: country, pickPosted: posted });

  // "who posted something you can open with" — the only branch that changes
  // WHERE the day's budget goes: strongest live reason first, fit rank second.
  // Its own empty message, because the sentence below talks about countries and
  // activity windows and would be a lie here.
  if (posted === "hook") {
    const next = await pickHookFrontier(user.orgId, batchId, n, country);
    if (next.length === 0) redirect(`/dashboard?c=${batchId}&picked=0&why=hook`);
    const ids = next.map((t) => t.id);
    await markSelection(batchId, ids, true);
    await enqueue(user.orgId, "deep_enrich", { connectionIds: ids });
    redirect(`/dashboard?c=${batchId}&picked=${ids.length}`);
  }

  // The frontier is "never researched", NOT "never selected". A tranche that
  // died against the daily cap left rows flagged selected forever — they were
  // then skipped by every later pick, so the pool silently shrank.
  const conds = [
    eq(connection.orgId, user.orgId), eq(connection.batchId, batchId),
    eq(connection.bucket, "pitchable"), eq(connection.enrichStatus, "pending"),
  ];
  if (country) conds.push(eq(connection.country, country));
  if (posted === "7" || posted === "30") {
    conds.push(sql`last_post_at >= now() - (${posted + " days"})::interval`);
  }
  const next = await db.select({ id: connection.id }).from(connection)
    .where(and(...conds)).orderBy(asc(connection.rank)).limit(n);
  if (next.length === 0) redirect(`/dashboard?c=${batchId}&picked=0`);
  const ids = next.map((t) => t.id);
  await markSelection(batchId, ids, true);
  // Enqueue EXACTLY what was picked. Sweeping up every 'queued' row meant one
  // stuck tranche rode along with every later run — "my top 10" quietly became
  // 86 people and the number on screen stopped meaning anything.
  await enqueue(user.orgId, "deep_enrich", { connectionIds: ids });
  redirect(`/dashboard?c=${batchId}&picked=${ids.length}`);
}

export async function runTodaysTranche(batchId: string) {
  const user = await requireUser();
  const { enrichLimit } = await getOrgSettings(user.orgId);
  const n = clampToLimit(30, enrichLimit);
  const next = await db.select({ id: connection.id }).from(connection)
    .where(and(eq(connection.orgId, user.orgId), eq(connection.batchId, batchId),
      eq(connection.bucket, "pitchable"), eq(connection.enrichStatus, "pending")))
    .orderBy(asc(connection.rank)).limit(n);
  if (next.length > 0) {
    const ids = next.map((t) => t.id);
    await markSelection(batchId, ids, true);
    await enqueue(user.orgId, "deep_enrich", { connectionIds: ids });
  }
  redirect(`/dashboard?c=${batchId}`);
}

export async function markSent(batchId: string, connId: string) {
  const user = await requireUser();
  await db.update(connection).set({ outreachStatus: "sent", sentAt: new Date() })
    .where(and(eq(connection.orgId, user.orgId), eq(connection.id, connId)));
  redirect(`/dashboard?c=${batchId}`);
}

/** Flag-inbox verdicts: dropped (out of pipeline) · verify (parked for human
 *  verification) · variant (the honest-variant message goes to the queue). */
export async function flagVerdict(batchId: string, connId: string, verdict: "dropped" | "verify" | "variant") {
  const user = await requireUser();
  await db.update(connection).set({ flagVerdict: verdict })
    .where(and(eq(connection.orgId, user.orgId), eq(connection.id, connId), isNull(connection.flagVerdict)));
  redirect(`/dashboard?c=${batchId}`);
}

/** Undo a mistaken "Mark sent" — the person returns to the send queue. */
export async function undoSent(batchId: string, connId: string) {
  const user = await requireUser();
  await db.update(connection).set({ outreachStatus: null, sentAt: null })
    .where(and(eq(connection.orgId, user.orgId), eq(connection.id, connId)));
  redirect(`/dashboard?c=${batchId}`);
}

/** "Check for new posts now" — lightweight activity scan over the send queue:
 *  posts only, no LLM. Refreshes lastPostAt so activity badges and the
 *  recent/older filter reflect today, not enrichment day. */
export async function checkQueuePosts(batchId: string) {
  const user = await requireUser();
  const targets = await db.select({ id: connection.id }).from(connection)
    .where(and(eq(connection.orgId, user.orgId), eq(connection.batchId, batchId),
      eq(connection.enrichStatus, "done"), isNull(connection.sentAt)))
    .orderBy(sql`${connection.lastScanAt} asc nulls first`).limit(80);
  if (targets.length === 0) redirect(`/dashboard?c=${batchId}`);
  await enqueue(user.orgId, "activity_scan", { connectionIds: targets.map((t) => t.id) });
  redirect(`/dashboard?c=${batchId}`);
}

/** "Scan more people's posts" — the collection button.
 *
 *  Two steps behind one press: the scan stores up to five recent posts each,
 *  and the runner's own tail queues the reading pass when anything is left
 *  unjudged. The user does not need to know there are two jobs.
 *
 *  Every guard here is load-bearing. The worker re-reads the daily cap before
 *  EVERY person and throws on hitting it, which flips the whole job to failed,
 *  raises the app-wide red banner, and claims the remaining rows stay queued —
 *  which is false, because activity_scan holds no per-connection handles and
 *  those ids are simply lost. Clamping to what is left means a press that
 *  looked fine cannot die at 0/0. Org scoping happens in the SELECT because the
 *  runner does not re-verify the org on ids it is handed. */
export async function scanForHooks(batchId: string, formData: FormData) {
  const user = await requireUser();
  const want = Math.min(Math.max(Number(formData.get("n") ?? 40) || 40, 1), 80);

  const [seat] = await db.select({ id: channelAccount.id }).from(channelAccount)
    .where(and(eq(channelAccount.orgId, user.orgId), eq(channelAccount.status, "operational")))
    .limit(1);
  if (!seat) redirect(`/dashboard?c=${batchId}&scan=noseat`);
  if (await runningJob(user.orgId)) redirect(`/dashboard?c=${batchId}&scan=busy`);

  const { remaining } = await getDailyScanUsage(user.orgId);
  if (remaining === 0) redirect(`/dashboard?c=${batchId}&scan=cap`);

  const targets = await pickScanTargets(user.orgId, batchId, Math.min(want, remaining));
  if (targets.length === 0) redirect(`/dashboard?c=${batchId}&scan=0`);

  await enqueue(user.orgId, "activity_scan", { connectionIds: targets.map((t) => t.id) });
  redirect(`/dashboard?c=${batchId}&scan=${targets.length}`);
}

/** "Read N unread posts" — the judging button.
 *
 *  The first UI in the product that can start a reading pass: until now it was
 *  only ever chained from the tail of a scan, while the judge's own failure
 *  message told people to "press again to retry" a button that did not exist.
 *  No LinkedIn requests; roughly one model call per 25 posts.
 *
 *  The count comes from waitingToRead, never from unjudgedCount() or
 *  judgeStats().unjudged — those count posts belonging to peers, off-target and
 *  unclassified people that judgePosts will never select, so a button labelled
 *  from them promises work it cannot do. */
export async function readStoredPosts(batchId: string) {
  const user = await requireUser();

  const [offer] = await db.select({ id: service.id }).from(service)
    .where(and(eq(service.orgId, user.orgId), eq(service.status, "active"))).limit(1);
  if (!offer) redirect(`/dashboard?c=${batchId}&read=nooffers`);
  if (await runningJob(user.orgId)) redirect(`/dashboard?c=${batchId}&read=busy`);

  const { posts } = await waitingToRead(user.orgId);
  if (posts === 0) redirect(`/dashboard?c=${batchId}&read=0`);

  // Org-wide payload, matching what the job actually does.
  await enqueue(user.orgId, "post_judge", {});
  redirect(`/dashboard?c=${batchId}&read=${posts}`);
}

/** "Draft a message" on one row — spend a single research slot on the person
 *  whose post you are looking at, without going back to a bulk picker.
 *
 *  Delegates to enrichOnePerson, which is where the frontier bug's fix already
 *  lives: it short-circuits on done/running/queued (that is the double-run
 *  protection), marks the selection with the status-preserving CASE, and
 *  enqueues exactly the one id it picked. */
export async function draftFromHook(batchId: string, connId: string) {
  const user = await requireUser();
  const usage = await getDailyEnrichUsage(user.orgId);
  if (usage.used >= usage.cap) redirect(`/dashboard?c=${batchId}&picked=0&why=cap`);
  const ok = await enrichOnePerson(user.orgId, connId);
  redirect(`/dashboard?c=${batchId}&picked=${ok ? 1 : 0}`);
}

/** "Re-run" when the post is newer than the draft.
 *
 *  retryPerson does the same work but ends on /batches/…, which would throw
 *  someone off Today in the middle of triage. Same effect, this page's redirect. */
export async function rerunDraft(batchId: string, connId: string) {
  const user = await requireUser();
  const [row] = await db.select({ id: connection.id, enrichStatus: connection.enrichStatus })
    .from(connection)
    .where(and(eq(connection.orgId, user.orgId), eq(connection.batchId, batchId), eq(connection.id, connId)))
    .limit(1);
  if (!row) redirect(`/dashboard?c=${batchId}`);
  if (row.enrichStatus === "queued" || row.enrichStatus === "running") redirect(`/dashboard?c=${batchId}`);
  const usage = await getDailyEnrichUsage(user.orgId);
  if (usage.used >= usage.cap) redirect(`/dashboard?c=${batchId}&picked=0&why=cap`);
  await db.update(connection).set({ enrichStatus: "queued", enrichError: null })
    .where(and(eq(connection.orgId, user.orgId), eq(connection.id, connId)));
  await enqueue(user.orgId, "deep_enrich", { connectionIds: [connId] });
  redirect(`/dashboard?c=${batchId}&rerun=1`);
}
