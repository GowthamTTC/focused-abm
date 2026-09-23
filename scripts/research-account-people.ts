/**
 * Deep-research the people stored against an account.
 *
 *   CONFIRM_PRODUCTION=1 ORG_ID=... KEY="allergan aesthetics" \
 *     SEAT=bxVYoSHnTlanAubxAUNFXw npx tsx --env-file=.env scripts/research-account-people.ts
 *
 * NAMES="A;B" restricts the pass to those people (semicolons, because names
 * contain commas). SEAT is the Unipile account id doing the reading — it does not have to belong
 * to the workspace that owns the people, and which seat it is changes what
 * LinkedIn shows. FORCE=1 re-researches people already done; LIMIT caps the run.
 *
 * Costs one profile fetch, one posts fetch and one model call per person.
 */
import { eq } from "drizzle-orm";
import { db, org } from "../src/db";
import { researchAccountPeople } from "../src/modules/intel/person-research";

async function main() {
  if (process.env.CONFIRM_PRODUCTION !== "1") throw new Error("needs CONFIRM_PRODUCTION=1");
  const orgId = (process.env.ORG_ID ?? "").trim();
  const companyKey = (process.env.KEY ?? "").trim();
  const seatAccountId = (process.env.SEAT ?? "").trim();
  if (!orgId || !companyKey || !seatAccountId) throw new Error("needs ORG_ID, KEY and SEAT");

  const [w] = await db.select().from(org).where(eq(org.id, orgId));
  if (!w) throw new Error("no such workspace");

  const res = await researchAccountPeople(orgId, companyKey, {
    seatAccountId,
    force: process.env.FORCE === "1",
    limit: process.env.LIMIT ? Number(process.env.LIMIT) : undefined,
    onlyNames: (process.env.NAMES ?? "").split(";").map((n) => n.trim()).filter(Boolean),
  }, async (done, total) => { console.error(`  ${done}/${total}`); });

  console.log(JSON.stringify({ workspace: w.name, key: companyKey, ...res }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
