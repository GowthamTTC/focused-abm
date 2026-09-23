/**
 * Give every person the page lists a row in account_person.
 *
 *   CONFIRM_PRODUCTION=1 ORG_ID=... KEY="allergan aesthetics" \
 *     npx tsx --env-file=.env scripts/promote-post-authors.ts
 *
 * People found by a post live in account_signal; people found by a search live
 * in account_person. Research reads the second table, so anyone known only from
 * a post could never be researched. This copies the post authors across — name,
 * headline and profile exactly as the post carried them, provenance marked as
 * the post — so the research pass can reach them. It writes nobody twice: the
 * unique index on (org, key, profile) does the deduping.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { createId } from "@paralleldrive/cuid2";

async function main() {
  if (process.env.CONFIRM_PRODUCTION !== "1") throw new Error("needs CONFIRM_PRODUCTION=1");
  const orgId = (process.env.ORG_ID ?? "").trim();
  const key = (process.env.KEY ?? "").trim();
  const name = (process.env.NAME ?? "").trim();
  if (!orgId || !key || !name) throw new Error("needs ORG_ID, KEY and NAME");

  // Newest post per author, employee voice left to the caller's key choice.
  const rows = await db.execute<{ author: string; headline: string; url: string }>(sql`
    select distinct on (split_part(title, ' — ', 1))
      split_part(title, ' — ', 1) as author,
      nullif(substring(title from position(' — ' in title) + 3), '') as headline,
      author_profile_url as url
    from account_signal
    where org_id = ${orgId} and company_key = ${key} and kind = 'linkedin'
      and author_profile_url is not null and title like '% — %'
    order by split_part(title, ' — ', 1), published_at desc nulls last
  `);

  let written = 0;
  for (const r of rows.rows ?? []) {
    const res = await db.execute(sql`
      insert into account_person (id, org_id, company_key, company_name, name, headline, profile_url, captured_by)
      values (${createId()}, ${orgId}, ${key}, ${name}, ${r.author}, ${r.headline}, ${r.url}, 'post author')
      on conflict (org_id, company_key, profile_url) do nothing
    `);
    written += res.rowCount ?? 0;
  }
  console.log(JSON.stringify({ key, authors: (rows.rows ?? []).length, written }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
