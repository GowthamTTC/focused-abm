/**
 * DB-backed job runner — no Redis in the standalone. worker.ts polls for
 * queued jobs; the web app only INSERTS job rows and reads progress.
 */
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, connection, job, channelAccount } from "@/db";
import { getChannelProvider, type Relation } from "@/providers/channel";
import { createBatchFromRelations } from "@/modules/connections/create-batch";
import { env } from "@/lib/env";
import { classifyBatch } from "@/modules/matching/service-fit";
import { rankBatch } from "@/modules/scoring/rank";
import { deepEnrichOne } from "@/modules/enrich/deep-dive";
import { z } from "zod";
import { complete } from "@/llm/client";
import { getOrgSettings, updateOrgSettings } from "@/modules/settings/org-settings";
import { idleSweep, releaseIds, sweepDeadJobs } from "@/jobs/reap";
import { runEventScan } from "@/modules/radar/scan";
import { runEventExtended } from "@/modules/radar/extended";
import { storePosts } from "@/modules/posts/store";
import { judgePosts } from "@/modules/posts/judge";
import { runAccountPulse } from "@/modules/pulse";
import { runIntelScan } from "@/modules/intel";

export async function enqueue(orgId: string, kind: string, payload: Record<string, unknown>) {
  const [row] = await db.insert(job).values({ orgId, kind, payloadJson: payload }).returning();
  return row;
}

async function stopRequested(jobId: string): Promise<boolean> {
  const [row] = await db.select({ s: job.status }).from(job).where(eq(job.id, jobId));
  return row?.s === "stopping";
}
/** Exported only so the harness can call it directly. A previous version of
 *  that check re-implemented this guard inline and therefore passed while the
 *  guard itself was deleted — testing the test, not the code. */
export async function markStopped(jobId: string, progress: number, total: number) {
  await db.update(job).set({ status: "stopped", progress, total, updatedAt: new Date() })
    // Compare-and-swap, not a bare id match. A worker draining after a sweep has
    // already declared its job abandoned would otherwise overwrite 'failed' and
    // its explanation with a bare 'stopped', destroying the only account the
    // user gets of what happened.
    .where(and(eq(job.id, jobId), inArray(job.status, ["running", "stopping"])));
}

/** How often a running job stamps its own row.
 *
 *  updated_at is the ONLY liveness signal this queue has — there is no owner
 *  column and no lease — and before this it was stamped once per PERSON. With a
 *  25s inter-person gap a healthy run looked identical to a dead one for the
 *  best part of a minute, which is why the reaper had to wait fifteen. Beating
 *  every ten seconds against a sixty-second window leaves five missed beats of
 *  margin before anything is declared dead. */
const HEARTBEAT_MS = 10_000;

/** Stamp this job while it runs, and sweep everyone else's corpses while we are
 *  here — one timer, both duties.
 *
 *  Sweeping from the heartbeat rather than only from the idle path is the whole
 *  point: the idle path runs when the queue is EMPTY, so a job orphaned behind
 *  a busy queue used to wait for the queue to drain before anyone noticed it
 *  was dead. Passing our own id keeps a late beat from letting us sweep the job
 *  we are holding.
 *
 *  It swallows its own errors: a missed beat costs nothing because the next one
 *  retries, whereas an unhandled rejection here would take down the worker and
 *  turn a cleanup routine into an outage. */
function startHeartbeat(jobId: string): () => void {
  const beat = async () => {
    try {
      await db.update(job).set({ updatedAt: new Date() })
        .where(and(eq(job.id, jobId), inArray(job.status, ["running", "stopping"])));
      await sweepDeadJobs(jobId);
    } catch { /* the next beat retries */ }
  };
  const timer = setInterval(() => { void beat(); }, HEARTBEAT_MS);
  // Never hold the process open on this alone.
  timer.unref?.();
  return () => clearInterval(timer);
}
async function scannedToday(orgId: string): Promise<number> {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.orgId, orgId), gte(connection.lastScanAt, today)));
  return row?.n ?? 0;
}

async function setProgress(id: string, progress: number, total: number, current?: string) {
  const patch: { progress: number; total: number; updatedAt: Date; payloadJson?: Record<string, unknown> } = {
    progress, total, updatedAt: new Date(),
  };
  if (current) {
    const [row] = await db.select({ payloadJson: job.payloadJson }).from(job).where(eq(job.id, id)).limit(1);
    patch.payloadJson = { ...(row?.payloadJson ?? {}), current };
  }
  await db.update(job).set(patch).where(eq(job.id, id));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function enrichedToday(orgId: string): Promise<number> {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.orgId, orgId), gte(connection.enrichedAt, since)));
  return row?.n ?? 0;
}

export async function processNext(): Promise<boolean> {
  const [next] = await db.select().from(job)
    .where(eq(job.status, "queued")).orderBy(asc(job.createdAt)).limit(1);
  // Nothing to run means nobody may be holding a queued/running handle.
  if (!next) { await idleSweep(); return false; }

  await db.update(job).set({ status: "running", updatedAt: new Date() }).where(eq(job.id, next.id));
  const stopHeartbeat = startHeartbeat(next.id);
  try {
    if (next.kind === "sync") {
      const accountId = String(next.payloadJson.accountId);
      const seatId = String(next.payloadJson.seatId ?? "");
      const provider = getChannelProvider();
      const all: Relation[] = [];
      let cursor: string | null = null;
      let syncStopped = false;
      do {
        if (await stopRequested(next.id)) { syncStopped = true; break; }
        const page = await provider.fetchRelations({ accountId, cursor, limit: 100 });
        all.push(...page.items);
        cursor = page.cursor;
        // Live banner: total stays 0 (unknown until the last page) — the UI
        // renders "Syncing · N pulled" with an indeterminate bar.
        await db.update(job).set({ progress: all.length, updatedAt: new Date() })
          .where(eq(job.id, next.id));
      } while (cursor && all.length < 20000);
      if (syncStopped) {
        // Nothing half-made: a stopped sync creates no batch. Re-run to sync fully.
        await markStopped(next.id, all.length, all.length);
        return true;
      }
      await createBatchFromRelations(next.orgId, `Synced connections (${all.length})`, all);
      if (seatId) await db.update(channelAccount).set({ lastSyncedAt: new Date() })
        .where(eq(channelAccount.id, seatId));
      await db.update(job).set({ status: "done", progress: all.length, total: all.length, updatedAt: new Date() })
        .where(eq(job.id, next.id));
    } else if (next.kind === "classify") {
      const batchId = String(next.payloadJson.batchId);
      const reclassifyAll = Boolean(next.payloadJson.reclassifyAll);
      // Set only by setup's mapping step — see classifyBatch.
      const fullPool = Boolean(next.payloadJson.fullPool);
      const stoppedEarly = { v: false };
      await classifyBatch(next.orgId, batchId, { reclassifyAll, fullPool },
        (done, total) => setProgress(next.id, done, total),
        async () => {
          const stop = await stopRequested(next.id);
          if (stop) stoppedEarly.v = true;
          return stop;
        });
      if (stoppedEarly.v) {
        const [row] = await db.select({ p: job.progress, t: job.total }).from(job).where(eq(job.id, next.id));
        await markStopped(next.id, row?.p ?? 0, row?.t ?? 0);
        return true;
      }
      await rankBatch(next.orgId, batchId);
    } else if (next.kind === "deep_enrich") {
      const ids = (next.payloadJson.connectionIds as string[]) ?? [];
      await setProgress(next.id, 0, ids.length);
      let done = 0;
      // However this run ends — finished, stopped, capped, crashed — nobody is
      // left holding a queued handle. There is no queue to inherit tomorrow.
      try {
        for (const id of ids) {
          if (await stopRequested(next.id)) { await markStopped(next.id, done, ids.length); return true; }
          if ((await enrichedToday(next.orgId)) >= env.DEEP_ENRICH_DAILY_CAP) {
            throw new Error(`Daily enrichment cap (${env.DEEP_ENRICH_DAILY_CAP}) reached after ${done} — the remaining ${ids.length - done} went back to the pool; pick them again after the reset.`);
          }
          const [who] = await db.select({
            firstName: connection.firstName,
            lastName: connection.lastName,
            companyRaw: connection.companyRaw,
          }).from(connection).where(eq(connection.id, id)).limit(1);
          const label = who
            ? `${who.firstName} ${who.lastName}${who.companyRaw ? ` @ ${who.companyRaw.split("|")[0]!.trim()}` : ""}`
            : id;
          await setProgress(next.id, done, ids.length, `Researching ${label}`);
          try { await deepEnrichOne(next.orgId, id); } catch { /* row carries its own error */ }
          done += 1;
          await setProgress(next.id, done, ids.length, `Saved ${label}`);
          // LinkedIn-respectful pacing: base gap + jitter between profile fetches.
          const gap = env.DEEP_ENRICH_MIN_GAP_SECONDS * 1000;
          await sleep(gap + Math.random() * gap);
        }
      } finally {
        await releaseIds(ids);
      }
    } else if (next.kind === "voice_scan") {
      const { identifier } = next.payloadJson as { identifier: string };
      const [seat] = await db.select().from(channelAccount)
        .where(and(eq(channelAccount.orgId, next.orgId), eq(channelAccount.status, "operational")));
      if (!seat) throw new Error("No operational LinkedIn seat.");
      await setProgress(next.id, 0, 3);
      const provider = getChannelProvider();
      // "me" resolves the seat owner — the voice we are sampling is theirs by
      // definition. A pasted URL is only an override, and we fall back if it
      // does not resolve (LinkedIn rejects many vanity slugs).
      let profile = null as Awaited<ReturnType<typeof provider.fetchProfile>>;
      if (identifier && identifier !== "me") {
        try { profile = await provider.fetchProfile({ accountId: seat.unipileAccountId, identifier }); }
        catch { profile = null; }
      }
      if (!profile) profile = await provider.fetchProfile({ accountId: seat.unipileAccountId, identifier: "me" });
      await setProgress(next.id, 1, 3);
      const sixMonthsAgo = Date.now() - 182 * 86400000;
      // The posts endpoint needs the provider-internal id, not the vanity slug.
      const postsId = profile?.providerId ?? identifier;
      const allPosts = postsId
        ? await provider.fetchRecentPosts({ accountId: seat.unipileAccountId, identifier: postsId, limit: 20 })
        : [];
      const posts = allPosts
        .filter((p) => !p.postedAt || new Date(p.postedAt).getTime() >= sixMonthsAgo)
        .slice(0, 14);
      const sample = posts.map((p) => p.text.slice(0, 500)).filter(Boolean).join("\n---\n");
      const profileBlock = [
        profile?.headline ? `Headline: ${profile.headline}` : "",
        profile?.about ? `About: ${profile.about.slice(0, 1200)}` : "",
      ].filter(Boolean).join("\n") || "(no profile text available)";
      if (!sample && profileBlock.startsWith("(no")) {
        throw new Error("Nothing to sample — no posts in the last 6 months and no About text. Check the URL.");
      }
      await setProgress(next.id, 2, 3);
      const out = await complete({
        stage: "deepdive",
        prompt: "voice-profile",
        vars: { posts_sample: sample || "(no posts in the last 6 months)", profile_block: profileBlock },
        schema: z.object({ profile: z.string().min(20) }),
        maxTokens: 400,
      });
      await updateOrgSettings(next.orgId, {
        voiceProfile: out.profile,
        voiceSampledAt: new Date().toISOString(),
      });
      await setProgress(next.id, 3, 3);
    } else if (next.kind === "activity_scan") {
      // Lightweight recency check: posts only, no LLM, no profile analysis.
      // Uses the stored member_id when the batch came from sync (1 request);
      // CSV rows need a profile fetch first to resolve the posts id (2 requests).
      const ids = (next.payloadJson.connectionIds as string[]) ?? [];
      await setProgress(next.id, 0, ids.length);
      const [seat] = await db.select().from(channelAccount)
        .where(and(eq(channelAccount.orgId, next.orgId), eq(channelAccount.status, "operational")));
      if (!seat) throw new Error("Connect a LinkedIn account in Settings first.");
      const provider = getChannelProvider();
      // A workspace can lower this without a deploy; the env value is the default.
      const scanSettings = await getOrgSettings(next.orgId);
      const scanCap = scanSettings.postScanDailyCap ?? env.ACTIVITY_SCAN_DAILY_CAP;
      let done = 0;
      for (const cid of ids) {
        if (await stopRequested(next.id)) { await markStopped(next.id, done, ids.length); return true; }
        if ((await scannedToday(next.orgId)) >= scanCap) {
          throw new Error(`Daily post-scan cap (${scanCap}) reached — remaining rows stay queued.`);
        }
        try {
          const [c] = await db.select().from(connection).where(eq(connection.id, cid));
          if (c) {
            let postsId = c.memberId ?? null;
            if (!postsId && (c.publicIdentifier || c.linkedinUrl)) {
              const ident = c.publicIdentifier ?? c.linkedinUrl!.split("/in/")[1]?.replace(/\/+$/, "");
              if (ident) {
                const prof = await provider.fetchProfile({ accountId: seat.unipileAccountId, identifier: ident });
                postsId = prof?.providerId ?? ident;
                if (prof?.providerId) await db.update(connection)
                  .set({ memberId: prof.providerId }).where(eq(connection.id, cid));
              }
            }
            let lastPostAt: Date | null = null;
            if (postsId) {
              // 5 rather than 3: same single request, and the dashboard wants a
              // choice of hooks rather than only the most recent thing said.
              const fetched = await provider.fetchRecentPosts({ accountId: seat.unipileAccountId, identifier: postsId, limit: 5 });
              const { newest } = await storePosts(next.orgId, cid, fetched);
              lastPostAt = newest;
            }
            await db.update(connection)
              .set({ lastPostAt: lastPostAt ?? c.lastPostAt, lastScanAt: new Date() })
              .where(eq(connection.id, cid));
          }
        } catch { /* skip the person, keep scanning */ }
        done += 1;
        await setProgress(next.id, done, ids.length);
        const gap = env.ACTIVITY_SCAN_MIN_GAP_SECONDS * 1000;
        await sleep(gap + Math.random() * gap);
      }
      // Scanning without judging leaves posts invisible to the dashboard, so
      // the scan queues its own follow-up rather than relying on the user
      // knowing there are two steps.
      // Scoped to what judgePosts will actually read. unjudgedCount is
      // bucket-blind, and Radar now stores the posts of 2nd/3rd-degree authors
      // who are deliberately excluded — so the blind count would chain a
      // post_judge after every scan that then judges nothing and reports 0/0.
      const { waitingToRead } = await import("@/modules/posts/feed");
      if ((await waitingToRead(next.orgId)).posts > 0) {
        await enqueue(next.orgId, "post_judge", {});
      }
    } else if (next.kind === "post_judge") {
      const stoppedEarly = { v: false };
      const r = await judgePosts(
        next.orgId,
        { limit: Number(next.payloadJson.limit ?? 0) || undefined },
        (done, total) => setProgress(next.id, done, total),
        async () => {
          const stop = await stopRequested(next.id);
          if (stop) stoppedEarly.v = true;
          return stop;
        },
      );
      await db.update(job).set({ payloadJson: { ...next.payloadJson, result: r }, updatedAt: new Date() })
        .where(eq(job.id, next.id));
      if (stoppedEarly.v) {
        const [row] = await db.select({ p: job.progress, t: job.total }).from(job).where(eq(job.id, next.id));
        await markStopped(next.id, row?.p ?? 0, row?.t ?? 0);
        return true;
      }
      if (r.failed > 0 && r.judged === 0) {
        throw new Error(`All ${r.failed} model calls failed — posts stay unjudged, press again to retry.`);
      }
    } else if (next.kind === "event_extended") {
      const payload = next.payloadJson as { country?: string; metro?: string; eventName?: string; days?: number; degree?: "first" | "extended"; excludeCompanies?: string };
      if (!payload.country) throw new Error("Event search needs a country.");
      if (!payload.eventName) throw new Error("Event search needs an event name.");
      const stoppedEarly = { v: false };
      const result = await runEventExtended(
        next.orgId,
        { country: payload.country, eventName: payload.eventName, days: payload.days,
          degree: payload.degree, excludeCompanies: payload.excludeCompanies },
        (done, total) => setProgress(next.id, done, total),
        async () => {
          const stop = await stopRequested(next.id);
          if (stop) stoppedEarly.v = true;
          return stop;
        },
      );
      await db.update(job).set({
        payloadJson: { ...payload, result },
        updatedAt: new Date(),
      }).where(eq(job.id, next.id));
      if (stoppedEarly.v) {
        const [row] = await db.select({ p: job.progress, t: job.total }).from(job).where(eq(job.id, next.id));
        await markStopped(next.id, row?.p ?? 0, row?.t ?? 0);
        return true;
      }
    } else if (next.kind === "event_scan") {
      const payload = next.payloadJson as { metro?: string; days?: number; eventName?: string; batchId?: string };
      if (!payload.metro) throw new Error("Event scan needs a metro.");
      const stoppedEarly = { v: false };
      const result = await runEventScan(
        next.orgId,
        {
          metro: payload.metro,
          days: payload.days,
          eventName: payload.eventName,
          batchId: payload.batchId,
        },
        (done, total) => setProgress(next.id, done, total),
        async () => {
          const stop = await stopRequested(next.id);
          if (stop) stoppedEarly.v = true;
          return stop;
        },
      );
      await db.update(job).set({
        payloadJson: { ...payload, result },
        updatedAt: new Date(),
      }).where(eq(job.id, next.id));
      if (stoppedEarly.v) {
        const [row] = await db.select({ p: job.progress, t: job.total }).from(job).where(eq(job.id, next.id));
        await markStopped(next.id, row?.p ?? 0, row?.t ?? 0);
        return true;
      }
    } else if (next.kind === "account_pulse") {
      const payload = next.payloadJson as { companyKey?: string; companyName?: string };
      if (!payload.companyKey) throw new Error("Account Pulse needs a company.");
      // No stop handling on purpose, and the button is not offered for it: a
      // refresh is one Haiku batch and one Sonnet call, so the window in which
      // stopping would save anything is shorter than the round trip that asks.
      // Every other job here runs for minutes and earns its stop check.
      const result = await runAccountPulse(
        next.orgId,
        payload.companyKey,
        payload.companyName ?? payload.companyKey,
        (done, total) => setProgress(next.id, done, total),
      );
      // loadPulse reads the triggers back out of here — see the note at the top
      // of modules/pulse/index.ts on why they live in the payload rather than a
      // table of their own.
      await db.update(job).set({
        payloadJson: { ...payload, result },
        updatedAt: new Date(),
      }).where(eq(job.id, next.id));
      // A workspace with no allowlisted domains is NOT a failed run. The other
      // bands still ran, and triggers derived from signals already stored are
      // still worth having — failing here would mark the job failed and hide
      // them, since loadPulse only reads back a completed run. The panel reads
      // result.domains and says the news band is empty because nothing was
      // fetched, which is the distinction that matters to whoever is reading it.
    } else if (next.kind === "intel_scan") {
      const payload = next.payloadJson as {
        companyKey?: string; companyName?: string;
        window?: "past_day" | "past_week" | "past_month"; limit?: number;
      };
      if (!payload.companyKey || !payload.companyName) {
        throw new Error("Intelligence needs a company.");
      }
      const result = await runIntelScan(
        next.orgId,
        payload.companyKey,
        payload.companyName,
        { window: payload.window, limit: payload.limit },
        (done, total) => setProgress(next.id, done, total),
      );
      // Same place Pulse keeps its run summary: the panel reads counts back out
      // of the job, so "what did the last scan actually find" survives without
      // a table whose only job is to remember one row per run.
      await db.update(job).set({
        payloadJson: { ...payload, result },
        updatedAt: new Date(),
      }).where(eq(job.id, next.id));
    } else {
      throw new Error(`Unknown job kind: ${next.kind}`);
    }
    await db.update(job).set({ status: "done", updatedAt: new Date() })
      .where(and(eq(job.id, next.id), inArray(job.status, ["running", "stopping"])));
  } catch (e) {
    await db.update(job).set({
      status: "failed",
      error: e instanceof Error ? e.message.slice(0, 800) : "unknown",
      updatedAt: new Date(),
    // Same compare-and-swap: a job already declared dead stays dead, with the
    // sweep's explanation intact, rather than being re-failed with a message
    // about a symptom of the death rather than its cause.
    }).where(and(eq(job.id, next.id), inArray(job.status, ["running", "stopping"])));
  } finally {
    // Every exit runs through here, including the several `return true`s inside
    // the try — a leaked interval would go on stamping a finished job forever
    // and make it permanently unsweepable.
    stopHeartbeat();
  }
  return true;
}
