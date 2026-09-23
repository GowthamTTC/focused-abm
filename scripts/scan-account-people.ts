/**
 * Search LinkedIn for the people at an account and store them.
 *
 *   CONFIRM_PRODUCTION=1 ORG_ID=... KEY="allergan aesthetics" NAME="Allergan Aesthetics" \
 *     npx tsx --env-file=.env scripts/scan-account-people.ts
 *
 * QUERIES="faculty,training" narrows the role phrases, WIDE=1 runs the second
 * pass, PREFIX="Allergan" changes what each phrase is searched beside, and
 * PER_QUERY caps each one.
 * Costs one LinkedIn search request per phrase and never calls the model.
 */
import { eq } from "drizzle-orm";
import { db, org } from "../src/db";
import { scanCompanyPeople, ICP_QUERIES, ICP_QUERIES_WIDE, ICP_TITLES } from "../src/modules/intel/people";

async function main() {
  if (process.env.CONFIRM_PRODUCTION !== "1") throw new Error("needs CONFIRM_PRODUCTION=1");
  const orgId = (process.env.ORG_ID ?? "").trim();
  const key = (process.env.KEY ?? "").trim();
  const name = (process.env.NAME ?? "").trim();
  if (!orgId || !key || !name) throw new Error("needs ORG_ID, KEY and NAME");

  const [w] = await db.select().from(org).where(eq(org.id, orgId));
  if (!w) throw new Error("no such workspace");

  const queries = (process.env.QUERIES ?? "").trim()
    ? process.env.QUERIES!.split(",").map((q) => q.trim()).filter(Boolean)
    : process.env.TITLES === "1" ? ICP_TITLES
    : process.env.WIDE === "1" ? ICP_QUERIES_WIDE
    : ICP_QUERIES;
  const perQuery = Number(process.env.PER_QUERY ?? 25);

  const prefix = (process.env.PREFIX ?? "").trim() || undefined;
  const res = await scanCompanyPeople(orgId, key, name, { queries, perQuery, prefix },
    async (done, total) => { console.error(`  ${done}/${total} searches`); });
  console.log(JSON.stringify({ workspace: w.name, key, ...res }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
