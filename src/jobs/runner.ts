/**
 * DB-backed job runner — no Redis in the standalone. worker.ts polls for
 * queued jobs; the web app only INSERTS job rows and reads progress.
 */
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db, connection, job, channelAccount } from "@/db";
import { getChannelProvider, type Relation } from "@/providers/channel";
import { createBatchFromRelations } from "@/modules/connections/create-batch";
import { env } from "@/lib/env";
import { classifyBatch } from "@/modules/matching/service-fit";
import { rankBatch } from "@/modules/scoring/rank";
import { deepEnrichOne } from "@/modules/enrich/deep-dive";
import { z } from "zod";
import { complete } from "@/llm/client";
import { updateOrgSettings } from "@/modules/settings/org-settings";
import { idleSweep, releaseIds } from "@/jobs/reap";
import { runEventScan } from "@/modules/radar/scan";
import { runEventExtended } from "@/modules/radar/extended";

export async function enqueue(orgId: string, kind: string, payload: Record<string, unknown>) {
  const [row] = await db.insert(job).values({ orgId, kind, payloadJson: payload }).returning();
  return row;
}

async function stopRequested(jobId: string): Promise<boolean> {
  const [row] = await db.select({ s: job.status }).from(job).where(eq(job.id, jobId));
  return row?.s === "stopping";
}
async function markStopped(jobId: string, progress: number, total: number) {
  await db.update(job).set({ status: "stopped", progress, total, updatedAt: new Date() })
    .where(eq(job.id, jobId));
}
async function scannedToday(orgId: string): Promise<number> {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.orgId, orgId), gte(connection.lastScanAt, today)));
  return row?.n ?? 0;
}

async function setProgress(id: string, progress: number, total: number) {
  await db.update(job).set({ progress, total, updatedAt: new Date() }).where(eq(job.id, id));
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
      const stoppedEarly = { v: false };
      await classifyBatch(next.orgId, batchId, { reclassifyAll },
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
          try { await deepEnrichOne(next.orgId, id); } catch { /* row carries its own error */ }
          done += 1;
          await setProgress(next.id, done, ids.length);
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
      let done = 0;
      for (const cid of ids) {
        if (await stopRequested(next.id)) { await markStopped(next.id, done, ids.length); return true; }
        if ((await scannedToday(next.orgId)) >= env.ACTIVITY_SCAN_DAILY_CAP) {
          throw new Error(`Daily post-scan cap (${env.ACTIVITY_SCAN_DAILY_CAP}) reached — remaining rows stay queued.`);
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
              const posts = await provider.fetchRecentPosts({ accountId: seat.unipileAccountId, identifier: postsId, limit: 3 });
              for (const post of posts) {
                const d = post.postedAt ? new Date(post.postedAt) : null;
                if (d && !Number.isNaN(d.getTime()) && (!lastPostAt || d > lastPostAt)) lastPostAt = d;
              }
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
    } else if (next.kind === "event_extended") {
      const payload = next.payloadJson as { metro?: string; eventName?: string; days?: number };
      if (!payload.metro) throw new Error("Event search needs a metro.");
      if (!payload.eventName) throw new Error("Event search needs an event name.");
      const stoppedEarly = { v: false };
      const result = await runEventExtended(
        next.orgId,
        { metro: payload.metro, eventName: payload.eventName, days: payload.days },
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
    } else {
      throw new Error(`Unknown job kind: ${next.kind}`);
    }
    await db.update(job).set({ status: "done", updatedAt: new Date() }).where(eq(job.id, next.id));
  } catch (e) {
    await db.update(job).set({
      status: "failed",
      error: e instanceof Error ? e.message.slice(0, 800) : "unknown",
      updatedAt: new Date(),
    }).where(eq(job.id, next.id));
  }
  return true;
}
