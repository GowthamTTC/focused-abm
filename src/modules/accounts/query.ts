/**
 * ABM account list — pitchable people rolled up by company.
 * No extra table: computed from Stage A results on demand.
 */
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { companyKey } from "@/modules/radar/score";

export interface AccountPerson {
  id: string;
  firstName: string;
  lastName: string;
  positionRaw: string | null;
  linkedinUrl: string | null;
  tier: number | null;
  rank: number | null;
  score: number | null;
  serviceSlug: string | null;
  matchWhy: string | null;
  lastPostAt: Date | null;
  sentAt: Date | null;
  country: string | null;
}

export interface AccountRow {
  key: string;
  name: string;
  peopleCount: number;
  tier1Count: number;
  bestRank: number | null;
  avgScore: number | null;
  services: string[];
  countries: string[];
  lastActivity: Date | null;
  sentCount: number;
  people: AccountPerson[];
}

export async function loadAccounts(
  orgId: string,
  opts: {
    service?: string;
    q?: string;
    minPeople?: number;
    minScore?: number;
    country?: string;
    company?: string;
  } = {},
): Promise<AccountRow[]> {
  const rows = await db.select({
    id: connection.id,
    firstName: connection.firstName,
    lastName: connection.lastName,
    companyRaw: connection.companyRaw,
    positionRaw: connection.positionRaw,
    linkedinUrl: connection.linkedinUrl,
    tier: connection.tier,
    rank: connection.rank,
    score: connection.score,
    serviceSlug: connection.serviceSlug,
    matchWhy: connection.matchWhy,
    lastPostAt: connection.lastPostAt,
    sentAt: connection.sentAt,
    country: connection.country,
    location: connection.location,
  }).from(connection).where(and(
    eq(connection.orgId, orgId),
    eq(connection.bucket, "pitchable"),
    isNotNull(connection.companyRaw),
    ne(connection.companyRaw, ""),
    ...(opts.service ? [eq(connection.serviceSlug, opts.service)] : []),
    ...(opts.minScore && opts.minScore > 0 ? [sql`score >= ${opts.minScore}`] : []),
    ...(opts.country
      ? [sql`(country ilike ${opts.country} or location ilike ${"%" + opts.country + "%"})`]
      : []),
  ));

  const map = new Map<string, AccountRow & { scoreSum: number; scoreN: number }>();
  for (const r of rows) {
    const key = companyKey(r.companyRaw);
    if (key === "_none") continue;
    const name = (r.companyRaw ?? "").trim();
    if (opts.company && companyKey(opts.company) !== key && name.toLowerCase() !== opts.company.toLowerCase()) {
      continue;
    }
    if (opts.q) {
      const needle = opts.q.toLowerCase();
      const hay = `${name} ${r.firstName} ${r.lastName}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    let acc = map.get(key);
    if (!acc) {
      acc = {
        key,
        name,
        peopleCount: 0,
        tier1Count: 0,
        bestRank: null,
        avgScore: null,
        services: [],
        countries: [],
        lastActivity: null,
        sentCount: 0,
        people: [],
        scoreSum: 0,
        scoreN: 0,
      };
      map.set(key, acc);
    }
    acc.peopleCount += 1;
    if (r.tier === 1) acc.tier1Count += 1;
    if (r.rank != null && (acc.bestRank == null || r.rank < acc.bestRank)) acc.bestRank = r.rank;
    if (r.score != null) {
      acc.scoreSum += r.score;
      acc.scoreN += 1;
    }
    if (r.serviceSlug && !acc.services.includes(r.serviceSlug)) acc.services.push(r.serviceSlug);
    const ctry = (r.country || "").trim();
    if (ctry && !acc.countries.includes(ctry)) acc.countries.push(ctry);
    if (r.lastPostAt && (!acc.lastActivity || r.lastPostAt > acc.lastActivity)) acc.lastActivity = r.lastPostAt;
    if (r.sentAt) acc.sentCount += 1;
    acc.people.push({
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      positionRaw: r.positionRaw,
      linkedinUrl: r.linkedinUrl,
      tier: r.tier,
      rank: r.rank,
      score: r.score,
      serviceSlug: r.serviceSlug,
      matchWhy: r.matchWhy,
      lastPostAt: r.lastPostAt,
      sentAt: r.sentAt,
      country: r.country,
    });
  }

  let list = [...map.values()].map(({ scoreSum, scoreN, ...rest }) => ({
    ...rest,
    avgScore: scoreN ? Math.round(scoreSum / scoreN) : null,
    people: rest.people.sort((a, b) => (a.rank ?? 9e9) - (b.rank ?? 9e9)),
  }));

  const min = opts.minPeople ?? 1;
  if (min > 1) list = list.filter((a) => a.peopleCount >= min);

  list.sort((a, b) =>
    b.peopleCount - a.peopleCount
    || b.tier1Count - a.tier1Count
    || (a.bestRank ?? 9e9) - (b.bestRank ?? 9e9));

  return list;
}

export async function accountServices(orgId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ s: connection.serviceSlug }).from(connection)
    .where(and(
      eq(connection.orgId, orgId),
      eq(connection.bucket, "pitchable"),
      isNotNull(connection.serviceSlug),
    ));
  return rows.map((r) => r.s!).filter(Boolean).sort();
}

export async function accountCompanies(orgId: string): Promise<{ key: string; name: string }[]> {
  const rows = await db.select({
    companyRaw: connection.companyRaw,
  }).from(connection).where(and(
    eq(connection.orgId, orgId),
    eq(connection.bucket, "pitchable"),
    isNotNull(connection.companyRaw),
    ne(connection.companyRaw, ""),
  ));
  const map = new Map<string, string>();
  for (const r of rows) {
    const key = companyKey(r.companyRaw);
    if (key === "_none") continue;
    if (!map.has(key)) map.set(key, (r.companyRaw ?? "").trim());
  }
  return [...map.entries()]
    .map(([key, name]) => ({ key, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function accountCountries(orgId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ c: connection.country }).from(connection)
    .where(and(
      eq(connection.orgId, orgId),
      eq(connection.bucket, "pitchable"),
      isNotNull(connection.country),
      ne(connection.country, ""),
    ));
  return rows.map((r) => r.c!).filter(Boolean).sort();
}

/** Org-wide pitchable totals (not limited by account filters). */
export async function pitchableTotals(orgId: string): Promise<{ people: number; withCompany: number }> {
  const [row] = await db.select({
    people: sql<number>`count(*)::int`,
    withCompany: sql<number>`count(*) filter (where company_raw is not null and company_raw <> '')::int`,
  }).from(connection).where(and(
    eq(connection.orgId, orgId),
    eq(connection.bucket, "pitchable"),
  ));
  return { people: row?.people ?? 0, withCompany: row?.withCompany ?? 0 };
}
