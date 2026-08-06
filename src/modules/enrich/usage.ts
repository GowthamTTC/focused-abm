/** Daily-cap usage — mirrors runner.ts enrichedToday EXACTLY (calendar day,
 *  server midnight = UTC on Railway), so the meter shows the same truth the
 *  brake enforces. Resets 00:00 UTC (= 05:30 IST). */
import { and, eq, gte, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { env } from "@/lib/env";

export async function getDailyEnrichUsage(orgId: string): Promise<{
  used: number; cap: number; resetsAt: Date;
}> {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const resetsAt = new Date(since.getTime() + 24 * 60 * 60 * 1000);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.orgId, orgId), gte(connection.enrichedAt, since)));
  return { used: row?.n ?? 0, cap: env.DEEP_ENRICH_DAILY_CAP, resetsAt };
}

export function resetsIn(resetsAt: Date): string {
  const ms = Math.max(0, resetsAt.getTime() - Date.now());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
