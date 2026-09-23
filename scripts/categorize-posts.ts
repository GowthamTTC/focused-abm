/**
 * Categorise the posts held for one account over a window.
 *
 *   ORG_ID=... KEY="allergan aesthetics" NAME="Allergan Aesthetics" DAYS=30 \
 *     npx tsx --env-file=.env scripts/categorize-posts.ts
 *
 * Reads what is already stored — it does not scan, judge or spend. Categories
 * are the ones the app itself uses: whose voice it is, whether it can be shown
 * to be outside the US, the theme the judge gave it, and which buying-signal
 * phrases it contains.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { db, accountSignal } from "../src/db";
import { voiceOf } from "../src/modules/intel/voice";
import { isUsPost } from "../src/modules/accounts/us-filter";
import { triggersIn, DEFAULT_TRIGGERS } from "../src/modules/accounts/trigger-vocab";

const ARRIVAL = /\b(joined|joining|starting a new|started a new|new chapter|new position|new role)\b/i;
const ANNIV = /\b(\d+(st|nd|rd|th)?[- ]?year|anniversary|years ago|years at|years with)\b/i;
const HIRING = /\b(we are hiring|we're hiring|now hiring|#hiring|open role|open position|join our team|apply (here|now)|is looking for)\b/i;
const EVENT = /\b(summit|conference|congress|symposium|workshop|training|masterclass|webinar|meeting)\b/i;
const PRODUCT = /\b(botox|juvederm|juvéderm|skinvive|coolsculpting|natrelle|skinmedica|diamondglow|bonus|rebate|launch)\b/i;

async function main() {
  const orgId = (process.env.ORG_ID ?? "").trim();
  const key = (process.env.KEY ?? "").trim();
  const name = (process.env.NAME ?? key).trim();
  const days = Number(process.env.DAYS ?? 30);
  if (!orgId || !key) throw new Error("needs ORG_ID and KEY");

  const since = new Date(Date.now() - days * 86400000);
  const rows = await db.select().from(accountSignal).where(and(
    eq(accountSignal.orgId, orgId),
    eq(accountSignal.companyKey, key),
    eq(accountSignal.kind, "linkedin"),
    gte(accountSignal.publishedAt, since),
  )).orderBy(desc(accountSignal.publishedAt));

  const cat = (r: typeof rows[number]) => {
    const body = r.body ?? "";
    const voice = voiceOf(r.title, r.companyName ?? name, []);
    const us = isUsPost(r.title, body);
    const triggers = triggersIn(`${r.title ?? ""} ${body}`, DEFAULT_TRIGGERS).map((t) => t.label);
    let bucket = "other";
    if (ARRIVAL.test(body) && !ANNIV.test(body)) bucket = "arrival";
    else if (ANNIV.test(body)) bucket = "tenure";
    else if (HIRING.test(body)) bucket = "hiring";
    else if (EVENT.test(body)) bucket = "event / training";
    else if (PRODUCT.test(body)) bucket = "product / promotion";
    return { voice, us, triggers, bucket };
  };

  const counted: Record<string, number> = {};
  const bump = (k: string) => { counted[k] = (counted[k] ?? 0) + 1; };
  const listed = rows.map((r) => {
    const c = cat(r);
    bump(`voice:${c.voice}`);
    bump(`us:${c.us}`);
    bump(`bucket:${c.bucket}`);
    for (const t of c.triggers) bump(`trigger:${t}`);
    if (r.theme) bump(`theme:${r.theme}`);
    return {
      when: r.publishedAt?.toISOString().slice(0, 10) ?? null,
      who: (r.title ?? "").split(" — ")[0],
      role: (r.title ?? "").split(" — ").slice(1).join(" — ").slice(0, 70),
      ...c,
      theme: r.theme,
      sentiment: r.sentiment,
      line: (r.body ?? "").replace(/\s+/g, " ").slice(0, 120),
      url: r.url,
    };
  });

  console.log(JSON.stringify({ window: `${days}d`, posts: rows.length, counted, listed }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
