/**
 * 2nd + 3rd degree event search. Separate from the 1st-degree pool.
 * Event name is required. Country is US or India. Hard cap 1000.
 */
import { and, eq } from "drizzle-orm";
import { db, channelAccount, connection, connectionBatch } from "@/db";
import { env } from "@/lib/env";
import { getChannelProvider, type SearchHit } from "@/providers/channel";
import { toCountry } from "@/modules/connections/country";
import { stampMetro } from "@/modules/geo/metros";
import { countryBySlug } from "@/modules/geo/countries";
import { runEventScan } from "@/modules/radar/scan";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function splitHeadline(headline: string | null): { position: string | null; company: string | null } {
  if (!headline) return { position: null, company: null };
  const parts = headline.split(/\s+at\s+/i);
  if (parts.length >= 2) {
    return { position: parts[0].trim() || null, company: parts.slice(1).join(" at ").trim() || null };
  }
  return { position: headline, company: null };
}

export async function runEventExtended(
  orgId: string,
  payload: { country: string; eventName: string; days?: number; metro?: string },
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
  const provider = getChannelProvider();
  const hits: SearchHit[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();

  if (onProgress) await onProgress(0, cap);

  do {
    if (shouldStop && await shouldStop()) break;
    const page = await provider.searchPeople({
      accountId: seat.unipileAccountId,
      keywords: eventName,
      networkDistance: [2, 3],
      locationIds: scope.linkedinLocationIds,
      cursor,
      limit: 50,
    });
    for (const h of page.items) {
      const key = (h.publicIdentifier || h.profileUrl || h.memberId || `${h.firstName}-${h.lastName}`).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(h);
      if (hits.length >= cap) break;
    }
    if (onProgress) await onProgress(Math.min(hits.length, cap), cap);
    cursor = hits.length >= cap ? null : page.cursor;
    if (cursor) await sleep(400);
  } while (cursor && hits.length < cap);

  const [batch] = await db.insert(connectionBatch).values({
    orgId,
    source: "event_search",
    label: `Event · ${eventName} · ${scope.label}`.slice(0, 120),
    statsJson: { imported: hits.length },
  }).returning();

  const CHUNK = 200;
  for (let i = 0; i < hits.length; i += CHUNK) {
    await db.insert(connection).values(hits.slice(i, i + CHUNK).map((h) => {
      const locCountry = toCountry(h.location) ?? scope.country;
      return {
        orgId,
        batchId: batch.id,
        firstName: h.firstName || "(unknown)",
        lastName: h.lastName,
        companyRaw: splitHeadline(h.headline).company,
        positionRaw: splitHeadline(h.headline).position,
        headlineRaw: h.headline,
        linkedinUrl: h.profileUrl,
        publicIdentifier: h.publicIdentifier,
        memberId: h.memberId,
        location: h.location,
        country: locCountry,
        ...stampMetro({ location: h.location, headline: h.headline, country: locCountry }),
        networkDistance: h.networkDistance,
        bucket: "pitchable",
        matchWhy: `LinkedIn ${h.networkDistance === "3" ? "3rd+" : "2nd"}-degree search for “${eventName}” in ${scope.label}.`,
        matchMethod: "rule",
        matchConfidence: 60,
      };
    }));
  }

  const scan = await runEventScan(
    orgId,
    { metro: "sf-bay-area", country: scope.slug, eventName, batchId: batch.id, force: true },
    async (done, total) => {
      if (onProgress) await onProgress(hits.length, hits.length + total);
      void done;
    },
    shouldStop,
  );

  return { found: hits.length, scanned: scan.scanned, batchId: batch.id };
}
