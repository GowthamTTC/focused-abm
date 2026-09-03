/**
 * 2nd + 3rd: search LinkedIn posts for the event name, then keep authors.
 */
import { and, eq } from "drizzle-orm";
import { db, channelAccount, connection, connectionBatch, service } from "@/db";
import { env } from "@/lib/env";
import { getChannelProvider } from "@/providers/channel";
import { toCountry } from "@/modules/connections/country";
import { stampMetro } from "@/modules/geo/metros";
import { countryBySlug } from "@/modules/geo/countries";
import { mentionForEvent } from "@/modules/radar/mentions";
import { runEventScan } from "@/modules/radar/scan";
import { storePosts } from "@/modules/posts/store";
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
): Promise<{ found: number; scanned: number; batchId: string; capped?: boolean }> {
  const eventName = payload.eventName.trim();
  if (!eventName) throw new Error("Event name is required for 2nd + 3rd degree search.");
  const scope = countryBySlug(payload.country);
  if (!scope) throw new Error("Pick United States or India for 2nd + 3rd search.");

  const [seat] = await db.select().from(channelAccount)
    .where(and(eq(channelAccount.orgId, orgId), eq(channelAccount.status, "operational")));
  if (!seat) throw new Error("Connect a LinkedIn account in Settings first.");

  // classifyBatch throws when a workspace has no active service. Today that
  // throw is unreachable because the pre-stamped bucket left it nothing to
  // classify; now that classification is real, a workspace with no ICP would
  // import 100 people and THEN fail, leaving an orphan batch of unclassified
  // rows and a failed job. Refuse before the first search request.
  const [offer] = await db.select({ id: service.id }).from(service)
    .where(and(eq(service.orgId, orgId), eq(service.status, "active"))).limit(1);
  if (!offer) throw new Error("No active ICP to match against — add one in Offers, then search.");

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
        // No `force`. force sets skipAfter to new Date(0), which discards
        // EVENT_SCAN_SKIP_HOURS entirely: someone scanned ten minutes ago is
        // re-fetched at full price, and the daily cap counts distinct PEOPLE,
        // not requests, so the re-fetch was free against the brake and not free
        // against LinkedIn. skippedFresh already reports what the window held.
        limit: cap,
        firstDegreeOnly: true,
      },
      onProgress,
      shouldStop,
    );
    if (onProgress) await onProgress(scan.scanned, Math.max(scan.scanned, 1));
    return { found: scan.mentioned, scanned: scan.scanned, batchId: "", capped: scan.cappedAt != null };
  }

  const provider = getChannelProvider();
  const authors = new Map<string, {
    firstName: string; lastName: string; headline: string | null; location: string | null;
    profileUrl: string | null; publicIdentifier: string | null; memberId: string | null;
    networkDistance: "2" | "3"; snippet: string; postedAt: Date | null;
    /** The post that named the event: its full text and deep link, kept so the
     *  export can carry what the person actually said rather than a 180-char
     *  snippet with no way back to the source. */
    postId: string | null; postUrl: string | null; postText: string;
  }>();
  let cursor: string | null = null;
  let pages = 0;

  if (onProgress) await onProgress(0, cap);

  do {
    if (shouldStop && await shouldStop()) break;
    type SearchPage = {
      items: Array<{
        text: string; postedAt: string | Date | null; isCompany?: boolean;
        id?: string | null; url?: string | null;
        author: {
          firstName: string; lastName: string; headline: string | null; location: string | null;
          profileUrl: string | null; publicIdentifier: string | null; memberId: string | null;
          networkDistance: "2" | "3";
        };
      }>;
      cursor: string | null;
    };
    let page: SearchPage | null = null;
    try {
      page = await provider.searchPosts({
        accountId: seat.unipileAccountId,
        keywords: eventName,
        datePosted: datePosted(payload.days),
        cursor,
        limit: 25,
      });
    } catch {
      if (onProgress) await onProgress(authors.size, cap);
      break;
    }
    if (!page) break;
    for (const post of page.items) {
      if (post.isCompany) continue;
      const hit = mentionForEvent([{ text: post.text, postedAt: post.postedAt }], eventName, scope.slug);
      const snippet = hit?.snippet
        || (post.text ?? "").replace(/\s+/g, " ").trim().slice(0, 180)
        || post.author.headline
        || eventName;
      const locCountry = toCountry(post.author.location);
      if (locCountry && locCountry !== scope.country) continue;
      const key = (post.author.publicIdentifier || post.author.profileUrl || post.author.memberId
        || `${post.author.firstName}-${post.author.lastName}`).toLowerCase();
      const rawWhen = hit?.postedAt ?? (post.postedAt ? new Date(post.postedAt) : null);
      const when = rawWhen && !Number.isNaN(rawWhen.getTime()) ? rawWhen : null;
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
        snippet,
        postedAt: when,
        postId: post.id ?? null,
        postUrl: post.url ?? null,
        postText: post.text ?? "",
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
      // Deliberately NOT bucketed and NOT scan-stamped here.
      //
      // bucket / match_why / match_method / match_confidence are classifyBatch's
      // to write, and classifyBatch selects on `bucket is null` — stamping them
      // here made the call twenty lines below a guaranteed no-op and shipped a
      // fabricated "rule · 60%" ICP verdict into /people, the enrichment
      // pickers, the ranked pool and the client workbook, for a person whose
      // only qualification is that they typed the event name.
      //
      // last_scan_at stays NULL because no post scan happened. getDailyScanUsage
      // counts rows stamped since UTC midnight, so writing it here spent the
      // whole workspace's daily post-scan budget on zero LinkedIn calls.
      //
      // The search evidence is not lost: mention_snippet, mention_kind and
      // event_query carry it, and that is what /radar renders.
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
        mentionMetro: scope.slug,
        mentionAt: h.postedAt,
        mentionSnippet: h.snippet,
        mentionKind: "event",
        eventQuery: eventName,
      };
    }));
  }

  // Keep the post that named the event. It is already in hand — no request —
  // and it is the only place the full text and the deep link survive; the
  // connection row holds a 180-char snippet and no link at all. The export
  // reads these, and storePosts is idempotent on (connection_id, provider_id)
  // so re-running a search updates rather than duplicating.
  //
  // These rows belong to people the classifier is about to mark `excluded`,
  // and judgePosts only ever reads pitchable people — so they will sit unjudged
  // for good. That is correct (nobody should pay to score a stranger's post)
  // and it is why the runner's post_judge chain is scoped to pitchable too.
  const inserted = await db.select({ id: connection.id, publicIdentifier: connection.publicIdentifier })
    .from(connection).where(eq(connection.batchId, batch.id));
  const idByPublic = new Map(inserted.map((r) => [r.publicIdentifier, r.id]));
  for (const h of rows) {
    if (!h.postId && !h.postUrl) continue;
    const connId = idByPublic.get(h.publicIdentifier);
    if (!connId) continue;
    await storePosts(orgId, connId, [{
      id: h.postId ?? `event:${eventName}:${h.publicIdentifier}`,
      text: h.postText || h.snippet,
      url: h.postUrl,
      postedAt: h.postedAt ? h.postedAt.toISOString() : null,
    }]);
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
