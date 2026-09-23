/**
 * Take a person out of the account's ICP list, or put them back.
 *
 *   CONFIRM_PRODUCTION=1 ORG_ID=... NAMES="Katie Dombrowski;Glen Curran" \
 *     npx tsx --env-file=.env scripts/hide-icp-person.ts
 *   UNHIDE=1 puts the same names back.
 *
 * The ICP test reads a headline, and a headline cannot say that a Finance
 * Director is out of scope or that a trainer works for a customer rather than
 * the account. This is where a reader who knows that says so. Nothing is
 * deleted: the posts and the profiles stay, the account list stops showing
 * them.
 */
import { eq } from "drizzle-orm";
import { db, org } from "../src/db";
import { getOrgSettings, updateOrgSettings } from "../src/modules/settings/org-settings";

async function main() {
  if (process.env.CONFIRM_PRODUCTION !== "1") throw new Error("needs CONFIRM_PRODUCTION=1");
  const orgId = (process.env.ORG_ID ?? "").trim();
  // Semicolons, not commas: "Carlos Sandoval, DNP, FNP, CANS" is one person
  // and a comma split turned him into four.
  const names = (process.env.NAMES ?? "").split(";").map((n) => n.trim()).filter(Boolean);
  if (!orgId || names.length === 0) throw new Error("needs ORG_ID and NAMES");

  const [w] = await db.select().from(org).where(eq(org.id, orgId));
  if (!w) throw new Error("no such workspace");

  const settings = await getOrgSettings(orgId);
  const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const current = settings.icpHidden ?? [];
  const next = process.env.REPLACE === "1"
    ? names
    : process.env.UNHIDE === "1"
    ? current.filter((n) => !names.some((x) => key(x) === key(n)))
    : [...current, ...names.filter((n) => !current.some((c) => key(c) === key(n)))];

  await updateOrgSettings(orgId, { icpHidden: next });
  console.log(JSON.stringify({ workspace: w.name, hidden: next }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
