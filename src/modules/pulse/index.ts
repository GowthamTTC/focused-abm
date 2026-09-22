/**
 * Account Pulse — the orchestrator. See docs/ACCOUNT-PULSE.md.
 *
 * Answers, for ONE company: what changed lately, what the people around it are
 * saying, who else is selling into it, and which of this workspace's offers that
 * makes openable. Never who to call — that is §0, and it is enforced by the types
 * in ./types rather than by anyone remembering it.
 *
 * WHERE TRIGGERS LIVE. Every other band reads from a table, so it is always
 * current. Triggers are the output of a model call, so they are a snapshot, and
 * they are kept where this repo already keeps the output of a model call: the
 * job's own payloadJson (see how post_judge and event_scan stash `result`).
 * That buys a new table's worth of function for nothing, and it makes the
 * staleness honest — triggers are labelled with the run that produced them, so a
 * panel can say "as of Tuesday" instead of implying it just thought of them.
 */
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, accountSignal, job } from "@/db";
import { getOrgSettings } from "@/modules/settings/org-settings";
import { collectNews, storeSignals } from "@/modules/pulse/news";
import { judgeSignals } from "@/modules/pulse/judge";
import { deriveTriggers } from "@/modules/pulse/triggers";
import { networkBand } from "@/modules/pulse/network";
import { competitorHits } from "@/modules/pulse/competitors";
import {
  meanSentiment,
  type AccountPulse,
  type SignalRow,
  type Trigger,
} from "@/modules/pulse/types";

export interface PulseRunResult {
  collected: number;
  judged: number;
  calls: number;
  failed: number;
  triggers: Trigger[];
  /** Empty when the workspace has no allowlisted domains. The panel says so
   *  rather than showing an empty news band that looks like quiet news. */
  domains: number;
}

/** The refresh. Called only from the worker — it fetches the web and bills the
 *  model, so nothing in the request path may call it. */
export async function runAccountPulse(
  orgId: string,
  companyKey: string,
  companyName: string,
  onProgress?: (done: number, total: number) => Promise<void>,
): Promise<PulseRunResult> {
  const settings = await getOrgSettings(orgId);
  const domains = settings.pulseDomains ?? [];

  // Four steps, reported as four so a stalled run says which one it is on.
  if (onProgress) await onProgress(0, 4);

  const items = domains.length > 0 ? await collectNews(domains, companyName) : [];
  const collected = items.length > 0
    ? await storeSignals(orgId, companyKey, companyName, items)
    : 0;
  if (onProgress) await onProgress(1, 4);

  const judged = await judgeSignals(orgId, companyKey);
  if (onProgress) await onProgress(2, 4);

  const triggers = await deriveTriggers(orgId, companyKey, companyName);
  if (onProgress) await onProgress(3, 4);

  if (onProgress) await onProgress(4, 4);
  return {
    collected,
    judged: judged.judged,
    calls: judged.calls,
    failed: judged.failed,
    triggers,
    domains: domains.length,
  };
}

/** The read. Cheap, request-path safe, touches neither the web nor the model. */
export async function loadPulse(
  orgId: string,
  companyKey: string,
  companyName: string,
  networkHidden: boolean,
): Promise<AccountPulse> {
  // The workspace's own peer list when it has one. Passing undefined (not []) is
  // what lets competitors.ts fall back to its defaults: an explicitly empty list
  // means the band is off, and conflating the two would switch it back on for
  // every seat that had deliberately cleared it.
  const settings = await getOrgSettings(orgId);
  const [signals, network, competitors, lastRun] = await Promise.all([
    db.select({
      id: accountSignal.id,
      kind: accountSignal.kind,
      source: accountSignal.source,
      title: accountSignal.title,
      url: accountSignal.url,
      publishedAt: accountSignal.publishedAt,
      sentiment: accountSignal.sentiment,
      theme: accountSignal.theme,
      evidence: accountSignal.evidence,
    }).from(accountSignal)
      .where(and(
        eq(accountSignal.orgId, orgId),
        eq(accountSignal.companyKey, companyKey),
        // Only the fetched half. A "post" row references a row in `post` and is
        // the Network band's business; showing it here would double-count the
        // same sentence in two bands and in the narrative score.
        inArray(accountSignal.kind, ["news", "filing"]),
      ))
      .orderBy(desc(accountSignal.publishedAt))
      .limit(50),
    networkBand(orgId, companyKey, networkHidden),
    competitorHits(orgId, companyKey, companyName, settings.peerSignals),
    latestPulseRun(orgId, companyKey),
  ]);

  const news: SignalRow[] = signals;
  return {
    companyKey,
    companyName,
    news,
    // Judged items only. An unjudged row has sentiment null, and meanSentiment
    // skips nulls rather than reading them as neutral (§2).
    narrative: meanSentiment(news.map((s) => ({ sentiment: s.sentiment, at: s.publishedAt }))),
    network,
    competitors,
    triggers: lastRun?.triggers ?? [],
    refreshedAt: lastRun?.at ?? null,
  };
}

/** The most recent completed refresh for this account, for its triggers and its
 *  as-of date. A failed or stopped run is deliberately ignored: half a refresh
 *  produces triggers drawn from half the signals, which is worse than none. */
async function latestPulseRun(
  orgId: string,
  companyKey: string,
): Promise<{ triggers: Trigger[]; at: Date } | null> {
  const [row] = await db.select({ payload: job.payloadJson, at: job.updatedAt })
    .from(job)
    .where(and(
      eq(job.orgId, orgId),
      eq(job.kind, "account_pulse"),
      eq(job.status, "done"),
      sql`${job.payloadJson}->>'companyKey' = ${companyKey}`,
    ))
    .orderBy(desc(job.updatedAt))
    .limit(1);
  if (!row) return null;
  const result = (row.payload as { result?: PulseRunResult }).result;
  return { triggers: result?.triggers ?? [], at: row.at };
}

/** How many signals this account has, and how many are still unjudged — the
 *  panel's way of saying "there is more to read" without running the judge. */
export async function pulseStats(orgId: string, companyKey: string) {
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    unjudged: sql<number>`count(*) filter (where judged_at is null)::int`,
    scored: sql<number>`count(*) filter (where sentiment is not null)::int`,
  }).from(accountSignal)
    .where(and(eq(accountSignal.orgId, orgId), eq(accountSignal.companyKey, companyKey)));
  return row ?? { total: 0, unjudged: 0, scored: 0 };
}

/** Exported for the runner's guard: refuse to enqueue a refresh for an account
 *  that has never been shortlisted, so the spend follows a deliberate act. */
export async function hasJudgedSignals(orgId: string, companyKey: string): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(accountSignal)
    .where(and(
      eq(accountSignal.orgId, orgId),
      eq(accountSignal.companyKey, companyKey),
      isNotNull(accountSignal.judgedAt),
    ));
  return (row?.n ?? 0) > 0;
}
