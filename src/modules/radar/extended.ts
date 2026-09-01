/**
 * 2nd + 3rd: search LinkedIn posts for the event name, then keep authors.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { db, channelAccount, connection, connectionBatch } from "@/db";
import { env } from "@/lib/env";
import { getChannelProvider } from "@/providers/channel";
import { toCountry } from "@/modules/connections/country";
import { stampMetro } from "@/modules/geo/metros";
import { countryBySlug } from "@/modules/geo/countries";
import { mentionForEvent } from "@/modules/radar/mentions";
import { runEventScan } from "@/modules/radar/scan";
import { classifyBatch } from "@/modules/matching/service-fit";
import { rankBatch } from "@/modules/scoring/rank";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function splitHeadline(headline: string | null): { position: string | null; company: string | null } {
  if (!headline) return { position: null, company: null };
  const parts = headline.split(/\s+at\s+/i);
  if (parts.length >= 2) {
    return { position: parts[0].trim() || null, company: parts.slice(1).join(" at ").trim() || null };
  }
  return { position: headline, company: null };
}

function datePosted(days?: number): "past_day" | "past_week" | "past_month" {
  const d = days ?? 7;
  if (d <= 1) return "past_day";
  if (d <= 7) return "past_week";
  return "past_month";
}

export async function runEventExtended(
  orgId: string,
  payload: { country: string; eventName: string; days?: number; metro?: string; degree?: "first" | "extended" },
  onProgress?: (done: number, total: number) => Promise<void>,
  shouldStop?: () => Promise<boolean>,
): Promise<{ found: number; scanned: number; batchId: string }> {
  const eventName = payload.eventName.trim();
  if (!eventName) throw new Error("Event name is required for 2nd + 3rd degree search.");
  const scope = countryBySlug(payload.country);
  if (!scope) throw new Error("Pick United States or India for 2nd + 3rd search.");

  const [seat] = await db.select().from(channelAccount)
    .where(and(eq(channelAccount.orgId, orgId), eq(channelAccount.status, "operational")));
  if (!seat) throw new Error("Connect a LinkedIn account in Settings first.");

  const cap = env.EVENT_EXTENDED_CAP;

  // 1st degree: scan your own pitchable connections for the event in their posts.
  // Do not use LinkedIn post search + match — that misses most of the warm network.
  if (payload.degree === "first") {
    if (onProgress) await onProgress(0, cap);
    const scan = await runEventScan(
      orgId,
      {
        metro: "sf-bay-area",
        country: scope.slug,
        eventName,
        force: true,
        limit: cap,
        firstDegreeOnly: true,
      },
      onProgress,
      shouldStop,
    );
    if (onProgress) await onProgress(scan.scanned, Math.max(scan.scanned, 1));
    return { found: scan.mentioned, scanned: scan.scanned, batchId: "" };
  }

  const provider = getChannelProvider();
  const authors = new Map<string, {
    firstName: string; lastName: string; headline: string | null; location: string | null;
    profileUrl: string | null; publicIdentifier: string | null; memberId: string | null;
    networkDistance: "2" | "3"; snippet: string; postedAt: Date | null;
  }>();
  let cursor: string | null = null;
  let pages = 0;

  if (onProgress) await onProgress(0, cap);

  do {
    if (shouldStop && await shouldStop()) break;
    let page: { items: Array<{
      text: string; postedAt: string | Date | null; isCompany?: boolean;
      author: {
        firstName: string; lastName: string; headline: string | null; location: string | null;
        profileUrl: string | null; publicIdentifier: string | null; memberId: string | null;
        networkDistance: "2" | "3";
      };
    }>; cursor: string | null } | null = null;
    try {
      page = await Promise.race([
        provider.searchPosts({
          accountId: seat.unipileAccountId,
          keywords: eventName,
          datePosted: datePosted(payload.days),
          cursor,
          limit: 50,
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("search-timeout")), 20_000);
        }),
      ]);
    } catch {
      if (onProgress) await onProgress(authors.size, cap);
      break;
    }
    if (!page) break;
    for (const post of page.items) {
      if (post.isCompany) continue;
      const hit = mentionForEvent([{ text: post.text, postedAt: post.postedAt }], eventName, scope.slug);
      if (!hit) continue;
      const locCountry = toCountry(post.author.location);
      if (locCountry && locCountry !== scope.country) continue;
      const key = (post.author.publicIdentifier || post.author.profileUrl || post.author.memberId
        || `${post.author.firstName}-${post.author.lastName}`).toLowerCase();
      const when = hit.postedAt;
      const prev = authors.get(key);
      if (prev && prev.postedAt && when && when <= prev.postedAt) continue;
      authors.set(key, {
        firstName: post.author.firstName || "(unknown)",
        lastName: post.author.lastName,
        headline: post.author.headline,
        location: post.author.location,
        profileUrl: post.author.profileUrl,
        publicIdentifier: post.author.publicIdentifier,
        memberId: post.author.memberId,
        networkDistance: post.author.networkDistance,
        snippet: hit.snippet,
        postedAt: when,
      });
      if (authors.size >= cap) break;
    }
    if (onProgress) await onProgress(authors.size, cap);
    pages += 1;
    cursor = authors.size >= cap || pages >= 6 ? null : page.cursor;
    if (cursor) await sleep(400);
  } while (cursor);

  const rows = [...authors.values()];
  const [batch] = await db.insert(connectionBatch).values({
    orgId,
    source: "event_search",
    label: `Event posts · ${eventName} · ${scope.label}`.slice(0, 120),
    statsJson: { imported: rows.length },
  }).returning();

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(connection).values(rows.slice(i, i + CHUNK).map((h) => {
      const locCountry = toCountry(h.location) ?? scope.country;
      const { position, company } = splitHeadline(h.headline);
      return {
        orgId,
        batchId: batch.id,
        firstName: h.firstName,
        lastName: h.lastName,
        companyRaw: company,
        positionRaw: position,
        headlineRaw: h.headline,
        linkedinUrl: h.profileUrl,
        publicIdentifier: h.publicIdentifier,
        memberId: h.memberId,
        location: h.location,
        country: locCountry,
        ...stampMetro({ location: h.location, headline: h.headline, country: locCountry }),
        networkDistance: h.networkDistance,
        lastPostAt: h.postedAt,
        lastScanAt: new Date(),
        mentionMetro: scope.slug,
        mentionAt: h.postedAt,
        mentionSnippet: h.snippet,
        mentionKind: "event",
        eventQuery: eventName,
        bucket: null,
        matchWhy: `Posted about "${eventName}": ${h.snippet}`,
        matchMethod: "rule",
        matchConfidence: 60,
      };
    }));
  }

  if (onProgress) await onProgress(rows.length, Math.max(rows.length * 2, 1));
  if (rows.length > 0) {
    await classifyBatch(orgId, batch.id, {}, async (done, total) => {
      if (onProgress) await onProgress(rows.length + done, rows.length + total);
    }, shouldStop);
    await rankBatch(orgId, batch.id);
  }
  if (onProgress) await onProgress(rows.length, Math.max(rows.length, 1));
  return { found: rows.length, scanned: rows.length, batchId: batch.id };
}
