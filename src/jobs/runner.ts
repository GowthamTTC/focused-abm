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
