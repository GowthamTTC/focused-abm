/**
 * Account map — the org chart an account is measured against.
 *
 * `loadAccounts` answers "who do we know at AbbVie". That is the half of an
 * account plan a connection list can produce on its own. The half it cannot is
 * "which parts of AbbVie do we not know at all", because an absence leaves no
 * row to count. So the unit list arrives from outside (researched, pasted, or
 * drafted) and coverage is the diff.
 *
 * Matching is the same shape as the rest of the product: a free rule pass over
 * text people already wrote about themselves, then the model for what is left.
 * This file is the rule pass; the model fallback is the map_units job.
 */
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db, accountMap, connection, type AccountProfile, type OrgUnit } from "@/db";
import { companyKey } from "@/modules/radar/score";

export interface AccountMapRow {
  companyKey: string;
  name: string;
  aliases: string[];
  units: OrgUnit[];
  profile: AccountProfile;
  source: string;
  updatedAt: Date;
}

export async function loadAccountMap(orgId: string, key: string): Promise<AccountMapRow | null> {
  const [row] = await db.select().from(accountMap)
    .where(and(eq(accountMap.orgId, orgId), eq(accountMap.companyKey, key))).limit(1);
  if (!row) return null;
  return {
    companyKey: row.companyKey,
    name: row.name,
    aliases: row.aliases ?? [],
    units: row.units ?? [],
    profile: row.profileJson ?? {},
    source: row.source,
    updatedAt: row.updatedAt,
  };
}

export async function listAccountMaps(orgId: string): Promise<AccountMapRow[]> {
  const rows = await db.select().from(accountMap).where(eq(accountMap.orgId, orgId));
  return rows.map((row) => ({
    companyKey: row.companyKey,
    name: row.name,
    aliases: row.aliases ?? [],
    units: row.units ?? [],
    profile: row.profileJson ?? {},
    source: row.source,
    updatedAt: row.updatedAt,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveAccountMap(
  orgId: string,
  input: {
    companyKey: string; name: string; aliases?: string[]; units?: OrgUnit[];
    profile?: AccountProfile; source?: string;
  },
): Promise<void> {
  const key = input.companyKey || companyKey(input.name);
  if (!key || key === "_none") return;
  const values = {
    name: input.name.slice(0, 200) || key,
    aliases: dedupe(input.aliases ?? []),
    units: cleanUnits(input.units ?? []),
    ...(input.profile ? { profileJson: input.profile } : {}),
    source: input.source ?? "manual",
    updatedAt: new Date(),
  };
  const existing = await db.select({ id: accountMap.id }).from(accountMap)
    .where(and(eq(accountMap.orgId, orgId), eq(accountMap.companyKey, key))).limit(1);
  if (existing.length > 0) {
    await db.update(accountMap).set(values).where(eq(accountMap.id, existing[0].id));
  } else {
    await db.insert(accountMap).values({ orgId, companyKey: key, ...values });
  }
}

export async function deleteAccountMap(orgId: string, key: string): Promise<void> {
  await db.delete(accountMap)
    .where(and(eq(accountMap.orgId, orgId), eq(accountMap.companyKey, key)));
}

function dedupe(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const s = (raw ?? "").trim();
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s.slice(0, 200));
  }
  return out;
}

/** Units arrive from a textarea or the model, so both can hand us blanks and
 *  duplicates. Names are kept verbatim — they are what `division` stores, and a
 *  silent rewrite here would orphan every row already assigned. */
function cleanUnits(units: OrgUnit[]): OrgUnit[] {
  const out: OrgUnit[] = [];
  for (const u of units) {
    const name = (u?.name ?? "").trim();
    if (!name) continue;
    if (out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({
      name: name.slice(0, 120),
      ...(u.aka && u.aka.length ? { aka: dedupe(u.aka).slice(0, 12) } : {}),
      ...(u.note ? { note: u.note.slice(0, 400) } : {}),
      ...(u.engaged ? { engaged: true } : {}),
    });
  }
  return out;
}

/** Every company key that rolls up to this account — the parent plus its
 *  acquired-brand spellings. */
export function mapKeys(map: AccountMapRow): string[] {
  return dedupe([map.name, ...map.aliases]).map(companyKey).filter((k) => k !== "_none");
}

// ── Rule pass ────────────────────────────────────────────────────────

function norm(s: string | null | undefined): string {
  return ` ${(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

export interface UnitMatch { unit: string; why: string }

/**
 * Longest phrase first, so "Clinical Data Strategy" beats "Clinical" when both
 * are units. A person's own words are the evidence: the phrase has to appear in
 * their position, headline, or the company string itself (which is where an
 * acquired brand shows up).
 */
export function matchUnit(units: OrgUnit[], person: {
  positionRaw?: string | null;
  headlineRaw?: string | null;
  companyRaw?: string | null;
}): UnitMatch | null {
  const hay = norm(`${person.positionRaw ?? ""} ${person.headlineRaw ?? ""} ${person.companyRaw ?? ""}`);
  if (hay.trim() === "") return null;

  const candidates: { unit: string; phrase: string }[] = [];
  for (const u of units) {
    for (const phrase of [u.name, ...(u.aka ?? [])]) {
      const p = norm(phrase).trim();
      if (p.length >= 2) candidates.push({ unit: u.name, phrase: p });
    }
  }
  candidates.sort((a, b) => b.phrase.length - a.phrase.length);

  for (const c of candidates) {
    if (hay.includes(` ${c.phrase} `)) {
      return { unit: c.unit, why: `Their own title or company names "${c.phrase}"` };
    }
  }
  return null;
}

// ── Coverage ─────────────────────────────────────────────────────────

export interface UnitCoverage {
  unit: OrgUnit;
  peopleCount: number;
  tier1Count: number;
  bestRank: number | null;
  services: string[];
  people: { id: string; name: string; positionRaw: string | null; rank: number | null; tier: number | null; linkedinUrl: string | null; divisionMethod: string | null }[];
}

export interface Coverage {
  map: AccountMapRow;
  landed: UnitCoverage[];
  whitespace: OrgUnit[];
  unmapped: UnitCoverage["people"];
  totals: { people: number; units: number; unitsLanded: number };
}

export async function accountCoverage(orgId: string, key: string): Promise<Coverage | null> {
  const map = await loadAccountMap(orgId, key);
  if (!map) return null;
  const keys = mapKeys(map);

  const rows = await db.select({
    id: connection.id,
    firstName: connection.firstName,
    lastName: connection.lastName,
    companyRaw: connection.companyRaw,
    positionRaw: connection.positionRaw,
    linkedinUrl: connection.linkedinUrl,
    tier: connection.tier,
    rank: connection.rank,
    serviceSlug: connection.serviceSlug,
    division: connection.division,
    divisionMethod: connection.divisionMethod,
  }).from(connection).where(and(
    eq(connection.orgId, orgId),
    eq(connection.bucket, "pitchable"),
    isNotNull(connection.companyRaw),
    ne(connection.companyRaw, ""),
  ));

  const mine = rows.filter((r) => keys.includes(companyKey(r.companyRaw)));

  const byUnit = new Map<string, UnitCoverage>();
  for (const u of map.units) {
    byUnit.set(u.name.toLowerCase(), {
      unit: u, peopleCount: 0, tier1Count: 0, bestRank: null, services: [], people: [],
    });
  }
  const unmapped: UnitCoverage["people"] = [];

  for (const r of mine) {
    const person = {
      id: r.id,
      name: `${r.firstName} ${r.lastName}`.trim(),
      positionRaw: r.positionRaw,
      rank: r.rank,
      tier: r.tier,
      linkedinUrl: r.linkedinUrl,
      divisionMethod: r.divisionMethod,
    };
    const slot = r.division ? byUnit.get(r.division.toLowerCase()) : undefined;
    if (!slot) {
      unmapped.push(person);
      continue;
    }
    slot.peopleCount += 1;
    if (r.tier === 1) slot.tier1Count += 1;
    if (r.rank != null && (slot.bestRank == null || r.rank < slot.bestRank)) slot.bestRank = r.rank;
    if (r.serviceSlug && !slot.services.includes(r.serviceSlug)) slot.services.push(r.serviceSlug);
    slot.people.push(person);
  }

  const all = [...byUnit.values()];
  for (const u of all) u.people.sort((a, b) => (a.rank ?? 9e9) - (b.rank ?? 9e9));
  unmapped.sort((a, b) => (a.rank ?? 9e9) - (b.rank ?? 9e9));

  const landed = all.filter((u) => u.peopleCount > 0)
    .sort((a, b) => b.peopleCount - a.peopleCount || (a.bestRank ?? 9e9) - (b.bestRank ?? 9e9));
  const whitespace = all.filter((u) => u.peopleCount === 0).map((u) => u.unit);

  return {
    map,
    landed,
    whitespace,
    unmapped,
    totals: { people: mine.length, units: map.units.length, unitsLanded: landed.length },
  };
}

/** People at this account who still have no unit — the input to the map_units job. */
export async function unmappedPeople(orgId: string, key: string) {
  const map = await loadAccountMap(orgId, key);
  if (!map) return [];
  const keys = mapKeys(map);
  const rows = await db.select({
    id: connection.id,
    firstName: connection.firstName,
    lastName: connection.lastName,
    companyRaw: connection.companyRaw,
    positionRaw: connection.positionRaw,
    headlineRaw: connection.headlineRaw,
    division: connection.division,
  }).from(connection).where(and(
    eq(connection.orgId, orgId),
    eq(connection.bucket, "pitchable"),
    isNotNull(connection.companyRaw),
  ));
  return rows.filter((r) => keys.includes(companyKey(r.companyRaw)) && !r.division);
}

/** Write one person's unit. `manual` never gets overwritten by a later run. */
export async function setDivision(
  orgId: string,
  ids: string[],
  unit: string | null,
  method: "rule" | "llm" | "manual",
  why: string,
): Promise<void> {
  if (ids.length === 0) return;
  await db.update(connection)
    .set({ division: unit, divisionMethod: unit ? method : null, divisionWhy: unit ? why : null })
    .where(and(eq(connection.orgId, orgId), inArray(connection.id, ids)));
}

// ── The editor's text format ─────────────────────────────────────────
//
// One unit per line, with the spellings people actually use after a pipe:
//
//   Medical Affairs & HEOR | HEOR, Health Economics, Medical Affairs
//   Allergan Aesthetics    | Allergan, Botox, Juvederm
//
// A textarea rather than a JSON editor because the person filling this in is
// reading an annual report, not writing code — and because the whole exercise
// is worthless if it is too tedious to keep current.

export function parseUnitLines(text: string): OrgUnit[] {
  const units: OrgUnit[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // A leading * marks a unit the team says it is already inside. It is an
    // assertion, not evidence, and the page labels it as one.
    let engaged = false;
    if (trimmed.startsWith("*")) {
      engaged = true;
      trimmed = trimmed.slice(1).trim();
      if (!trimmed) continue;
    }
    const [namePart, akaPart] = trimmed.split("|");
    const name = (namePart ?? "").trim();
    if (!name) continue;
    const aka = (akaPart ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    units.push({ name, ...(aka.length ? { aka } : {}), ...(engaged ? { engaged: true } : {}) });
  }
  return cleanUnits(units);
}

export function formatUnitLines(units: OrgUnit[]): string {
  return units.map((u) => {
    const body = u.aka?.length ? `${u.name} | ${u.aka.join(", ")}` : u.name;
    return u.engaged ? `* ${body}` : body;
  }).join("\n");
}

/**
 * Assign units by the free rule pass. Returns what moved.
 *
 * `manual` rows are never touched: a human who corrected a unit outranks the
 * pattern that got it wrong, and a re-run that silently reverted them would
 * make the correction pointless.
 */
export async function remapByRules(orgId: string, key: string): Promise<{ matched: number; left: number }> {
  const map = await loadAccountMap(orgId, key);
  if (!map) return { matched: 0, left: 0 };
  const people = await unmappedPeople(orgId, key);

  // Grouped by unit AND by why: two people land in the same unit on different
  // phrases, and a shared update would file one person's evidence under the
  // other's name. The whole point of storing a why is that it is theirs.
  const groups = new Map<string, { unit: string; why: string; ids: string[] }>();
  let left = 0;
  for (const p of people) {
    const hit = matchUnit(map.units, p);
    if (!hit) {
      left += 1;
      continue;
    }
    const gk = `${hit.unit}\u0000${hit.why}`;
    const slot = groups.get(gk) ?? { unit: hit.unit, why: hit.why, ids: [] };
    slot.ids.push(p.id);
    groups.set(gk, slot);
  }

  let matched = 0;
  for (const slot of groups.values()) {
    await setDivision(orgId, slot.ids, slot.unit, "rule", slot.why);
    matched += slot.ids.length;
  }
  return { matched, left };
}
