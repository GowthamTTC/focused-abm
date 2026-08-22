/**
 * ABM account list — pitchable people rolled up by company.
 * No extra table: computed from Stage A results on demand.
 */
import { and, eq, isNotNull, ne } from "drizzle-orm";
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
}

export interface AccountRow {
  key: string;
  name: string;
  peopleCount: number;
  tier1Count: number;
  bestRank: number | null;
  avgScore: number | null;
  services: string[];
  lastActivity: Date | null;
  sentCount: number;
  people: AccountPerson[];
}

export async function loadAccounts(
  orgId: string,
  opts: { service?: string; q?: string; minPeople?: number } = {},
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
  }).from(connection).where(and(
    eq(connection.orgId, orgId),
    eq(connection.bucket, "pitchable"),
    isNotNull(connection.companyRaw),
    ne(connection.companyRaw, ""),
    ...(opts.service ? [eq(connection.serviceSlug, opts.service)] : []),
  ));

  const map = new Map<string, AccountRow>();
  for (const r of rows) {
    const key = companyKey(r.companyRaw);
    if (key === "_none") continue;
    const name = (r.companyRaw ?? "").trim();
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
        lastActivity: null,
        sentCount: 0,
        people: [],
      };
      map.set(key, acc);
    }
    acc.peopleCount += 1;
    if (r.tier === 1) acc.tier1Count += 1;
    if (r.sentAt) acc.sentCount += 1;
    if (r.rank != null && (acc.bestRank == null || r.rank < acc.bestRank)) acc.bestRank = r.rank;
    if (r.serviceSlug && !acc.services.includes(r.serviceSlug)) acc.services.push(r.serviceSlug);
    if (r.lastPostAt && (!acc.lastActivity || r.lastPostAt > acc.lastActivity)) acc.lastActivity = r.lastPostAt;
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
    });
  }

  const min = opts.minPeople ?? 1;
  const out = [...map.values()].filter((a) => a.peopleCount >= min);
  for (const a of out) {
    const scores = a.people.map((p) => p.score).filter((s): s is number => s != null);
    a.avgScore = scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null;
    a.people.sort((x, y) => (x.rank ?? 9e9) - (y.rank ?? 9e9));
    a.services.sort();
  }
  out.sort((a, b) =>
    b.peopleCount - a.peopleCount
    || b.tier1Count - a.tier1Count
    || (a.bestRank ?? 9e9) - (b.bestRank ?? 9e9)
  );
  return out;
}

export async function accountServices(orgId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ s: connection.serviceSlug }).from(connection)
    .where(and(eq(connection.orgId, orgId), eq(connection.bucket, "pitchable"), isNotNull(connection.serviceSlug)));
  return rows.map((r) => r.s!).filter(Boolean).sort();
}
