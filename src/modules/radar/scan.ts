/**
 * Event scan: restamp metros for free, then a small LinkedIn budget —
 * backfill missing cities for top people, refresh posts for the metro set.
 * Never walks the whole network.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, channelAccount, connection } from "@/db";
import { env } from "@/lib/env";
import { getChannelProvider } from "@/providers/channel";
import { toCountry } from "@/modules/connections/country";
import { metroBySlug, stampMetro } from "@/modules/geo/metros";
import { mentionForSlug } from "@/modules/radar/mentions";

const BACKFILL_CAP = 30;
const ACTIVITY_CAP = 40;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EventScanPayload {
  metro: string;
  days?: number;
  eventName?: string;
  batchId?: string;
}

export interface EventScanResult {
  restamped: number;
  backfilled: number;
  scanned: number;
  mentioned: number;
}

async function restampOrg(orgId: string, batchId?: string): Promise<number> {
  const conds = [eq(connection.orgId, orgId)];
  if (batchId) conds.push(eq(connection.batchId, batchId));
  const rows = await db.select({
    id: connection.id,
    location: connection.location,
    headlineRaw: connection.headlineRaw,
    positionRaw: connection.positionRaw,
    country: connection.country,
  }).from(connection).where(and(...conds));

  let n = 0;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => {
      const s = stampMetro({
        location: r.location,
        headline: r.headlineRaw ?? r.positionRaw,
        country: r.country,
      });
      return { id: r.id, ...s };
    });
    for (const row of chunk) {
      await db.update(connection).set({
        metro: row.metro,
        metroEvidence: row.metroEvidence,
      }).where(eq(connection.id, row.id));
      if (row.metro) n += 1;
    }
  }
  return n;
}

export async function runEventScan(
  orgId: string,
  payload: EventScanPayload,
  onProgress?: (done: number, total: number) => Promise<void>,
  shouldStop?: () => Promise<boolean>,
): Promise<EventScanResult> {
  const metro = metroBySlug(payload.metro);
  if (!metro) throw new Error(`Unknown metro "${payload.metro}".`);
  const eventName = payload.eventName?.trim() || undefined;

  const restamped = await restampOrg(orgId, payload.batchId);
  if (shouldStop && await shouldStop()) {
    return { restamped, backfilled: 0, scanned: 0, mentioned: 0 };
  }

  const [seat] = await db.select().from(channelAccount)
    .where(and(eq(channelAccount.orgId, orgId), eq(channelAccount.status, "operational")));

  const result: EventScanResult = { restamped, backfilled: 0, scanned: 0, mentioned: 0 };
  if (!seat) return result;

  const provider = getChannelProvider();
  const gap = env.ACTIVITY_SCAN_MIN_GAP_SECONDS * 1000;
  const scope = [eq(connection.orgId, orgId), eq(connection.bucket, "pitchable")];
  if (payload.batchId) scope.push(eq(connection.batchId, payload.batchId));

  // 1 — backfill city for high-rank people with no location (profile only).
  const needCity = await db.select({
    id: connection.id,
    publicIdentifier: connection.publicIdentifier,
    linkedinUrl: connection.linkedinUrl,
    memberId: connection.memberId,
    location: connection.location,
    headlineRaw: connection.headlineRaw,
    positionRaw: connection.positionRaw,
  }).from(connection).where(and(
    ...scope,
    isNull(connection.location),
    or(sql`${connection.publicIdentifier} is not null`, sql`${connection.linkedinUrl} is not null`, sql`${connection.memberId} is not null`),
  )).orderBy(asc(connection.rank)).limit(BACKFILL_CAP);

  const totalWork = needCity.length + ACTIVITY_CAP;
  let done = 0;
  if (onProgress) await onProgress(0, totalWork);

  for (const c of needCity) {
    if (shouldStop && await shouldStop()) return result;
    try {
      const ident = c.memberId ?? c.publicIdentifier ?? c.linkedinUrl?.split("/in/")[1]?.replace(/\/+$/, "");
      if (!ident) continue;
      const profile = await provider.fetchProfile({ accountId: seat.unipileAccountId, identifier: ident });
      if (profile?.location) {
        const country = toCountry(profile.location);
        const stamped = stampMetro({
          location: profile.location,
          headline: profile.headline ?? c.headlineRaw ?? c.positionRaw,
          country,
        });
        await db.update(connection).set({
          location: profile.location,
          country,
          metro: stamped.metro,
          metroEvidence: stamped.metroEvidence,
          memberId: profile.providerId ?? c.memberId,
          headlineRaw: profile.headline ?? c.headlineRaw,
        }).where(eq(connection.id, c.id));
        result.backfilled += 1;
      }
    } catch { /* leave the person unknown */ }
    done += 1;
    if (onProgress) await onProgress(done, totalWork);
    await sleep(gap + Math.random() * gap);
  }

  // 2 — activity + mention pass for people already in this metro, then a few
  //     T1/T2 not-in-metro (they may be travelling).
  const inMetro = await db.select({
    id: connection.id,
    memberId: connection.memberId,
    publicIdentifier: connection.publicIdentifier,
    linkedinUrl: connection.linkedinUrl,
    lastPostAt: connection.lastPostAt,
  }).from(connection).where(and(...scope, eq(connection.metro, metro.slug)))
    .orderBy(sql`last_scan_at asc nulls first`, asc(connection.rank))
    .limit(ACTIVITY_CAP);

  const leftover = Math.max(0, ACTIVITY_CAP - inMetro.length);
  const travelers = leftover === 0 ? [] : await db.select({
    id: connection.id,
    memberId: connection.memberId,
    publicIdentifier: connection.publicIdentifier,
    linkedinUrl: connection.linkedinUrl,
    lastPostAt: connection.lastPostAt,
  }).from(connection).where(and(
    ...scope,
    sql`(${connection.metro} is distinct from ${metro.slug})`,
    inArray(connection.tier, [1, 2]),
    or(sql`${connection.memberId} is not null`, sql`${connection.publicIdentifier} is not null`, sql`${connection.linkedinUrl} is not null`),
  )).orderBy(asc(connection.rank)).limit(leftover);

  const activityIds = [...inMetro, ...travelers];
  for (const c of activityIds) {
    if (shouldStop && await shouldStop()) return result;
    try {
      let postsId = c.memberId ?? null;
      if (!postsId) {
        const ident = c.publicIdentifier ?? c.linkedinUrl?.split("/in/")[1]?.replace(/\/+$/, "");
        if (ident) {
          const prof = await provider.fetchProfile({ accountId: seat.unipileAccountId, identifier: ident });
          postsId = prof?.providerId ?? ident;
          if (prof?.providerId || prof?.location) {
            const country = toCountry(prof.location);
            const stamped = stampMetro({ location: prof.location, headline: prof.headline, country });
            await db.update(connection).set({
              memberId: prof.providerId ?? undefined,
              location: prof.location ?? undefined,
              country: country ?? undefined,
              metro: stamped.metro ?? undefined,
              metroEvidence: stamped.metroEvidence ?? undefined,
            }).where(eq(connection.id, c.id));
          }
        }
      }
      if (postsId) {
        const posts = await provider.fetchRecentPosts({
          accountId: seat.unipileAccountId, identifier: postsId, limit: 5,
        });
        let lastPostAt: Date | null = null;
        for (const post of posts) {
          const d = post.postedAt ? new Date(post.postedAt) : null;
          if (d && !Number.isNaN(d.getTime()) && (!lastPostAt || d > lastPostAt)) lastPostAt = d;
        }
        const mention = mentionForSlug(posts, metro.slug, eventName);
        if (mention) result.mentioned += 1;
        await db.update(connection).set({
          lastPostAt: lastPostAt ?? c.lastPostAt,
          lastScanAt: new Date(),
          mentionMetro: mention?.metro ?? null,
          mentionAt: mention?.postedAt ?? null,
          mentionSnippet: mention?.snippet ?? null,
          mentionKind: mention?.kind ?? null,
        }).where(eq(connection.id, c.id));
      } else {
        await db.update(connection).set({ lastScanAt: new Date() }).where(eq(connection.id, c.id));
      }
      result.scanned += 1;
    } catch { /* skip */ }
    done += 1;
    if (onProgress) await onProgress(done, totalWork);
    await sleep(gap + Math.random() * gap);
  }

  return result;
}
