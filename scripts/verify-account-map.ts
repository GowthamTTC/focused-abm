/**
 * Verification harness for the account map — the whitespace half of an
 * account plan.
 *
 *   npx tsx scripts/verify-account-map.ts
 *
 * What it pins:
 *  - a unit list saved from the editor's text format round-trips;
 *  - the free name-match pass places people whose own title names a unit, and
 *    leaves everyone else alone rather than guessing;
 *  - longer unit names win over shorter ones that are a prefix of them;
 *  - an alias company (an acquired brand) counts as coverage of its own unit
 *    rather than sitting off to the side as a separate account;
 *  - a hand assignment survives a later re-run of the rule pass;
 *  - whitespace is exactly the mapped units nobody sits in.
 *
 * Writes rows, so it refuses to run against anything but a local database. It
 * costs nothing: no model call, no LinkedIn request. It cleans up after itself.
 */
import "./require-local-db";
import { and, eq, inArray } from "drizzle-orm";
import { db, accountMap, connection, connectionBatch, org } from "../src/db";
import {
  accountCoverage,
  formatUnitLines,
  matchUnit,
  parseUnitLines,
  remapByRules,
  saveAccountMap,
  setDivision,
} from "../src/modules/accounts/org-map";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}`, detail === undefined ? "" : detail);
  }
}

const UNITS_TEXT = `
# a comment line is ignored
Medical Affairs & HEOR | HEOR, Health Economics
Clinical Data Strategy
Clinical
Allergan Aesthetics | Allergan, Botox
Customer Excellence
IRA Strategy
`;

async function main() {
  const [o] = await db.select().from(org).limit(1);
  if (!o) throw new Error("No org — run npm run seed first.");
  const KEY = "verify abbvie";

  // ── the text format ───────────────────────────────────────────────
  const units = parseUnitLines(UNITS_TEXT);
  check("comment and blank lines dropped", units.length === 6, units.map((u) => u.name));
  check("aka parsed", units[0].aka?.join(",") === "HEOR,Health Economics", units[0]);
  check("round-trips through the textarea",
    parseUnitLines(formatUnitLines(units)).length === units.length);

  // ── matching ──────────────────────────────────────────────────────
  check("matches on position",
    matchUnit(units, { positionRaw: "Director, Medical Affairs & HEOR" })?.unit === "Medical Affairs & HEOR");
  check("matches on an aka",
    matchUnit(units, { positionRaw: "Senior HEOR Analyst" })?.unit === "Medical Affairs & HEOR");
  check("longest unit name wins over its own prefix",
    matchUnit(units, { positionRaw: "Head of Clinical Data Strategy" })?.unit === "Clinical Data Strategy",
    matchUnit(units, { positionRaw: "Head of Clinical Data Strategy" }));
  check("acquired brand matches on the company string",
    matchUnit(units, { positionRaw: "VP People", companyRaw: "Allergan Aesthetics" })?.unit === "Allergan Aesthetics");
  check("no match stays null rather than guessing",
    matchUnit(units, { positionRaw: "Warehouse Supervisor" }) === null);
  check("a phrase inside a longer word does not count",
    matchUnit([{ name: "IRA" }], { positionRaw: "Admiral of the fleet" }) === null);
  check("empty person is null", matchUnit(units, {}) === null);

  // ── coverage over real rows ───────────────────────────────────────
  const [batch] = await db.insert(connectionBatch).values({
    orgId: o.id, label: "verify-account-map", source: "csv",
  }).returning();

  const people = [
    { firstName: "Ada", lastName: "Wu", companyRaw: "VerifyAbbVie", positionRaw: "Director, Medical Affairs & HEOR" },
    { firstName: "Ben", lastName: "Roy", companyRaw: "VerifyAbbVie", positionRaw: "Head of Clinical Data Strategy" },
    { firstName: "Cara", lastName: "Lim", companyRaw: "Allergan Aesthetics", positionRaw: "Chief People Officer" },
    { firstName: "Dev", lastName: "Nair", companyRaw: "VerifyAbbVie", positionRaw: "Warehouse Supervisor" },
  ];
  const inserted = await db.insert(connection).values(people.map((p) => ({
    orgId: o.id, batchId: batch.id, bucket: "pitchable", ...p,
  }))).returning();
  const ids = inserted.map((r) => r.id);

  await saveAccountMap(o.id, {
    companyKey: KEY, name: "VerifyAbbVie", aliases: ["Allergan Aesthetics"], units,
  });
  const first = await remapByRules(o.id, KEY);
  check("rule pass placed the three whose titles name a unit", first.matched === 3, first);
  check("and left the fourth alone", first.left === 1, first);

  const cov = await accountCoverage(o.id, KEY);
  if (!cov) throw new Error("coverage came back null for a map that exists");
  check("landed units are the three", cov.landed.length === 3, cov.landed.map((u) => u.unit.name));
  check("whitespace is the other three", cov.whitespace.length === 3, cov.whitespace.map((u) => u.name));
  check("unmapped holds exactly the warehouse supervisor",
    cov.unmapped.length === 1 && cov.unmapped[0].name === "Dev Nair", cov.unmapped);
  check("alias company counts as its own unit's coverage",
    cov.landed.some((u) => u.unit.name === "Allergan Aesthetics" && u.peopleCount === 1));
  check("totals count people across the parent and its aliases", cov.totals.people === 4, cov.totals);

  // ── a hand assignment outranks the pattern ────────────────────────
  await setDivision(o.id, [ids[3]], "IRA Strategy", "manual", "Assigned by hand");
  const second = await remapByRules(o.id, KEY);
  check("re-run finds nothing new", second.matched === 0 && second.left === 0, second);
  const [dev] = await db.select({ d: connection.division, m: connection.divisionMethod })
    .from(connection).where(eq(connection.id, ids[3]));
  check("hand assignment survived the re-run", dev.d === "IRA Strategy" && dev.m === "manual", dev);

  const cov2 = await accountCoverage(o.id, KEY);
  check("whitespace shrank by the hand-placed unit", cov2!.whitespace.length === 2,
    cov2!.whitespace.map((u) => u.name));

  // ── cleanup ───────────────────────────────────────────────────────
  await db.delete(connection).where(inArray(connection.id, ids));
  await db.delete(connectionBatch).where(eq(connectionBatch.id, batch.id));
  await db.delete(accountMap).where(and(eq(accountMap.orgId, o.id), eq(accountMap.companyKey, KEY)));

  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
