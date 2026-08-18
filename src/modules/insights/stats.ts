/** Shared network-stats queries + the daily snapshot upsert. Every number on
 *  the Overview pages traces to these — no invented metrics, ever. */
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, connection, networkSnapshot } from "@/db";

export async function networkStats(orgId: string) {
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    pitchable: sql<number>`count(*) filter (where bucket = 'pitchable')::int`,
    offIcp: sql<number>`count(*) filter (where bucket = 'off_icp')::int`,
    peers: sql<number>`count(*) filter (where bucket = 'peer_competitor')::int`,
    excluded: sql<number>`count(*) filter (where bucket = 'excluded')::int`,
    unclassified: sql<number>`count(*) filter (where bucket is null)::int`,
    enriched: sql<number>`count(*) filter (where enrich_status = 'done')::int`,
    sent: sql<number>`count(*) filter (where sent_at is not null)::int`,
    scanned: sql<number>`count(*) filter (where last_scan_at is not null or enrich_status = 'done')::int`,
    active7: sql<number>`count(*) filter (where last_post_at >= now() - interval '7 days')::int`,
    active30: sql<number>`count(*) filter (where last_post_at >= now() - interval '30 days')::int`,
    active90: sql<number>`count(*) filter (where last_post_at >= now() - interval '90 days')::int`,
  }).from(connection).where(eq(connection.orgId, orgId));
  return row;
}

export async function serviceSplit(orgId: string) {
  return db.select({
    slug: sql<string>`coalesce(service_slug, '—')`,
    n: sql<number>`count(*)::int`,
  }).from(connection)
    .where(and(eq(connection.orgId, orgId), eq(connection.bucket, "pitchable")))
    .groupBy(sql`coalesce(service_slug, '—')`).orderBy(desc(sql`count(*)`));
}

export async function countrySplit(orgId: string, limit = 6) {
  const rows = await db.select({
    country: connection.country,
    n: sql<number>`count(*)::int`,
  }).from(connection)
    .where(and(eq(connection.orgId, orgId), isNotNull(connection.country)))
    .groupBy(connection.country).orderBy(desc(sql`count(*)`)).limit(limit);
  const [{ known = 0 } = {}] = await db.select({
    known: sql<number>`count(*) filter (where country is not null)::int`,
  }).from(connection).where(eq(connection.orgId, orgId));
  return Object.assign(rows.filter((r) => r.country) as { country: string; n: number }[], { known });
}

/** Upsert today's snapshot — called from the Insights page load, so the
 *  growth line gains at most one point per day, all observed. */
export async function snapshotToday(orgId: string) {
  const day = new Date().toISOString().slice(0, 10);
  const s = await networkStats(orgId);
  const [existing] = await db.select().from(networkSnapshot)
    .where(and(eq(networkSnapshot.orgId, orgId), eq(networkSnapshot.day, day)));
  if (existing) {
    await db.update(networkSnapshot).set({
      total: s.total, pitchable: s.pitchable, enriched: s.enriched, active30: s.active30, sent: s.sent,
    }).where(eq(networkSnapshot.id, existing.id));
  } else {
    await db.insert(networkSnapshot).values({
      orgId, day, total: s.total, pitchable: s.pitchable, enriched: s.enriched, active30: s.active30, sent: s.sent,
    });
  }
  return db.select().from(networkSnapshot).where(eq(networkSnapshot.orgId, orgId))
    .orderBy(networkSnapshot.day);
}

export async function newestConnections(orgId: string, limit = 6) {
  return db.select().from(connection).where(eq(connection.orgId, orgId))
    .orderBy(desc(connection.createdAt)).limit(limit);
}

export async function weekdayActivity(orgId: string) {
  return db.select({
    dow: sql<number>`extract(dow from last_post_at)::int`,
    n: sql<number>`count(*)::int`,
  }).from(connection)
    .where(and(eq(connection.orgId, orgId), gte(connection.lastPostAt, sql`now() - interval '90 days'`)))
    .groupBy(sql`1`).orderBy(sql`1`);
}
