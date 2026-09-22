/**
 * Account shortlist — the gate for Stage B spend.
 * People are still enriched; only accounts on the shortlist are eligible.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, accountShortlist, connection } from "@/db";
import { companyKey } from "@/modules/radar/score";
import type { AccountRow } from "@/modules/accounts/query";
import { markSelection } from "@/modules/matching/service-fit";
import { getOrgSettings, clampToLimit } from "@/modules/settings/org-settings";
import { ENRICHABLE_STATUSES } from "@/modules/enrich/status";
import { enqueue } from "@/jobs/runner";

/** Max people to enrich per shortlisted account (senior seats first). */
export const PEOPLE_PER_ACCOUNT = 3;

export async function listShortlistedKeys(orgId: string): Promise<Set<string>> {
  const rows = await db.select({
    key: accountShortlist.companyKey,
  }).from(accountShortlist).where(eq(accountShortlist.orgId, orgId));
  return new Set(rows.map((r) => r.key));
}

export async function toggleShortlist(
  orgId: string,
  companyKeyValue: string,
  companyName: string,
  on: boolean,
): Promise<void> {
  const key = companyKeyValue || companyKey(companyName);
  if (!key || key === "_none") return;
  if (on) {
    const existing = await db.select({ id: accountShortlist.id }).from(accountShortlist)
      .where(and(eq(accountShortlist.orgId, orgId), eq(accountShortlist.companyKey, key)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(accountShortlist).values({
        orgId,
        companyKey: key,
        companyName: companyName.slice(0, 200) || key,
      });
    }
  } else {
    await db.delete(accountShortlist).where(and(
      eq(accountShortlist.orgId, orgId),
      eq(accountShortlist.companyKey, key),
    ));
  }
}

/** Companies this workspace tracks that have NOBODY in the network.
 *
 *  The accounts list is otherwise derived entirely from pitchable connections,
 *  which quietly means you can only be told about companies you are already
 *  inside. That is backwards for the case the list exists to serve: an account
 *  nobody has a route into is exactly the one worth reading about before the
 *  first call, and it is the one the derived list can never show.
 *
 *  account_shortlist already stored a name and a key with no reference to any
 *  connection, so a named account needs no new table — only this read, and a
 *  list willing to show a row with nothing behind it yet.
 */
export async function listNamedOnlyAccounts(
  orgId: string,
  keysWithPeople: Set<string>,
): Promise<AccountRow[]> {
  const rows = await db.select({
    key: accountShortlist.companyKey,
    name: accountShortlist.companyName,
  }).from(accountShortlist).where(eq(accountShortlist.orgId, orgId));

  return rows
    .filter((r) => !keysWithPeople.has(r.key))
    .map((r): AccountRow => ({
      key: r.key,
      name: r.name,
      // Zero, and shown as zero. The panel reads this to say "nobody from this
      // company is in your network", which is a different fact from "nobody has
      // been checked yet" and must not be allowed to look like it.
      peopleCount: 0,
      tier1Count: 0,
      bestRank: null,
      avgScore: null,
      services: [],
      countries: [],
      lastActivity: null,
      sentCount: 0,
      people: [],
    }));
}

export async function shortlistCount(orgId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(accountShortlist).where(eq(accountShortlist.orgId, orgId));
  return row?.n ?? 0;
}

/**
 * Pick top people on shortlisted accounts and enqueue deep enrich.
 * Returns how many people were queued.
 */
export async function enrichShortlistedAccounts(
  orgId: string,
  opts: { perAccount?: number } = {},
): Promise<{ accounts: number; people: number }> {
  const perAccount = opts.perAccount ?? PEOPLE_PER_ACCOUNT;
  const shortlisted = await db.select().from(accountShortlist)
    .where(eq(accountShortlist.orgId, orgId));
  if (shortlisted.length === 0) return { accounts: 0, people: 0 };

  const keys = shortlisted.map((s) => s.companyKey);
  // Load pitchable, not-yet-done people with a company
  const people = await db.select({
    id: connection.id,
    batchId: connection.batchId,
    companyRaw: connection.companyRaw,
    rank: connection.rank,
    enrichStatus: connection.enrichStatus,
  }).from(connection).where(and(
    eq(connection.orgId, orgId),
    eq(connection.bucket, "pitchable"),
    inArray(connection.enrichStatus, [...ENRICHABLE_STATUSES]),
  ));

  const byKey = new Map<string, typeof people>();
  for (const p of people) {
    const k = companyKey(p.companyRaw);
    if (!keys.includes(k)) continue;
    const list = byKey.get(k) ?? [];
    list.push(p);
    byKey.set(k, list);
  }

  const { enrichLimit } = await getOrgSettings(orgId);
  const picked: string[] = [];
  const byBatch = new Map<string, string[]>();

  for (const key of keys) {
    const list = (byKey.get(key) ?? []).sort((a, b) => (a.rank ?? 9e9) - (b.rank ?? 9e9));
    for (const p of list.slice(0, perAccount)) {
      picked.push(p.id);
      const arr = byBatch.get(p.batchId) ?? [];
      arr.push(p.id);
      byBatch.set(p.batchId, arr);
    }
  }

  const capped = picked.slice(0, clampToLimit(picked.length, enrichLimit));
  if (capped.length === 0) return { accounts: shortlisted.length, people: 0 };

  const cappedSet = new Set(capped);
  for (const [batchId, ids] of byBatch) {
    const use = ids.filter((id) => cappedSet.has(id));
    if (use.length) await markSelection(batchId, use, true);
  }
  await enqueue(orgId, "deep_enrich", { connectionIds: capped });
  return { accounts: shortlisted.length, people: capped.length };
}


export async function enrichOneAccount(
  orgId: string,
  key: string,
): Promise<{ people: number }> {
  const people = await db.select({
    id: connection.id,
    batchId: connection.batchId,
    companyRaw: connection.companyRaw,
    rank: connection.rank,
    enrichStatus: connection.enrichStatus,
  }).from(connection).where(and(
    eq(connection.orgId, orgId),
    eq(connection.bucket, "pitchable"),
    inArray(connection.enrichStatus, [...ENRICHABLE_STATUSES]),
  ));

  // All remaining people at this company (not just top 3).
  const list = people
    .filter((p) => companyKey(p.companyRaw) === key)
    .sort((a, b) => (a.rank ?? 9e9) - (b.rank ?? 9e9));

  if (list.length === 0) return { people: 0 };

  const { enrichLimit } = await getOrgSettings(orgId);
  const capped = list.slice(0, clampToLimit(list.length, enrichLimit));
  const byBatch = new Map<string, string[]>();
  for (const p of capped) {
    const arr = byBatch.get(p.batchId) ?? [];
    arr.push(p.id);
    byBatch.set(p.batchId, arr);
  }
  for (const [batchId, ids] of byBatch) {
    await markSelection(batchId, ids, true);
  }
  await enqueue(orgId, "deep_enrich", { connectionIds: capped.map((p) => p.id) });
  return { people: capped.length };
}

/** The account card's per-person Enrich — one click, one person, so it presses
 *  the same brake the People and Matched tables do rather than enqueuing blind.
 *  It used to, which let someone walk past today's cap one click at a time and
 *  meet it as a thrown run instead of a refusal.
 *
 *  False means nothing is happening for this person: either they are not ours,
 *  or today's budget is spent. Already-researched and in-flight rows come back
 *  as `skipped`, which is a true "nothing to do here". */
export async function enrichOnePerson(orgId: string, connId: string): Promise<boolean> {
  const { queueEnrich } = await import("@/modules/enrich/queue");
  const { queued, skipped } = await queueEnrich(orgId, [connId]);
  return queued > 0 || skipped > 0;
}
