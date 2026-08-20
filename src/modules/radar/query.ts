import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { metroBySlug } from "@/modules/geo/metros";
import { countryBySlug } from "@/modules/geo/countries";
import { companyKey, scoreRadar, type Presence, type RadarInput } from "@/modules/radar/score";

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
}

export async function loadRadar(
  orgId: string,
  slug: string,
  windowDays: number,
  pool: "first" | "extended" = "first",
  countrySlug = "united-states",
): Promise<RadarView | null> {
  const metro = metroBySlug(slug);
  const country = countryBySlug(countrySlug);
  if (pool === "first" && !metro) return null;
  if (pool === "extended" && !country) return null;

  const degree = pool === "extended"
    ? inArray(connection.networkDistance, ["2", "3"])
    : or(isNull(connection.networkDistance), eq(connection.networkDistance, "1"));

  const place = pool === "extended"
    ? and(
        eq(connection.mentionKind, "event"),
        or(eq(connection.country, country!.country), eq(connection.mentionMetro, country!.slug)),
      )
    : or(eq(connection.metro, slug), eq(connection.mentionMetro, slug));

  const rows = await db.select().from(connection).where(and(
    eq(connection.orgId, orgId),
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

    if (pool === "extended" && r.mentionKind !== "event") continue;

    if (r.floorStatus === "met") {
      met.push(person("based_quiet", 0, "marked met on the floor"));
      continue;
    }

    const s = scoreRadar(input, pool === "extended" ? country!.slug : slug, windowDays);
    if (!s) continue;
    scored.push(person(s.presence, s.total, s.why));
  }

  scored.sort((a, b) => b.radarScore - a.radarScore || (a.rank ?? 9e9) - (b.rank ?? 9e9));
  const basedActive = scored.filter((p) => p.presence === "based_active");
  const mentioned = scored.filter((p) => p.presence === "mentioned_active");
  const basedQuiet = scored.filter((p) => p.presence === "based_quiet");

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
    metroLabel: pool === "extended" ? country!.label : metro!.label,
    windowDays,
    basedActive,
    mentioned,
    basedQuiet,
    met,
    clusters,
    unknownCity: unk?.n ?? 0,
  };
}
