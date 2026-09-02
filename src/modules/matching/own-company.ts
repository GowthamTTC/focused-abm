/**
 * The own-company rule, applied on demand.
 *
 * "People who work at our own firm are not prospects" is not a judgment call —
 * it is a deterministic string test that costs nothing to run. So saving the
 * company name applies it immediately, instead of making the user pay for a
 * full Reclassify all (and lose their manual corrections) to enact a free rule.
 *
 * Runs in both directions, release before exclude, so CHANGING the name moves
 * people cleanly rather than stranding the previous firm's staff as excluded.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, connection } from "@/db";

/** Every row this rule writes ends its why with this. It is how the release
 *  pass recognises its own work — nothing else writes this suffix. */
export const OWN_COMPANY_MARK = "— our own company.";

export function ownCompanyWhy(sellerName: string): string {
  return `Works at ${sellerName} ${OWN_COMPANY_MARK}`;
}

/** LIKE treats % and _ as wildcards; a company name containing either would
 *  otherwise match far more than itself. */
function likeNeedle(raw: string): string {
  return `%${raw.toLowerCase().trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export interface OwnCompanyResult { excluded: number; released: number }

/**
 * Re-apply the rule across one workspace.
 * A blank name means the rule is off: everything it previously excluded is
 * released and nothing new is excluded.
 */
export async function applyOwnCompanyRule(
  orgId: string,
  sellerName: string | undefined | null,
): Promise<OwnCompanyResult> {
  const name = (sellerName ?? "").trim();
  const needle = name ? likeNeedle(name) : null;

  // 1 — Release. Anyone this rule excluded who no longer matches goes back to
  // unclassified, so the next matching run judges them on their merits. We do
  // not guess their old verdict; re-running the rule pass is free.
  const released = await db.update(connection).set({
    bucket: null,
    serviceSlug: null,
    matchConfidence: null,
    matchWhy: null,
    matchMethod: null,
    score: null,
    tier: null,
    rank: null,
    scoreBreakdownJson: null,
  }).where(and(
    eq(connection.orgId, orgId),
    sql`${connection.matchWhy} like ${"%" + OWN_COMPANY_MARK}`,
    ...(needle
      ? [sql`lower(coalesce(${connection.companyRaw}, '')) not like ${needle} escape '\\'`]
      : []),
  )).returning({ id: connection.id });

  if (!needle) return { excluded: 0, released: released.length };

  // 2 — Exclude. "is distinct from" rather than <> so unclassified rows (bucket
  // NULL) are caught too — NULL <> 'excluded' is NULL, which matches nothing.
  const excluded = await db.update(connection).set({
    bucket: "excluded",
    serviceSlug: null,
    matchConfidence: 100,
    matchWhy: ownCompanyWhy(name),
    matchMethod: "rule",
    score: null,
    tier: null,
    rank: null,
    scoreBreakdownJson: null,
  }).where(and(
    eq(connection.orgId, orgId),
    isNotNull(connection.companyRaw),
    sql`lower(${connection.companyRaw}) like ${needle} escape '\\'`,
    sql`${connection.bucket} is distinct from 'excluded'`,
  )).returning({ id: connection.id });

  return { excluded: excluded.length, released: released.length };
}
