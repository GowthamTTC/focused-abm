import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { countryBySlug } from "@/modules/geo/countries";
import { companyKey, type Presence, type RadarInput } from "@/modules/radar/score";

export interface RadarPerson {
  id: string;
  batchId: string;
  firstName: string;
  lastName: string;
  companyRaw: string | null;
  positionRaw: string | null;
  linkedinUrl: string | null;
  location: string | null;
  metro: string | null;
  metroEvidence: string | null;
  mentionSnippet: string | null;
  mentionKind: string | null;
  eventQuery: string | null;
  mentionAt: Date | null;
  lastPostAt: Date | null;
  lastScanAt: Date | null;
  tier: number | null;
  rank: number | null;
  serviceSlug: string | null;
  matchWhy: string | null;
  outreachMessage: string | null;
  sentAt: Date | null;
  floorStatus: string | null;
  presence: Presence;
  radarScore: number;
  why: string;
  sameCompanyCount: number;
}

export interface RadarCluster {
  company: string;
  count: number;
  ids: string[];
}

export interface RadarView {
  metroLabel: string;
  windowDays: number;
  basedActive: RadarPerson[];
  mentioned: RadarPerson[];
  basedQuiet: RadarPerson[];
  met: RadarPerson[];
  clusters: RadarCluster[];
  unknownCity: number;
  queries: string[];
}


function eventQueryOf(r: { eventQuery?: string | null; matchWhy?: string | null }): string | null {
  if (r.eventQuery && r.eventQuery.trim()) return r.eventQuery.trim();
  const why = r.matchWhy ?? "";
  const m = why.match(/Posted about ["“](.+?)["”]/) || why.match(/search for ["“](.+?)["”]/);
  return m?.[1]?.trim() || null;
}

export async function loadRadar(
  orgId: string,
  slug: string,
  windowDays: number,
  pool: "first" | "extended" = "first",
  countrySlug = "united-states",
  queryFilter?: string,
): Promise<RadarView | null> {
  void slug;
  const country = countryBySlug(countrySlug);
  if (!country) return null;

  const degree = pool === "extended"
    ? inArray(connection.networkDistance, ["2", "3"])
    : or(isNull(connection.networkDistance), eq(connection.networkDistance, "1"));

  const place = and(
    eq(connection.mentionKind, "event"),
    or(eq(connection.country, country.country), eq(connection.mentionMetro, country.slug)),
  );

  const rows = await db.select().from(connection).where(and(
    eq(connection.orgId, orgId),
    eq(connection.bucket, "pitchable"),
    degree,
    place,
  ));

  const byCompany = new Map<string, number>();
  for (const r of rows) {
    const k = companyKey(r.companyRaw);
    if (k !== "_none") byCompany.set(k, (byCompany.get(k) ?? 0) + 1);
  }

  const scored: RadarPerson[] = [];
  const met: RadarPerson[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const key = (r.linkedinUrl || r.id).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const input: RadarInput = {
      metro: r.metro,
      metroEvidence: r.metroEvidence,
      mentionMetro: r.mentionMetro,
      mentionAt: r.mentionAt,
      mentionKind: r.mentionKind,
      lastPostAt: r.lastPostAt,
      lastScanAt: r.lastScanAt,
      tier: r.tier,
      rank: r.rank,
      score: r.score,
      sentAt: r.sentAt,
      flagVerdict: r.flagVerdict,
      bucket: r.bucket,
      floorStatus: r.floorStatus,
      companyKey: companyKey(r.companyRaw),
      sameCompanyCount: byCompany.get(companyKey(r.companyRaw)) ?? 1,
    };

    const person = (presence: Presence, radarScore: number, why: string): RadarPerson => ({
      id: r.id,
      batchId: r.batchId,
      firstName: r.firstName,
      lastName: r.lastName,
      companyRaw: r.companyRaw,
      positionRaw: r.positionRaw,
      linkedinUrl: r.linkedinUrl,
      location: r.location,
      metro: r.metro,
      metroEvidence: r.metroEvidence,
      mentionSnippet: r.mentionSnippet,
      mentionKind: r.mentionKind,
      eventQuery: eventQueryOf(r),
      mentionAt: r.mentionAt,
      lastPostAt: r.lastPostAt,
      lastScanAt: r.lastScanAt,
      tier: r.tier,
      rank: r.rank,
      serviceSlug: r.serviceSlug,
      matchWhy: r.matchWhy,
      outreachMessage: r.outreachMessage,
      sentAt: r.sentAt,
      floorStatus: r.floorStatus,
      presence,
      radarScore,
      why,
      sameCompanyCount: input.sameCompanyCount,
    });

    if (r.floorStatus === "met") {
      met.push(person("based_quiet", 0, "marked met on the floor"));
      continue;
    }
    if (r.floorStatus === "skipped") continue;

    const named = r.mentionKind === "event";
    scored.push(person(
      named ? "mentioned_active" : "based_quiet",
      named ? 80 : 30,
      named
        ? "Named the event in a recent post"
        : r.lastScanAt
          ? "Found in event search — no event name in recent posts"
          : "Found in event search — posts not scanned yet",
    ));
  }

  scored.sort((a, b) => {
    const sent = Number(Boolean(a.sentAt)) - Number(Boolean(b.sentAt));
    if (sent) return sent;
    const at = a.lastPostAt ? a.lastPostAt.getTime() : 0;
    const bt = b.lastPostAt ? b.lastPostAt.getTime() : 0;
    if (bt !== at) return bt - at;
    return b.radarScore - a.radarScore || (a.rank ?? 9e9) - (b.rank ?? 9e9);
  });
  const queries = [...new Set(scored.map((p) => p.eventQuery).filter((q): q is string => Boolean(q)))].sort();
  const wanted = queryFilter?.trim();
  const visible = wanted ? scored.filter((p) => (p.eventQuery ?? "").toLowerCase() === wanted.toLowerCase()) : scored;
  const basedActive = visible.filter((p) => p.presence === "based_active");
  const mentioned = visible.filter((p) => p.presence === "mentioned_active");
  const basedQuiet = visible.filter((p) => p.presence === "based_quiet");

  const clusterMap = new Map<string, RadarCluster>();
  for (const p of [...basedActive, ...mentioned]) {
    const name = (p.companyRaw ?? "").trim();
    if (!name) continue;
    const k = companyKey(name);
    const cur = clusterMap.get(k) ?? { company: name, count: 0, ids: [] };
    cur.count += 1;
    cur.ids.push(p.id);
    clusterMap.set(k, cur);
  }
  const clusters = [...clusterMap.values()].filter((c) => c.count >= 2).sort((a, b) => b.count - a.count);

  const [unk] = await db.select({
    n: sql<number>`count(*) filter (where bucket = 'pitchable' and location is null and metro is null)::int`,
  }).from(connection).where(eq(connection.orgId, orgId));

  return {
    metroLabel: country.label,
    windowDays,
    basedActive,
    mentioned,
    basedQuiet,
    met,
    clusters,
    unknownCity: unk?.n ?? 0,
    queries,
  };
}
