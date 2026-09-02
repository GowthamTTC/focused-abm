/**
 * The post-scan meter.
 *
 * Mirrors runner.scannedToday EXACTLY — setUTCHours, not setHours. The
 * enrichment meter in modules/enrich/usage.ts uses LOCAL midnight because
 * enrichedToday does; copying that here would make this meter and the brake it
 * describes disagree on any host that is not on UTC. runner.scannedToday is
 * module-private, so this is deliberately new code rather than an import, and
 * the verification harness asserts the two agree.
 *
 * It counts distinct PEOPLE stamped today across the whole workspace — which
 * includes Radar's event scan, since that stamps last_scan_at too while being
 * exempt from postScanDailyCap. Anything shown to a user from this number has
 * to say "across the whole workspace, any scan including Radar", because that
 * is what it measures.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { env } from "@/lib/env";
import { getOrgSettings } from "@/modules/settings/org-settings";

export async function getDailyScanUsage(orgId: string): Promise<{
  used: number; cap: number; remaining: number; resetsAt: Date;
}> {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const settings = await getOrgSettings(orgId);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.orgId, orgId), gte(connection.lastScanAt, since)));
  const used = row?.n ?? 0;
  const cap = settings.postScanDailyCap ?? env.ACTIVITY_SCAN_DAILY_CAP;
  return {
    used, cap,
    remaining: Math.max(0, cap - used),
    resetsAt: new Date(since.getTime() + 24 * 60 * 60 * 1000),
  };
}
