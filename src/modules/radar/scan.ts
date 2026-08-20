/**
 * Fast event scan — every pitchable contact, not a shortlist.
 * Target: ~1,500 people in about 5 minutes via concurrent Unipile calls.
 * Deep-enrich pacing (12–25s) is left alone.
 */
import { and, asc, eq, or, sql } from "drizzle-orm";
import { db, channelAccount, connection } from "@/db";
import { env } from "@/lib/env";
import { getChannelProvider } from "@/providers/channel";
import { toCountry } from "@/modules/connections/country";
import { metroBySlug, stampMetro } from "@/modules/geo/metros";
import { mentionForEvent, mentionForSlug } from "@/modules/radar/mentions";
import { countryBySlug } from "@/modules/geo/countries";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EventScanPayload {
  metro: string;
  days?: number;
  eventName?: string;
  batchId?: string;
  country?: string;
  /** Skip the "already scanned this window" filter — used after a fresh 2nd/3rd import. */
  force?: boolean;
}

export interface EventScanResult {
  restamped: number;
  backfilled: number;
  scanned: number;
  mentioned: number;
  skippedFresh: number;
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
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => {
      const s = stampMetro({
        location: r.location,
        headline: r.headlineRaw ?? r.positionRaw,
        country: r.country,
      });
      if (s.metro) n += 1;
      return { id: r.id, metro: s.metro, evidence: s.metroEvidence };
    });
    if (chunk.length === 0) continue;
    const values = sql.join(chunk.map((row) =>
      sql`(${row.id}::text, ${row.metro}::text, ${row.evidence}::text)`,
    ), sql`, `);
    await db.execute(sql`
      update connection as c
      set metro = v.metro, metro_evidence = v.evidence
      from (values ${values}) as v(id, metro, evidence)
      where c.id = v.id
    `);
  }
  return n;
}

function isRateLimit(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /429|rate.?limit|too many requests/i.test(msg);
}

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let wait = 1500;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      if (!isRateLimit(e) || attempt >= 4) throw e;
      await sleep(wait + Math.random() * 400);
      wait = Math.min(wait * 2, 12000);
    }
  }
}

export async function runEventScan(
  orgId: string,
  payload: EventScanPayload,
  onProgress?: (done: number, total: number) => Promise<void>,
  shouldStop?: () => Promise<boolean>,
): Promise<EventScanResult> {
  const country = countryBySlug(payload.country);
  const metro = metroBySlug(payload.metro);
  if (!metro && !country) throw new Error(`Unknown place "${payload.metro}".`);
  const eventName = payload.eventName?.trim() || undefined;
  const concurrency = Math.max(1, env.EVENT_SCAN_CONCURRENCY);
  const gapMs = Math.max(0, env.EVENT_SCAN_MIN_GAP_SECONDS) * 1000;
  const skipAfter = payload.force
    ? new Date(0)
    : new Date(Date.now() - env.EVENT_SCAN_SKIP_HOURS * 3600_000);

  const restamped = await restampOrg(orgId, payload.batchId);
  const result: EventScanResult = {
    restamped, backfilled: 0, scanned: 0, mentioned: 0, skippedFresh: 0,
  };
  if (shouldStop && await shouldStop()) return result;

  const [seat] = await db.select().from(channelAccount)
    .where(and(eq(channelAccount.orgId, orgId), eq(channelAccount.status, "operational")));
  if (!seat) return result;

  const provider = getChannelProvider();
  const scope = [eq(connection.orgId, orgId), eq(connection.bucket, "pitchable")];
  if (payload.batchId) scope.push(eq(connection.batchId, payload.batchId));

  const pool = await db.select({
    id: connection.id,
    memberId: connection.memberId,
    publicIdentifier: connection.publicIdentifier,
    linkedinUrl: connection.linkedinUrl,
    location: connection.location,
    headlineRaw: connection.headlineRaw,
    positionRaw: connection.positionRaw,
    lastPostAt: connection.lastPostAt,
    lastScanAt: connection.lastScanAt,
  }).from(connection).where(and(
    ...scope,
    or(
      sql`${connection.memberId} is not null`,
      sql`${connection.publicIdentifier} is not null`,
      sql`${connection.linkedinUrl} is not null`,
    ),
  )).orderBy(sql`last_scan_at asc nulls first`, asc(connection.rank));

  const todo = pool.filter((c) => !c.lastScanAt || c.lastScanAt < skipAfter);
  result.skippedFresh = pool.length - todo.length;
  if (onProgress) await onProgress(0, todo.length);
  if (todo.length === 0) return result;

  let next = 0;
  let done = 0;

  const scanOne = async (c: (typeof todo)[number]) => {
    const ident = c.memberId
      ?? c.publicIdentifier
      ?? c.linkedinUrl?.split("/in/")[1]?.replace(/\/+$/, "").split(/[?#]/)[0]
      ?? null;
    if (!ident) {
      await db.update(connection).set({ lastScanAt: new Date() }).where(eq(connection.id, c.id));
      return;
    }

    let postsId = c.memberId;
    let location = c.location;
    if (!postsId || !location) {
      const profile = await withBackoff(() =>
        provider.fetchProfile({ accountId: seat.unipileAccountId, identifier: ident }));
      if (profile) {
        postsId = profile.providerId ?? postsId ?? ident;
        if (profile.location) {
          location = profile.location;
          result.backfilled += 1;
        }
        const country = toCountry(profile.location);
        const stamped = stampMetro({
          location: profile.location ?? c.location,
          headline: profile.headline ?? c.headlineRaw ?? c.positionRaw,
          country,
        });
        await db.update(connection).set({
          memberId: profile.providerId ?? c.memberId,
          location: profile.location ?? c.location,
          country: country ?? undefined,
          metro: stamped.metro,
          metroEvidence: stamped.metroEvidence,
          headlineRaw: profile.headline ?? c.headlineRaw,
        }).where(eq(connection.id, c.id));
      }
    }

    const useId = postsId ?? ident;
    const posts = await withBackoff(() =>
      provider.fetchRecentPosts({ accountId: seat.unipileAccountId, identifier: useId, limit: 5 }));
    let lastPostAt: Date | null = null;
    for (const post of posts) {
      const d = post.postedAt ? new Date(post.postedAt) : null;
      if (d && !Number.isNaN(d.getTime()) && (!lastPostAt || d > lastPostAt)) lastPostAt = d;
    }
    const mention = country && eventName
      ? mentionForEvent(posts, eventName, country.slug)
      : metro
        ? mentionForSlug(posts, metro.slug, eventName)
        : null;
    if (mention) result.mentioned += 1;
    await db.update(connection).set({
      lastPostAt: lastPostAt ?? c.lastPostAt,
      lastScanAt: new Date(),
      mentionMetro: mention?.metro ?? null,
      mentionAt: mention?.postedAt ?? null,
      mentionSnippet: mention?.snippet ?? null,
      mentionKind: mention?.kind ?? null,
    }).where(eq(connection.id, c.id));
    result.scanned += 1;
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
    for (;;) {
      if (shouldStop && await shouldStop()) return;
      const i = next;
      next += 1;
      if (i >= todo.length) return;
      try {
        await scanOne(todo[i]);
      } catch { /* one person must not kill the run */ }
      done += 1;
      if (onProgress) await onProgress(done, todo.length);
      if (gapMs > 0) await sleep(gapMs);
    }
  }));

  return result;
}
