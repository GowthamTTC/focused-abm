/**
 * Search LinkedIn for the people at an account and store them.
 *
 *   CONFIRM_PRODUCTION=1 ORG_ID=... KEY="allergan aesthetics" NAME="Allergan Aesthetics" \
 *     npx tsx --env-file=.env scripts/scan-account-people.ts
 *
 * QUERIES="faculty,training" narrows the role phrases; PER_QUERY caps each page.
 * Costs one LinkedIn search request per phrase and never calls the model.
 */
import { eq } from "drizzle-orm";
import { db, org } from "../src/db";
import { scanCompanyPeople, ICP_QUERIES } from "../src/modules/intel/people";

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
    : ICP_QUERIES;
  const perQuery = Number(process.env.PER_QUERY ?? 25);

  const res = await scanCompanyPeople(orgId, key, name, { queries, perQuery },
    async (done, total) => { console.error(`  ${done}/${total} searches`); });
  console.log(JSON.stringify({ workspace: w.name, key, ...res }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
