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
  if (!next) return false;

  await db.update(job).set({ status: "running", updatedAt: new Date() }).where(eq(job.id, next.id));
  try {
    if (next.kind === "sync") {
      const accountId = String(next.payloadJson.accountId);
      const seatId = String(next.payloadJson.seatId ?? "");
      const provider = getChannelProvider();
      const all: Relation[] = [];
      let cursor: string | null = null;
      do {
        const page = await provider.fetchRelations({ accountId, cursor, limit: 100 });
        all.push(...page.items);
        cursor = page.cursor;
        // Live banner: total stays 0 (unknown until the last page) — the UI
        // renders "Syncing · N pulled" with an indeterminate bar.
        await db.update(job).set({ progress: all.length, updatedAt: new Date() })
          .where(eq(job.id, next.id));
      } while (cursor && all.length < 20000);
      await createBatchFromRelations(next.orgId, `Synced connections (${all.length})`, all);
      if (seatId) await db.update(channelAccount).set({ lastSyncedAt: new Date() })
        .where(eq(channelAccount.id, seatId));
      await db.update(job).set({ status: "done", progress: all.length, total: all.length, updatedAt: new Date() })
        .where(eq(job.id, next.id));
    } else if (next.kind === "classify") {
      const batchId = String(next.payloadJson.batchId);
      const reclassifyAll = Boolean(next.payloadJson.reclassifyAll);
      await classifyBatch(next.orgId, batchId, { reclassifyAll }, (done, total) => setProgress(next.id, done, total));
      await rankBatch(next.orgId, batchId);
    } else if (next.kind === "deep_enrich") {
      const ids = (next.payloadJson.connectionIds as string[]) ?? [];
      await setProgress(next.id, 0, ids.length);
      let done = 0;
      for (const id of ids) {
        if (await stopRequested(next.id)) { await markStopped(next.id, done, ids.length); return true; }
        if ((await enrichedToday(next.orgId)) >= env.DEEP_ENRICH_DAILY_CAP) {
          throw new Error(`Daily enrichment cap (${env.DEEP_ENRICH_DAILY_CAP}) reached — remaining rows stay queued; re-run tomorrow.`);
        }
        try { await deepEnrichOne(next.orgId, id); } catch { /* row carries its own error */ }
        done += 1;
        await setProgress(next.id, done, ids.length);
        // LinkedIn-respectful pacing: base gap + jitter between profile fetches.
        const gap = env.DEEP_ENRICH_MIN_GAP_SECONDS * 1000;
        await sleep(gap + Math.random() * gap);
      }
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
