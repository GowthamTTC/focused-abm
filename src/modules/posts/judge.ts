/**
 * Judge stored posts: what kind of post is this, and is it a reason to reach out?
 *
 * Judged against THIS workspace's services digest, never a hardcoded idea of
 * what is relevant — the same post is a strong hook for one workspace and noise
 * for another. Verdicts are written for every post, including the noise: a
 * "congrats" scored 0 is a recorded decision, so the filter can be audited and
 * re-tuned without going back to LinkedIn.
 *
 * Volume is naturally small. Scanning is capped at ~100 people/day and stores
 * about five posts each, so a day of collection is roughly 20 model calls.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, connection, post, service } from "@/db";
import { complete } from "@/llm/client";
import { servicesDigest } from "@/modules/matching/service-fit";
import { getOrgSettings } from "@/modules/settings/org-settings";

/** THE TWO NUMBERS THAT DECIDE WHAT THE TODAY SCREEN SHOWS.
 *
 *  They live here, in the module that also owns HOOK_SCORE_SQL and coerce(),
 *  because all three places that consume them are below feed.ts in the import
 *  graph. They used to be literals in three files — 55 in coerce(), 55 inside
 *  HOOK_SCORE_SQL and HOOK_MIN_RELEVANCE in feed.ts — with a comment begging
 *  the next reader to change all of them together. That comment was the bug:
 *  lowering the feed's threshold alone did nothing, because coerce() had
 *  already thrown away the hook string of every post beneath the old 55, and
 *  the feed requires a non-null hook.
 *
 *  HOOK_MIN_RELEVANCE is 25 because 25 is a real edge in the judge's own scale
 *  (prompts/post-relevance/v1.md): 25–54 is "substantive about their work,
 *  adjacent to the firm's territory but not in it", and 1–24 is "about
 *  something this firm has nothing to do with". Cutting anywhere inside a band
 *  would admit some of a description and reject the rest of it for no reason a
 *  user could be told. Lower it further only by moving the band edge in the
 *  prompt first. */
export const HOOK_MIN_RELEVANCE = 25;

/** The fade. A post's score reaches zero at exactly this age, and the feed
 *  admits nothing older. 30 rather than 14 because the fetch is COUNT-bounded
 *  — five posts per person, no date parameter — so for anyone who posts less
 *  than weekly a fortnight's window threw away most of what was collected. */
export const HOOK_DECAY_DAYS = 30;

const BATCH = 25;
const CONCURRENCY = 3;
/** Rows one run will read. A UI that labels a button from a bigger number is
 *  promising work a single press cannot do. */
export const JUDGE_MAX_PER_RUN = 2000;

const CATEGORIES = new Set(["substantive", "congrats", "promo", "reshare", "personal"]);

const verdicts = z.array(z.object({
  id: z.string(),
  category: z.string().min(1),
  relevance: z.number().int().min(0).max(100),
  hook: z.string().nullable(),
}));

export interface JudgeResult { judged: number; calls: number; failed: number; withHook: number }

/** Only "substantive" may score, and only a real score earns a hook. Enforced
 *  here rather than trusted from the model — the dashboard sorts on relevance,
 *  so a congratulation scoring 70 would poison the top of the list. */
export function coerce(category: string, relevance: number, hook: string | null) {
  const cat = CATEGORIES.has(category) ? category : "personal";
  const rel = cat === "substantive" ? relevance : 0;
  return { category: cat, relevance: rel, hook: rel >= HOOK_MIN_RELEVANCE ? (hook?.trim() || null) : null };
}

export async function judgePosts(
  orgId: string,
  opts: { limit?: number } = {},
  onProgress?: (done: number, total: number) => Promise<void>,
  shouldStop?: () => Promise<boolean>,
): Promise<JudgeResult> {
  const services = (await db.select().from(service)
    .where(and(eq(service.orgId, orgId), eq(service.status, "active"))))
    .map((s) => ({ slug: s.slug, name: s.name, icp: s.icpJson }));
  if (services.length === 0) throw new Error("No active offers — relevance has nothing to judge against.");

  const settings = await getOrgSettings(orgId);
  const digest = servicesDigest(services, settings.catchAllSlug);

  // Only people worth contacting. Judging a peer's posts is money spent on
  // someone we have already decided not to approach.
  const rows = await db.select({
    id: post.id,
    text: post.text,
    firstName: connection.firstName,
    lastName: connection.lastName,
    position: connection.positionRaw,
    headline: connection.headlineRaw,
    company: connection.companyRaw,
  }).from(post)
    .innerJoin(connection, eq(connection.id, post.connectionId))
    .where(and(
      eq(post.orgId, orgId),
      isNull(post.judgedAt),
      eq(connection.bucket, "pitchable"),
    ))
    .limit(opts.limit ?? JUDGE_MAX_PER_RUN);

  const slices: (typeof rows)[] = [];
  for (let i = 0; i < rows.length; i += BATCH) slices.push(rows.slice(i, i + BATCH));

  let judged = 0, calls = 0, failed = 0, withHook = 0, next = 0;
  if (onProgress) await onProgress(0, rows.length);

  const runSlice = async (slice: typeof rows) => {
    const postsJson = JSON.stringify(slice.map((r) => ({
      id: r.id,
      author: `${r.firstName} ${r.lastName}`.trim(),
      author_role: r.position ?? r.headline ?? "",
      author_company: r.company ?? "",
      post: r.text.slice(0, 1200),
    })));

    const out = await complete({
      stage: "classify",
      prompt: "post-relevance",
      vars: { posts_json: postsJson },
      cachedContext: digest,
      schema: verdicts,
      maxTokens: 6000,
    });
    calls += 1;

    const byId = new Map(out.map((o) => [o.id, o]));
    const now = new Date();
    const writes = slice.map((r) => {
      const o = byId.get(r.id);
      // A post the model skipped is marked judged with a 0, not left to be
      // re-billed forever on every subsequent run.
      const v = o
        ? coerce(o.category, o.relevance, o.hook)
        : { category: "personal", relevance: 0, hook: null };
      if (v.hook) withHook += 1;
      return { id: r.id, ...v };
    });

    const values = sql.join(writes.map((w) =>
      sql`(${w.id}::text, ${w.category}::text, ${w.relevance}::int, ${w.hook}::text, ${now}::timestamptz)`,
    ), sql`, `);
    await db.execute(sql`
      update post as p
      set category = v.category, relevance = v.relevance, hook = v.hook, judged_at = v.judged_at
      from (values ${values}) as v(id, category, relevance, hook, judged_at)
      where p.id = v.id
    `);

    judged += slice.length;
    if (onProgress) await onProgress(judged, rows.length);
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      if (shouldStop && (await shouldStop())) return;
      const i = next; next += 1;
      if (i >= slices.length) return;
      try { await runSlice(slices[i]!); } catch { failed += 1; }
    }
  }));

  return { judged, calls, failed, withHook };
}

/** The dashboard's hook: relevance decayed over HOOK_DECAY_DAYS, so a strong post from
 *  last week loses to a strong post from yesterday but still beats silence.
 *
 *  Both numbers come from the constants above, so the feed's pre-filter and
 *  this score can no longer drift apart — which they previously could, being
 *  two separate literals in two files. */
export const HOOK_SCORE_SQL = sql`
  case
    when ${post.relevance} is null or ${post.relevance} < ${HOOK_MIN_RELEVANCE} or ${post.postedAt} is null then 0
    -- least(1, ...) matters: providers do hand back timestamps in the future
    -- (timezone skew, scheduled posts), and without the upper bound the decay
    -- factor exceeds 1, so a relevance-60 post dated three days ahead would
    -- score 73 and sort above a genuine 90 from yesterday.
    else ${post.relevance} * greatest(0, least(1,
      1 - (extract(epoch from (now() - ${post.postedAt})) / (${HOOK_DECAY_DAYS} * 86400.0))))
  end`;

export async function judgeStats(orgId: string) {
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    unjudged: sql<number>`count(*) filter (where judged_at is null)::int`,
    substantive: sql<number>`count(*) filter (where category = 'substantive')::int`,
    withHook: sql<number>`count(*) filter (where hook is not null)::int`,
    fresh: sql<number>`count(*) filter (where hook is not null and posted_at > now() - interval '14 days')::int`,
  }).from(post).where(eq(post.orgId, orgId));
  return row;
}

/** Re-judge everything — after a prompt version bump or an offer rewrite. */
export async function clearVerdicts(orgId: string, ids?: string[]): Promise<number> {
  const rows = await db.update(post)
    .set({ relevance: null, category: null, hook: null, judgedAt: null })
    .where(ids?.length
      ? and(eq(post.orgId, orgId), inArray(post.id, ids))
      : eq(post.orgId, orgId))
    .returning({ id: post.id });
  return rows.length;
}
