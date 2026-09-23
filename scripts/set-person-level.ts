/**
 * Correct one person's seniority band by hand.
 *
 *   CONFIRM_PRODUCTION=1 ORG_ID=... NAME="Samantha (Puja) Dundas" LEVEL=director \
 *     npx tsx --env-file=.env scripts/set-person-level.ts
 *
 * LEVEL is exec | vp | director | manager | trainer | other, or "" to go back
 * to reading it off the headline. The band is the only thing this sets: the
 * headline, the profile and the provenance stay exactly as LinkedIn gave them.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, accountPerson, org } from "../src/db";

const LEVELS = ["exec", "vp", "director", "manager", "trainer", "other", ""];

async function main() {
  if (process.env.CONFIRM_PRODUCTION !== "1") throw new Error("needs CONFIRM_PRODUCTION=1");
  const orgId = (process.env.ORG_ID ?? "").trim();
  const name = (process.env.NAME ?? "").trim();
  const level = (process.env.LEVEL ?? "").trim();
  if (!orgId || !name) throw new Error("needs ORG_ID and NAME");
  if (!LEVELS.includes(level)) throw new Error(`LEVEL must be one of ${LEVELS.join(", ")}`);

  const [w] = await db.select().from(org).where(eq(org.id, orgId));
  if (!w) throw new Error("no such workspace");

  const rows = await db.update(accountPerson)
    .set({ levelOverride: level || null, updatedAt: sql`now()` })
    .where(and(eq(accountPerson.orgId, orgId), eq(accountPerson.name, name)))
    .returning({ name: accountPerson.name, headline: accountPerson.headline });
  console.log(JSON.stringify({ workspace: w.name, level: level || null, updated: rows }, null, 2));
  process.exit(rows.length > 0 ? 0 : 1);
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
