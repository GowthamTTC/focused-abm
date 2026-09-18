/**
 * Today — the reasons to reach out.
 *
 * This page used to open with five counts. Counts tell you the shape of the
 * pipeline; they never tell you who to message this morning. Now it opens with
 * people: their own words, the post to reply under, and the one action that
 * person needs. The numbers survive at the bottom, collapsed, because they are
 * the answer to a different question.
 *
 * The order is relevance-against-your-own-offers faded to nothing over HOOK_DECAY_DAYS,
 * so it deliberately disagrees with fit rank — and every row can show the
 * arithmetic that put it there, because a list nobody can audit is a list
 * nobody should trust.
 */
import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, connection, channelAccount, job, service } from "@/db";
import { Shell, requirePage, KIND_LABEL } from "@/app/shell";
import { LedgerStrip } from "@/components/ledger";
import { UsageMeter } from "@/components/usage-meter";
import { CopyButton } from "@/components/copy-button";
import { ago, Soon, CampaignSwitcher, NoCampaign, resolveBatch } from "@/components/dash-bits";
import { getDailyEnrichUsage, resetsIn } from "@/modules/enrich/usage";
import { JUDGE_MAX_PER_RUN } from "@/modules/posts/judge";
import { getDailyScanUsage } from "@/modules/posts/usage";
import {
  FEED_DEFAULT_ROWS, FEED_MAX_ROWS, HOOK_DECAY_DAYS, bandFor, deepLinkFor, feedStatus, frontierWithHookCount,
  hookFeed, hooksElsewhere, pipelineCounts, pipelineWithHooks, rowState,
  scanCoverage, waitingToRead, type FeedRow, type RowState,
} from "@/modules/posts/feed";
import { getOrgSettings } from "@/modules/settings/org-settings";
import { draftFromHook, flagVerdict, markSent, readStoredPosts, rerunDraft, researchPick, scanForHooks } from "./actions";
import { startConnect } from "@/app/settings/actions";

const CARD = "bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const PILL = "rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 text-[12px] text-[#475467] hover:bg-[#F4F6FB]";
const PILL_PRIMARY = "rounded-[8px] bg-[#263BAA] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#1D2E86]";
const PILL_OFF = "cursor-not-allowed rounded-[8px] bg-[#F4F6FB] px-3 py-1.5 text-[12px] text-[#98A2B3]";
const EMPTY = "mt-5 rounded-[14px] border border-dashed border-[#DDE2EE] p-12 text-center";

/** 12–24s of deliberate sleep per person in the runner; 18s is the mean. */
const scanMinutes = (n: number) => Math.max(1, Math.round((n * 18) / 60));
const minutesPhrase = (n: number) => {
  const m = scanMinutes(n);
  return `${m} minute${m === 1 ? "" : "s"}`;
};
const daysSince = (d: Date) => Math.max(1, Math.round((Date.now() - d.getTime()) / 86400000));

/** Cost to act, which is what a person triaging actually sorts by. */
const RUNS: { label: string; states: RowState[] }[] = [
  { label: "Act now — no research budget needed", states: ["readyToSend", "needsDecision"] },
  { label: "Costs one research slot", states: ["notResearched", "researchFailed", "doneNoDraft"] },
  { label: "Already in flight", states: ["drafting", "parked", "skipped"] },
];

export default async function DashboardPage({ searchParams }: {
  searchParams: Promise<{
    c?: string; picked?: string; why?: string; scan?: string; read?: string;
    rerun?: string; n?: string;
  }>;
}) {
  const user = await requirePage();
  const sp = await searchParams;
  const { batch, batches } = await resolveBatch(user.orgId, sp.c);
  if (!batch) return <Shell user={user} active="dashboard"><NoCampaign /></Shell>;

  const wantRows = Math.min(Math.max(Number(sp.n) || FEED_DEFAULT_ROWS, 1), FEED_MAX_ROWS);

  const [
    feed, status, cov, pipe, runA, waitingOrg, usage, scan, offers, settings,
    seats, jobsActive, lastRuns, lastReads, scanRuns, countryRows,
  ] = await Promise.all([
    hookFeed(user.orgId, { batchId: batch.id, limit: wantRows }),
    feedStatus(user.orgId, batch.id),
    scanCoverage(user.orgId, batch.id),
    pipelineCounts(user.orgId, batch.id),
    pipelineWithHooks(user.orgId, batch.id),
    waitingToRead(user.orgId),
    getDailyEnrichUsage(user.orgId),
    getDailyScanUsage(user.orgId),
    db.select({ slug: service.slug, name: service.name }).from(service)
      .where(and(eq(service.orgId, user.orgId), eq(service.status, "active"))),
    getOrgSettings(user.orgId),
    db.select().from(channelAccount).where(eq(channelAccount.orgId, user.orgId)),
    db.select({ id: job.id, kind: job.kind, status: job.status }).from(job)
      .where(and(eq(job.orgId, user.orgId), inArray(job.status, ["queued", "running", "stopping"]))).limit(1),
    db.select({ kind: job.kind, status: job.status, progress: job.progress, total: job.total, updatedAt: job.updatedAt })
      .from(job).where(eq(job.orgId, user.orgId)).orderBy(desc(job.createdAt)).limit(1),
    db.select({
      status: job.status, progress: job.progress, total: job.total,
      updatedAt: job.updatedAt, error: job.error, payloadJson: job.payloadJson,
    }).from(job).where(and(eq(job.orgId, user.orgId), eq(job.kind, "post_judge")))
      .orderBy(desc(job.createdAt)).limit(1),
    // Whether a post scan has ever finished here. connection.last_scan_at is
    // NOT evidence of one: runEventExtended stamps it when it inserts an
    // event-search row, and that batch then becomes this page's default
    // campaign — so "we looked and they had nothing" would be a fabrication.
    db.select({ id: job.id }).from(job)
      .where(and(eq(job.orgId, user.orgId), eq(job.kind, "activity_scan"),
        inArray(job.status, ["done", "stopped", "failed"]))).limit(1),
    db.select({ c: connection.country, n: sql<number>`count(*)::int` }).from(connection)
      .where(and(eq(connection.batchId, batch.id), eq(connection.bucket, "pitchable"), sql`country is not null`))
      .groupBy(connection.country).orderBy(desc(sql`count(*)`)).limit(12),
  ]);

  const rows = feed.rows;
  const activeJob = jobsActive[0];
  const lastRun = lastRuns[0];
  const lastRead = lastReads[0];
  const readRes = (lastRead?.payloadJson as { result?: { judged: number; calls: number; failed: number; withHook: number } } | null)?.result;
  const postScanEverRan = scanRuns.length > 0;
  const seat = seats.find((s) => s.status === "operational") ?? seats.find((s) => s.status === "needs_reauth");
  const seatOk = seats.some((s) => s.status === "operational");
  const countries = countryRows.filter((x): x is { c: string; n: number } => Boolean(x.c));

  const capReached = usage.used >= usage.cap;
  // One headroom, one list, one default. Two expressions meant the select could
  // offer only sizes the cap forbids, its defaultValue could match no option
  // (so the browser silently chose 20), and the caption could price 40 people
  // when the campaign had 2 left to scan.
  const scanHeadroom = Math.min(scan.remaining, cov.scannable);
  const scanOptions = [20, 40, 80].filter((v) => v <= scanHeadroom);
  if (scanOptions.length === 0 && scanHeadroom > 0) scanOptions.push(scanHeadroom);
  const defaultScanN = scanOptions.length > 0 ? Math.min(40, scanOptions.at(-1)!) : 0;
  const scanBlocked = !seatOk || Boolean(activeJob) || scan.remaining === 0 || cov.scannable === 0;
  const readBlocked = offers.length === 0 || Boolean(activeJob);
  // One press reads at most JUDGE_MAX_PER_RUN rows, so the label must not
  // promise the whole backlog. The count is org-wide because post_judge is —
  // said out loud, since every other number in that card is campaign-scoped.
  const readNow = Math.min(waitingOrg.posts, JUDGE_MAX_PER_RUN);
  const readCalls = Math.ceil(readNow / 25);
  const feedPeople = Math.max(rows.length, status.feedPeople - feed.collapsed);

  // Only asked when there is nothing to show: a new import or sync creates new
  // connection rows, and the posts already paid for stay with the old ones.
  const elsewhere = rows.length === 0 ? await hooksElsewhere(user.orgId, batch.id) : null;

  const { pickN, pickCountry, pickPosted } = settings;
  const nOptions = [10, 20, 30, 50];
  const defaultN = String(nOptions.includes(pickN ?? 0) ? pickN : 30);
  const defaultCountry = countries.some((x) => x.c === pickCountry) ? pickCountry! : "";
  const defaultPosted = pickPosted === "7" || pickPosted === "30" || pickPosted === "hook" ? pickPosted : "any";
  // After defaultCountry, not beside it: the number in the option label has to
  // describe the population the button will select with the country the select
  // is actually showing.
  const frontierWithHook = await frontierWithHookCount(user.orgId, batch.id, defaultCountry);

  // ── the one-line result of whatever the last press did ──
  const note = (() => {
    const n = Number(sp.picked);
    if (sp.picked === "0" && sp.why === "cap") return ["amber", `Today's research budget is spent — resets in ${resetsIn(usage.resetsAt)}.`] as const;
    if (sp.picked === "0" && sp.why === "hook") return ["amber", `Nobody unresearched has a post you can open with yet — switch back to "any activity", or scan more people first.`] as const;
    if (sp.picked === "0") return ["amber", "Nobody matched those filters — try widening the country or the activity window, or scan posts first so activity is known."] as const;
    if (sp.picked && n > 0) return ["green", `Researching ${n} ${n === 1 ? "person" : "people"} now — drafts land in Review as each finishes.`] as const;
    if (sp.rerun === "1") return ["green", "Re-running research for that person — the new draft replaces the old one in Review."] as const;
    if (sp.scan === "noseat") return ["amber", "Connect a LinkedIn account in Settings before scanning."] as const;
    if (sp.scan === "busy" || sp.read === "busy") return ["amber", "A run is already going — the bar at the top has its progress and a Stop button. A second scan would only wait behind it."] as const;
    if (sp.scan === "cap") return ["amber", `Today's post-scan budget is spent — ${scan.used} of ${scan.cap} people, resets in ${resetsIn(scan.resetsAt)}.`] as const;
    if (sp.scan === "0") return ["amber", "Nobody left to scan in this campaign — everyone reachable was looked at today already."] as const;
    if (sp.scan && Number(sp.scan) > 0) {
      const k = Number(sp.scan);
      return ["green", `Scanning posts for ${k} people — about ${minutesPhrase(k)} at LinkedIn-safe pacing, then those posts get read against your ICPs. Reasons appear here as each person is read.`] as const;
    }
    if (sp.read === "nooffers") return ["amber", "Nothing to judge against — add an active ICP first."] as const;
    if (sp.read === "0") return ["amber", "Every stored post for a matched person has already been read."] as const;
    if (sp.read && Number(sp.read) > 0) {
      const k = Number(sp.read);
      return ["green", `Reading ${k} stored posts against your ICPs — no LinkedIn requests, about ${Math.ceil(k / 25)} model call${Math.ceil(k / 25) === 1 ? "" : "s"}.`] as const;
    }
    return null;
  })();

  const scanForm = (primary: boolean) => (
    <form action={scanForHooks.bind(null, batch.id)} className="flex items-center gap-2">
      <input type="hidden" name="n" value={String(defaultScanN)} />
      <button disabled={scanBlocked} className={scanBlocked ? PILL_OFF : primary ? PILL_PRIMARY : PILL}
        title="Fetches up to five recent posts each from LinkedIn, then reads them against your ICPs. Two steps, one press.">
        Scan {primary ? `${defaultScanN} people's posts` : "more people's posts"}
      </button>
    </form>
  );
  const readForm = (primary: boolean) => (
    <form action={readStoredPosts.bind(null, batch.id)}>
      <button disabled={readBlocked} className={readBlocked ? PILL_OFF : primary ? PILL_PRIMARY : PILL}
        title="No LinkedIn requests — reads posts already stored against your ICPs.">
        Read {readNow} unread post{readNow === 1 ? "" : "s"} across the workspace
      </button>
    </form>
  );
  const elsewhereLine = elsewhere && (
    <p className="mt-2 text-[13px] text-[#98A2B3]">
      {elsewhere.people} {elsewhere.people === 1 ? "person" : "people"} with a fresh reason sit in the campaign
      &ldquo;{elsewhere.label}&rdquo; — a new import or sync creates new rows, and stored posts stay with the old ones.{" "}
      <Link href={`/dashboard?c=${elsewhere.batchId}`} className="text-[#263BAA] underline underline-offset-2">Switch to {elsewhere.label}</Link>
    </p>
  );

  // ── the empty-state ladder — first match wins, and the last rung is a
  //    fall-through so a bare list can never render ──
  const empty = (() => {
    if (offers.length === 0) return (
      <div className={EMPTY}>
        <p className="text-[#101828]">No ICPs to judge posts against — every post is scored against your own ICPs, so relevance has no yardstick until at least one is active. Posts can still be collected; nothing can be scored.</p>
        <p className="mt-3"><Link href="/offers" className={PILL_PRIMARY}>Add an ICP</Link></p>
        {elsewhereLine}
      </div>
    );
    if (pipe.matched === 0) return (
      <div className={EMPTY}>
        <p className="tnum text-[#101828]">Nobody in this campaign is matched yet — {pipe.imported.toLocaleString()} rows imported, none graded. Posts are only read for people worth contacting.</p>
        <p className="mt-1 text-sm text-[#98A2B3]">Run matching from the campaign page, then come back.</p>
        <p className="mt-3"><Link href={`/batches/${batch.id}`} className={PILL_PRIMARY}>Open the campaign</Link></p>
        {elsewhereLine}
      </div>
    );
    if (cov.scannedEver === 0) return (
      <div className={EMPTY}>
        <p className="tnum text-[#101828]">No posts looked at in this campaign yet — {cov.pitchable.toLocaleString()} matched people, none scanned. Nobody here is quiet; nobody here has been checked.</p>
        <div className="mt-3 flex justify-center">
          {seatOk ? scanForm(true) : <form action={startConnect.bind(null, "/settings")}><button className={PILL_PRIMARY}>Connect a seat</button></form>}
        </div>
        <p className="tnum mt-1.5 text-[11px] text-[#98A2B3]">
          {seatOk
            ? `a scan reads up to five recent posts each, then reads them against your ICPs · about ${minutesPhrase(defaultScanN)} · ${scan.used}/${scan.cap} people scanned today across the whole workspace`
            : "scanning needs a connected LinkedIn seat"}
        </p>
        {elsewhereLine}
      </div>
    );
    if (status.stored === 0) return (
      <div className={EMPTY}>
        <p className="tnum text-[#101828]">
          {postScanEverRan
            ? `Looked at ${cov.scannedEver} people, and LinkedIn returned no posts for any of them — that is a real result, not a missing scan.`
            : `${cov.scannedEver} people here carry a scan timestamp, but no post scan has ever finished in this workspace — an event search stamps the same field. Nothing has actually been checked for posts yet.`}
        </p>
        <p className="tnum mt-1 text-sm text-[#98A2B3]">
          {postScanEverRan ? "Either they genuinely have not posted, or their profiles could not be resolved." : "A post scan is the only thing that stores posts."}
          {cov.unreachable > 0 ? ` ${cov.unreachable} of them have no LinkedIn identifier and can never be scanned.` : ""}
        </p>
        <div className="mt-3 flex justify-center">{scanForm(false)}</div>
        {elsewhereLine}
      </div>
    );
    if (status.read === 0) return (
      <div className={EMPTY}>
        <p className="tnum text-[#101828]">{status.stored} posts stored for this campaign, none read yet — reading them against your ICPs is what turns a post into a reason to reach out. Nothing here has been judged uninteresting.</p>
        <div className="mt-3 flex justify-center">{readForm(true)}</div>
        <p className="tnum mt-1.5 text-[11px] text-[#98A2B3]">no LinkedIn requests — about {readCalls} model call{readCalls === 1 ? "" : "s"}</p>
        {elsewhereLine}
      </div>
    );
    if (status.hooksEver === 0) return (
      <div className={EMPTY}>
        <p className="tnum text-[#101828]">
          {status.read} posts read, none produced an opener — {status.notSubstantive} were congratulations, promos, reshares or personal notes, which score 0 by rule, and {status.adjacent} were substantive but not about what you sell.
          {status.scoredNoHook > 0 ? ` ${status.scoredNoHook} scored 55 or higher but came back with no opener written.` : ""}
          {status.waiting > 0 ? ` ${status.waiting} are still waiting to be read.` : ""}
        </p>
        <p className="mt-1 text-sm text-[#98A2B3]">This is the filter working, not a failure.</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2.5">{scanForm(false)}{status.waiting > 0 && readForm(false)}</div>
        <p className="mt-2"><Link href="/offers" className="text-[12px] text-[#98A2B3] underline underline-offset-2">if the wrong things are scoring, your ICPs are what relevance is judged against</Link></p>
        {elsewhereLine}
      </div>
    );
    if (status.hooksFresh === 0) return (
      <div className={EMPTY}>
        <p className="tnum text-[#101828]">{status.hooksEver} posts scored high enough to open with, but the freshest is {status.newestHookAt ? daysSince(status.newestHookAt) : "—"} days old — past the 14-day window this list uses, so all of them now score 0.</p>
        <p className="tnum mt-1 text-sm text-[#98A2B3]">
          A strong post from last week still beats silence, but after {HOOK_DECAY_DAYS} days it stops counting.
          {cov.scannedStale > 0 ? ` ${cov.scannedStale} people were last looked at more than ${HOOK_DECAY_DAYS} days ago.` : ""}
        </p>
        <div className="mt-3 flex justify-center">{scanForm(false)}</div>
        {elsewhereLine}
      </div>
    );
    if (status.sentWithHook > 0) return (
      <div className={EMPTY}>
        <p className="tnum text-[#101828]">
          {status.droppedWithHook > 0
            ? `Nobody here is left to open — ${status.sentWithHook} of the people with a fresh reason were messaged and ${status.droppedWithHook} you dropped.`
            : `Everyone with a fresh reason has already been messaged — ${status.sentWithHook} of them. Nothing new to open today.`}
        </p>
        <p className="mt-2"><Link href={`/review?tab=sent&c=${batch.id}`} className="text-[13px] text-[#263BAA] underline underline-offset-2">See what you sent</Link></p>
        {elsewhereLine}
      </div>
    );
    if (status.droppedWithHook > 0) return (
      <div className={EMPTY}>
        <p className="tnum text-[#101828]">{status.droppedWithHook} people with a fresh reason are ones you dropped — this list only offers people still in the pipeline.</p>
        <p className="mt-2"><Link href={`/review?tab=decisions&c=${batch.id}`} className="text-[13px] text-[#263BAA] underline underline-offset-2">Open Decisions</Link></p>
        {elsewhereLine}
      </div>
    );
    return (
      <div className={EMPTY}>
        <p className="tnum text-[#101828]">{status.hooksFresh} fresh reasons are on file for this campaign, but none belongs to someone at a stage you can act on right now.</p>
        <p className="mt-2"><Link href={`/review?tab=ready&c=${batch.id}`} className="text-[13px] text-[#263BAA] underline underline-offset-2">Open Review</Link></p>
        <div className="mt-3 flex justify-center">{scanForm(false)}</div>
        {elsewhereLine}
      </div>
    );
  })();

  return (
    <Shell user={user} active="dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Today</h1>
          <p className="mt-1 max-w-xl text-sm text-[#475467]">
            People who said something you can open with — strongest and freshest first.
          </p>
          {note && (
            <p className={`mt-1 text-sm ${note[0] === "amber" ? "text-[#B54708]" : "text-[#067647]"}`}>
              {note[1]}
              {sp.read === "nooffers" && <> <Link href="/offers" className="underline underline-offset-2">ICPs</Link></>}
            </p>
          )}
        </div>
        <CampaignSwitcher batches={batches} batch={batch} basePath="/dashboard" totalRows={pipe.imported} />
      </div>

      {/* BLOCKED — a human has to do something before any of this can work */}
      {offers.length === 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-[#E7CE96] bg-[#FEFBF3] p-4 text-sm text-[#B54708]">
          <span>Posts cannot be scored — this workspace has no active ICP to judge them against.</span>
          <Link href="/offers" className="rounded-[8px] border border-[#E7CE96] bg-white px-3 py-1.5 text-[12px] text-[#B54708] hover:bg-[#FDF6E7]">Add an ICP</Link>
        </div>
      ) : !seatOk ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-[#E7CE96] bg-[#FEFBF3] p-4 text-sm text-[#B54708]">
          <span>Posts cannot be collected — the LinkedIn seat {seats.length ? "needs reconnecting" : "is not connected"}.</span>
          <form action={startConnect.bind(null, "/settings")}>
            <button className="rounded-[8px] border border-[#E7CE96] bg-white px-3 py-1.5 text-[12px] text-[#B54708] hover:bg-[#FDF6E7]">
              {seats.length ? "Reconnect" : "Connect a seat"}
            </button>
          </form>
        </div>
      ) : null}

      {/* THE LEAD */}
      <section className={`${CARD} mt-4`}>
        <div className="p-5 pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wider text-[#98A2B3]">Reasons to reach out</p>
            <span className="tnum text-[11px] text-[#98A2B3]">
              {feedPeople} {feedPeople === 1 ? "person" : "people"} · showing {rows.length}
              {/* Said out loud rather than left implicit: a colleague who
                  qualified but is not on screen looks like a missing person,
                  and "why isn't X here" is the question this line answers. */}
              {feed.sameCompany > 0 && ` · ${feed.sameCompany} more at ${feed.sameCompany === 1 ? "a company" : "companies"} already shown`}
              {feedPeople > rows.length && (rows.length < FEED_MAX_ROWS
                // An offer to "show all" that lands on the same 40 rows is a
                // no-op; past the cap, say what the screen will actually do.
                ? <> · <Link href={`/dashboard?c=${batch.id}&n=${FEED_MAX_ROWS}`} className="text-[#263BAA] underline underline-offset-2">show up to {FEED_MAX_ROWS}</Link></>
                : <> · this screen shows the strongest {FEED_MAX_ROWS}; the rest are in <Link href={`/review?tab=ready&c=${batch.id}`} className="text-[#263BAA] underline underline-offset-2">Review</Link></>)}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-[#98A2B3]">
            Grouped by what it costs to act, then by how relevant each post is to your ICPs, faded to nothing over 14
            days — so inside a group a strong post from yesterday leads a strong post from last week, and fit rank does
            not decide this list. One post per person: their strongest.
          </p>
        </div>

        {rows.length === 0 ? <div className="px-5 pb-5">{empty}</div> : (
          <div className="border-t border-[#EEF1F8]">
            {RUNS.map(({ label, states }) => {
              const inRun = rows.filter((r) => states.includes(rowState(r)));
              if (inRun.length === 0) return null;
              // A heading and its own list, rather than a label <li> sitting in
              // the same list as the people: assistive tech counted those
              // labels as list items and read them as if they were a person.
              return (
                <section key={label} aria-labelledby={`run-${states[0]}`}>
                  <h3 id={`run-${states[0]}`} className="bg-[#FAFBFE] px-5 py-1.5 text-[10px] font-normal uppercase tracking-wider text-[#98A2B3]">
                    {label} · {inRun.length}
                  </h3>
                  <ul className="divide-y divide-[#EEF1F8] border-t border-[#EEF1F8]">
                    {inRun.map((r) => (
                      <HookRow key={r.connectionId} r={r} batchId={batch.id} matched={pipe.matched}
                        offers={offers} enrichCapReached={capReached} resetsAt={usage.resetsAt} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        {/* WHERE THESE COME FROM */}
        <div className="border-t border-[#EEF1F8] px-5 py-4">
          <p className="tnum text-[11px] leading-5 text-[#98A2B3]">
            {cov.scannedEver} of {cov.pitchable} matched people in this campaign have ever been looked at
            {cov.newestScanAt && <> · newest scan {ago(cov.newestScanAt)}</>}
            {" · "}{status.read} of {status.stored} stored posts read{status.waiting > 0 ? ` · ${status.waiting} still waiting` : ""}
            {" · "}{scan.used}/{scan.cap} people scanned today across the whole workspace, any scan including Radar, resets in {resetsIn(scan.resetsAt)}
            {cov.unreachable > 0 && <> · {cov.unreachable} matched people have no LinkedIn identifier and can never be scanned</>}
            {status.droppedWithHook > 0 && <> · {status.droppedWithHook} people you dropped also have a fresh reason</>}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <form action={scanForHooks.bind(null, batch.id)} className="flex items-center gap-2">
              <select name="n" defaultValue={String(defaultScanN)} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5 text-[12px]">
                {scanOptions.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <button disabled={scanBlocked} className={scanBlocked ? PILL_OFF : PILL}
                title="Fetches up to five recent posts each from LinkedIn, then reads them against your ICPs. Two steps, one press.">
                Scan more people&apos;s posts
              </button>
            </form>
            {waitingOrg.posts > 0 && readForm(false)}
          </div>
          <p className="tnum mt-1.5 text-[11px] text-[#98A2B3]">
            {!seatOk ? "connect a LinkedIn seat in Settings first"
              : activeJob ? `${KIND_LABEL[activeJob.kind] ?? activeJob.kind} is already running — this would only wait behind it`
              : scan.remaining === 0 ? `today's post-scan budget is spent — resets in ${resetsIn(scan.resetsAt)}`
              : cov.scannable === 0
                // Zero scannable has two very different causes, and reporting
                // the wrong one inverts the screen's whole claim: "everybody
                // has been checked" versus "nobody can be".
                ? (cov.pitchable === cov.unreachable
                    ? "nobody in this campaign has a LinkedIn identifier we can resolve, so no scan is possible"
                    : cov.scannedEver === 0
                      ? "nobody here can be scanned — every reachable person is missing an identifier the posts endpoint accepts"
                      : "everyone reachable in this campaign was looked at today already")
              : `never-looked-at people first, then the oldest scans · about ${minutesPhrase(defaultScanN)} for ${defaultScanN} · one LinkedIn request each, two for CSV rows that still need a profile lookup`}
          </p>

          {/* the receipt: what the last reading pass actually did */}
          <p className={`tnum mt-2 text-[11px] ${lastRead?.status === "failed" ? "text-[#B42318]" : "text-[#98A2B3]"}`}>
            {!lastRead ? "No read run recorded yet — the receipt appears here after the first one."
              : lastRead.status === "failed" ? `Last read failed ${ago(lastRead.updatedAt)} — ${(lastRead.error ?? "").slice(0, 140)}. Press Read again.`
              : lastRead.status === "stopped" ? `Last read stopped ${ago(lastRead.updatedAt)} after ${lastRead.progress} of ${lastRead.total} — the posts already read are kept.`
              : readRes ? `Last read ${ago(lastRead.updatedAt)} — read ${readRes.judged} posts, ${readRes.withHook} gave a reason${readRes.failed ? `, ${readRes.failed} model call${readRes.failed === 1 ? "" : "s"} failed` : ""}.`
              : `Last read ${ago(lastRead.updatedAt)} — ${lastRead.status}.`}
            {lastRun?.kind === "activity_scan" && lastRun.status === "stopped" && (
              <> {" "}Last scan stopped after {lastRun.progress} of {lastRun.total} — the posts already fetched are kept; the rest were not scanned.</>
            )}
          </p>

          {activeJob && (
            <p className="radar-banner mt-2 text-sm text-[#067647]">
              <span className="radar-banner-text">{KIND_LABEL[activeJob.kind] ?? activeJob.kind} is running — the bar at the top has progress and a Stop button.</span>
              <span className="radar-dots" aria-hidden><span /><span /><span /></span>
            </p>
          )}

          <p className="tnum mt-1.5 text-[11px] text-[#98A2B3]">
            Seat {seat?.displayName ?? seat?.unipileAccountId ?? "none connected"}
            {seat ? ` · ${seat.status === "operational" ? "operational" : "needs re-auth"}` : ""}
          </p>
        </div>
      </section>

      {/* THE BULK CHORE */}
      <section className={`${CARD} mt-4 p-5`}>
        <p className="text-[11px] uppercase tracking-wider text-[#98A2B3]">Research the next tranche</p>
        <p className="mt-1 max-w-lg text-[12px] leading-5 text-[#98A2B3]">
          Research writes the draft. It does not look for new posts — that is the scan above.
        </p>
        <form action={researchPick.bind(null, batch.id)} className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-[#475467]">
          <span>Research my top</span>
          <select name="n" defaultValue={defaultN} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
            {nOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <span>matches</span>
          <select name="country" defaultValue={defaultCountry} className="max-w-44 rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
            <option value="">anywhere</option>
            {countries.map((x) => <option key={x.c} value={x.c}>in {x.c} ({x.n})</option>)}
          </select>
          <select name="posted" defaultValue={defaultPosted} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
            <option value="any">any activity</option>
            <option value="hook">who posted something you can open with ({frontierWithHook})</option>
            <option value="7">who posted in the last 7 days</option>
            <option value="30">who posted in the last 30 days</option>
          </select>
          <button disabled={capReached}
            className={capReached
              ? "cursor-not-allowed rounded-[10px] bg-[#F4F6FB] px-5 py-3 text-sm font-semibold text-[#98A2B3]"
              : "rounded-[10px] bg-[#263BAA] px-5 py-3 text-sm font-semibold text-white hover:bg-[#1D2E86]"}>
            Start researching
          </button>
        </form>
        <div className="mt-3 max-w-xs"><UsageMeter used={usage.used} cap={usage.cap} resetsAt={usage.resetsAt} bar /></div>
        <p className="tnum mt-1.5 text-[11px] text-[#98A2B3]">
          {capReached ? "today's run limit is spent — resumes at reset. Anyone not reached went back to the pool."
            : defaultPosted === "hook" ? "strongest post first, then fit rank — within your filters and today's budget"
            : "best-ranked first, within your filters and today's budget"}
        </p>
      </section>

      {/* THE NUMBERS — collapsed, because they answer a different question */}
      <details className={`${CARD} mt-4`}>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 text-sm">
          <span className="font-medium">Pipeline and numbers</span>
          <span className="tnum text-[12px] text-[#98A2B3]">
            {pipe.ready} ready to send · {pipe.decisions} needing a decision · {pipe.messaged} messaged
            {pipe.failed > 0 ? ` · ${pipe.failed} failed` : ""}
          </span>
          <span className="ml-auto text-[#98A2B3]">▾</span>
        </summary>
        <div className="border-t border-[#EEF1F8] p-5">
          <div className="flex flex-wrap items-center gap-x-9 gap-y-4">
            {([
              [pipe.ready, "ready to send", `/review?tab=ready&c=${batch.id}`, undefined, runA.readyWithHook ? `${runA.readyWithHook} with a new post` : null],
              [pipe.decisions, "needs decision", `/review?tab=decisions&c=${batch.id}`, pipe.decisions > 0 ? "text-[#B54708]" : undefined, runA.decisionsWithHook ? `${runA.decisionsWithHook} the post can settle` : null],
              [pipe.messaged, "sent", `/review?tab=sent&c=${batch.id}`, undefined, null],
              [pipe.failed, "failed", pipe.failed > 0 ? `/review?tab=ready&c=${batch.id}` : null, pipe.failed > 0 ? "text-[#B42318]" : undefined, null],
            ] as [number, string, string | null, string | undefined, string | null][]).map(([n, label, href, tone, sub]) => {
              const body = (
                <>
                  <p className={`tnum text-[26px] leading-8 ${tone ?? "text-[#101828]"}`}>{n.toLocaleString()}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#98A2B3]">
                    {label}{href && <span className="ml-1 text-[#263BAA]/60">→</span>}
                  </p>
                  {sub && <p className="tnum mt-0.5 text-[10px] text-[#263BAA]">{sub}</p>}
                </>
              );
              return href
                ? <Link key={label} href={href} className="group rounded-[8px] px-1 transition hover:bg-[#F4F6FB]">{body}</Link>
                : <div key={label} className="px-1">{body}</div>;
            })}
          </div>
          <p className="mt-3 text-[11px] text-[#98A2B3]">
            Counted across this campaign. &ldquo;Ready&rdquo; means a draft exists, nobody has been messaged, and no
            flag is waiting on you — the same test the sidebar badge uses.
          </p>
          {pipe.ready > 0 && (
            <p className="tnum mt-1 text-[11px] text-[#98A2B3]">
              {pipe.ready - runA.readyWithHook} of {pipe.ready} ready drafts have no post from the last {HOOK_DECAY_DAYS} days —{" "}
              <Link href="/network?view=recency" className="text-[#263BAA] underline underline-offset-2">who is going quiet</Link>
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
            {([["Imported", pipe.imported], ["Matched", pipe.matched], ["Researched", pipe.researched], ["Messaged", pipe.messaged]] as const)
              .map(([label, n], i) => (
                <span key={label} className="flex items-baseline gap-2">
                  {i > 0 && <span className="text-[#98A2B3]">→</span>}
                  <span className="tnum text-xl">{n.toLocaleString()}</span>
                  <span className="text-xs text-[#98A2B3]">{label}</span>
                </span>
              ))}
            <span className="flex items-baseline gap-2"><span className="text-[#98A2B3]">→</span>
              <Soon tip="Coming in a later release — replies are marked manually for now."><span className="tnum text-xl">—</span><span className="text-xs">Replied</span></Soon>
            </span>
            <span className="tnum ml-auto text-sm text-[#263BAA]">T1 remaining {pipe.t1Remaining}</span>
          </div>

          <LedgerStrip className="mt-4" counts={{
            topDone: pipe.researched, topPending: pipe.touched - pipe.researched,
            pitchable: Math.max(0, pipe.matched - pipe.touched),
            peers: pipe.peers, offIcp: pipe.offIcp, excluded: pipe.excluded, unclassified: pipe.unclassified,
          }} />
          <p className="mt-1.5 text-xs text-[#98A2B3]">one tick per person, rank order — indigo Top-N ignites as research completes</p>

          <p className="tnum mt-4 text-[11px] text-[#98A2B3]">
            {lastRun
              ? `Last run: ${KIND_LABEL[lastRun.kind] ?? lastRun.kind} · ${lastRun.status} · ${lastRun.progress}/${lastRun.total} · ${ago(lastRun.updatedAt)} · `
              : "No runs yet · "}
            <Link href="/alerts" className="text-[#263BAA] underline underline-offset-2">run history and failures</Link>
          </p>
        </div>
      </details>
    </Shell>
  );
}

/** One person, one reason, one action. */
function HookRow({ r, batchId, matched, offers, enrichCapReached, resetsAt }: {
  r: FeedRow; batchId: string; matched: number;
  offers: { slug: string; name: string }[]; enrichCapReached: boolean; resetsAt: Date;
}) {
  const state = rowState(r);
  const band = bandFor(r.relevance);
  const b = r.breakdown;
  const deepLink = deepLinkFor(r);
  const personHref = `/batches/${r.batchId}?view=${r.enrichStatus === "done" ? "enriched" : "pitchable"}&p=${r.connectionId}`;
  const staleDraft = r.enrichedAt && r.postedAt && r.postedAt > r.enrichedAt;
  const showStaleness = ["readyToSend", "needsDecision", "parked", "doneNoDraft"].includes(state);

  return (
    <li className="radar-stat px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Link href={personHref} className="font-medium text-[#101828] hover:text-[#263BAA]">{r.firstName} {r.lastName}</Link>
        <span className="min-w-0 flex-1 truncate text-[13px] text-[#475467]">
          {r.role ?? "—"}{r.company ? ` at ${r.company}` : ""}
        </span>
        <span className="tnum shrink-0 text-[11px] text-[#98A2B3]">
          hook {r.hookScore} · {r.rank != null ? `rank #${r.rank}` : "unranked"}
        </span>
      </div>

      <p className="mt-1.5 text-[13.5px] leading-6 text-[#101828]">{r.hook}</p>
      <p className="mt-1.5 line-clamp-2 text-[12.5px] italic leading-5 text-[#475467]">&ldquo;{r.postExcerpt}&rdquo;</p>

      {showStaleness && (staleDraft ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[#E7CE96] bg-[#FDF6E7] px-3 py-1.5 text-[12px] text-[#B54708]">
          <span>This post is newer than the draft — re-run before sending.</span>
          <form action={rerunDraft.bind(null, batchId, r.connectionId)}><button className="underline">Re-run</button></form>
        </div>
      ) : r.enrichedAt ? (
        <p className="mt-2 text-[11px] text-[#98A2B3]">The draft was written after this post, so it may already reference it.</p>
      ) : null)}

      <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
        {deepLink
          ? <a href={deepLink} target="_blank" rel="noreferrer" className={PILL}>{r.postUrl ? "Open the post ↗" : "Open their activity ↗"}</a>
          : <span className="text-[12px] text-[#98A2B3]">no link captured for this post</span>}

        {state === "readyToSend" && (
          <>
            <CopyButton text={r.outreachMessage ?? ""} label="Copy the draft" />
            <form action={markSent.bind(null, batchId, r.connectionId)}><button className={PILL_PRIMARY}>Mark sent</button></form>
          </>
        )}
        {state === "needsDecision" && (
          <>
            <form action={flagVerdict.bind(null, batchId, r.connectionId, "variant")}><button className={PILL_PRIMARY}>Send a variant</button></form>
            <form action={flagVerdict.bind(null, batchId, r.connectionId, "verify")}><button className={PILL}>Verify first</button></form>
            <form action={flagVerdict.bind(null, batchId, r.connectionId, "dropped")}><button className={PILL}>Drop</button></form>
          </>
        )}
        {state === "notResearched" && (
          <form action={draftFromHook.bind(null, batchId, r.connectionId)}>
            <button disabled={enrichCapReached} className={enrichCapReached ? PILL_OFF : PILL_PRIMARY}
              aria-describedby={enrichCapReached ? "enrich-cap-reason" : undefined}
              title={enrichCapReached
                ? `Today's research budget is spent — resets in ${resetsIn(resetsAt)}.`
                : "Researches this one person and writes a draft in your voice — about a minute, one slot from today's budget."}>
              Draft a message
            </button>
            {enrichCapReached && (
              <span id="enrich-cap-reason" className="tnum text-[11px] text-[#98A2B3]">
                today&apos;s research budget is spent — resets in {resetsIn(resetsAt)}
              </span>
            )}
          </form>
        )}
        {state === "researchFailed" && (
          <>
            <Link href={personHref} className="rounded-[8px] border border-[#FDA29B] px-3 py-1.5 text-[12px] text-[#B42318] hover:bg-[#FEF3F2]">Research failed — see why</Link>
            <form action={draftFromHook.bind(null, batchId, r.connectionId)}>
              <button disabled={enrichCapReached} className={enrichCapReached ? PILL_OFF : PILL_PRIMARY}>Try again</button>
            </form>
          </>
        )}
        {state === "doneNoDraft" && <Link href={personHref} className={PILL}>Research finished with no draft — open the record</Link>}
        {state === "drafting" && (
          <span className="inline-flex items-center gap-2 text-[12px] text-[#B54708]">
            <span className="radar-banner-text">Drafting…</span>
            <span className="radar-dots" aria-hidden><span /><span /><span /></span>
          </span>
        )}
        {state === "parked" && (
          <Link href={`/review?tab=decisions&c=${batchId}&p=${r.connectionId}`} className="rounded-[8px] bg-[#FDF6E7] px-3 py-1.5 text-[12px] text-[#B54708] hover:bg-[#FEFBF3]">
            Parked for verification — settle it on Review
          </Link>
        )}
        {state === "skipped" && <Link href={personHref} className={PILL}>Research skipped this person — open the record</Link>}

        <span className="tnum ml-auto text-[11px] text-[#98A2B3]">
          posted {r.postedAt ? ago(r.postedAt) : "—"} · looked at {r.lastScanAt ? ago(r.lastScanAt) : "never"}
        </span>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer list-none text-[11px] text-[#98A2B3] hover:text-[#263BAA]">Why this one is here ▾</summary>
        <div className="mt-2 rounded-[10px] border border-[#DDE2EE] bg-[#F4F6FB] p-3.5">
          <p className="tnum text-[12px] text-[#46506E]">
            relevance {r.relevance} × (1 − {r.ageDays} of {HOOK_DECAY_DAYS} days) = {r.hookScore}
          </p>
          <p className="mt-1.5 text-[12px] leading-5 text-[#475467]">
            {band && <>{r.relevance} is in the {band.band} band — {band.sentence}. </>}
            Below 55 no opener is written at all, and every non-substantive post — congratulations, promos, reshares,
            personal notes — is forced to 0.
          </p>
          <p className="mt-1.5 text-[12px] text-[#98A2B3]">
            Read {r.judgedAt ? ago(r.judgedAt) : "—"} against this workspace&apos;s active ICPs as they stood then —
            nothing on the post records which ones, and they can be rewritten. Today there{" "}
            {offers.length === 1 ? "is 1" : `are ${offers.length}`}
            {offers.length > 0 && `: ${offers.map((o) => o.name).join(", ")}`}.
          </p>
          <p className="mt-1.5 text-[12px] leading-5 text-[#475467]">
            {r.rank == null
              ? "Unranked — this person was classified after the last re-rank. This list ordered them by the post alone."
              // A rank above the matched count is not a bug: people re-classified
              // out of the pool since the last re-rank shrink the denominator
              // while every rank stays where it was. Say that rather than print
              // "#10 of 8".
              : r.rank > matched
                ? `Ranked #${r.rank} at the last re-rank${r.score != null ? `, fit score ${r.score}` : ""}${r.tier ? ` → T${r.tier}` : ""} — the pool has since shrunk to ${matched} matched people. Rank did not decide this order — the post's relevance and its date placed them inside their group.`
                : `Ranked #${r.rank} of ${matched} matched people here${r.score != null ? `, fit score ${r.score}` : ""}${r.tier ? ` → T${r.tier}` : ""}. Rank did not decide this order — the post's relevance and its date placed them inside their group, and the group decides what sits above what.`}
          </p>
          {b && (
            <>
              <p className="tnum mt-1.5 text-[11px] text-[#46506E]/65">
                seniority {b.seniority} · function {b.function_fit} · confidence {b.confidence} · founder {b.founder_bonus} · company {b.company_present}
                {b.service_bonus ? ` · service ${b.service_bonus}` : ""} = {b.total}
              </p>
              {r.matchWhy && <p className="mt-1 text-[12px] leading-5 text-[#475467]">{r.matchWhy}</p>}
            </>
          )}
          {r.otherHooks > 0 && (
            <p className="tnum mt-1.5 text-[11px] text-[#98A2B3]">
              {r.otherHooks} other post{r.otherHooks > 1 ? "s" : ""} of theirs also cleared the bar in this window — this is the strongest after the fade.
            </p>
          )}
          {r.category && (
            <span className="mt-2 inline-block rounded border border-[#DDE2EE] px-1.5 py-0.5 text-[10px] text-[#475467]">{r.category}</span>
          )}
        </div>
      </details>
    </li>
  );
}
