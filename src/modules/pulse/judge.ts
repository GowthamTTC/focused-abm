/**
 * Fill sentiment/theme/evidence on this account's signals.
 *
 * A near-sibling of modules/posts/judge.ts and deliberately shaped like it —
 * same batch of 25, same three-worker pool, same cached services digest, same
 * bulk "update ... from (values ...)" write. Two passes that behave differently
 * for no reason are two passes to debug.
 *
 * The one place it must NOT copy that file is the value it writes for a signal
 * the model declined to score. There, an unscorable post is a 0, because
 * relevance has a real floor and 0 means "not relevant". Here 0 means "read it,
 * genuinely neutral", so the same shortcut would manufacture considered
 * judgements out of silence and drag every account's mean toward the middle.
 * Unscorable is null, and meanSentiment drops nulls rather than averaging them.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, accountSignal, service } from "@/db";
import { complete } from "@/llm/client";
import { servicesDigest } from "@/modules/matching/service-fit";
import { getOrgSettings } from "@/modules/settings/org-settings";

const BATCH = 25;
const CONCURRENCY = 3;
/** Rows one run will read. A refresh that silently left half the account
 *  unjudged would report a score drawn from whichever half it happened to get. */
export const SIGNAL_MAX_PER_RUN = 500;

const THEMES = new Set([
  "restructuring", "leadership", "financial", "product",
  "channel", "legal", "expansion", "marketing", "other",
]);

const verdicts = z.array(z.object({
  id: z.string(),
  sentiment: z.number().int().min(-100).max(100).nullable(),
  theme: z.string().min(1),
  evidence: z.string().nullable(),
}));

export interface SignalJudgeResult { judged: number; calls: number; failed: number }

/** The prompt says a score must rest on a quote. This enforces it rather than
 *  trusting it, in the same spirit as coerce() in posts/judge.ts: a sentiment
 *  with no evidence behind it is exactly the black box the panel promises not
 *  to be, and it is indistinguishable from a number the model invented. */
export function coerceSignal(
  sentiment: number | null,
  theme: string,
  evidence: string | null,
): { sentiment: number | null; theme: string; evidence: string | null } {
  const quote = evidence?.trim() || null;
  const t = THEMES.has(theme) ? theme : "other";
  if (sentiment === null || !Number.isFinite(sentiment) || !quote) {
    return { sentiment: null, theme: t, evidence: quote };
  }
  return { sentiment: Math.max(-100, Math.min(100, Math.round(sentiment))), theme: t, evidence: quote };
}

export async function judgeSignals(
  orgId: string,
  companyKey: string,
  /** `kind` scopes a run to one feature's rows. Undefined judges everything
   *  unjudged for the account, which is what the Pulse refresh wants; the
   *  Intelligence scan passes "linkedin" so its spend stays its own and a news
   *  backlog is not silently billed to a LinkedIn scan. */
  opts: { limit?: number; kind?: string } = {},
): Promise<SignalJudgeResult> {
  const services = (await db.select().from(service)
    .where(and(eq(service.orgId, orgId), eq(service.status, "active"))))
    .map((s) => ({ slug: s.slug, name: s.name, icp: s.icpJson }));
  if (services.length === 0) throw new Error("No active offers — there is nothing to read these against.");

  const settings = await getOrgSettings(orgId);
  const digest = servicesDigest(services, settings.catchAllSlug);

  const rows = await db.select({
    id: accountSignal.id,
    companyName: accountSignal.companyName,
    kind: accountSignal.kind,
    title: accountSignal.title,
    body: accountSignal.body,
    publishedAt: accountSignal.publishedAt,
  }).from(accountSignal)
    .where(and(
      eq(accountSignal.orgId, orgId),
      eq(accountSignal.companyKey, companyKey),
      isNull(accountSignal.judgedAt),
      ...(opts.kind ? [eq(accountSignal.kind, opts.kind)] : []),
    ))
    .limit(opts.limit ?? SIGNAL_MAX_PER_RUN);

  if (rows.length === 0) return { judged: 0, calls: 0, failed: 0 };
  const companyName = rows[0]!.companyName;

  const slices: (typeof rows)[] = [];
  for (let i = 0; i < rows.length; i += BATCH) slices.push(rows.slice(i, i + BATCH));

  let judged = 0, calls = 0, failed = 0, next = 0;

  const runSlice = async (slice: typeof rows) => {
    const signalsJson = JSON.stringify(slice.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title ?? "",
      published: r.publishedAt ? r.publishedAt.toISOString().slice(0, 10) : "",
      text: (r.body ?? "").slice(0, 1500),
    })));

    const out = await complete({
      stage: "classify",
      prompt: "account-signal",
      vars: { signals_json: signalsJson, company_name: companyName },
      cachedContext: digest,
      schema: verdicts,
      maxTokens: 6000,
    });
    calls += 1;

    const byId = new Map(out.map((o) => [o.id, o]));
    const now = new Date();
    const writes = slice.map((r) => {
      const o = byId.get(r.id);
      // Marked judged either way, so a row the model keeps skipping is not
      // re-billed on every subsequent refresh for the rest of its life.
      return {
        id: r.id,
        ...(o
          ? coerceSignal(o.sentiment, o.theme, o.evidence)
          : { sentiment: null, theme: "other", evidence: null }),
      };
    });

    const values = sql.join(writes.map((w) =>
      sql`(${w.id}::text, ${w.sentiment}::int, ${w.theme}::text, ${w.evidence}::text, ${now}::timestamptz)`,
    ), sql`, `);
    await db.execute(sql`
      update account_signal as a
      set sentiment = v.sentiment, theme = v.theme, evidence = v.evidence, judged_at = v.judged_at
      from (values ${values}) as v(id, sentiment, theme, evidence, judged_at)
      where a.id = v.id
    `);

    judged += slice.length;
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const i = next; next += 1;
      if (i >= slices.length) return;
      // One bad slice costs its own 25 rows, never the run. They stay unjudged
      // and the next refresh picks them up, which is why judged_at is the queue.
      try { await runSlice(slices[i]!); } catch { failed += 1; }
    }
  }));

  return { judged, calls, failed };
}

/** Re-judge — after a prompt version bump or an offer rewrite. Scoped to one
 *  account by default because the alternative bills the whole table. */
export async function clearSignalVerdicts(orgId: string, companyKey?: string): Promise<number> {
  const rows = await db.update(accountSignal)
    .set({ sentiment: null, theme: null, evidence: null, judgedAt: null })
    .where(companyKey
      ? and(eq(accountSignal.orgId, orgId), eq(accountSignal.companyKey, companyKey))
      : eq(accountSignal.orgId, orgId))
    .returning({ id: accountSignal.id });
  return rows.length;
}
