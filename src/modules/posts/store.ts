/**
 * Persist fetched posts.
 *
 * Both scans that touch LinkedIn already ask for the full post objects — text,
 * share_url, timestamp — and throw all of it away except the maximum date.
 * This keeps what we have already paid for. It adds no requests, so it does not
 * change anyone's rate-limit exposure.
 *
 * Idempotent by (connection_id, provider_id): re-scanning a person updates
 * their posts rather than duplicating them, because LinkedIn returns the same
 * post ids and people do edit posts.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, post } from "@/db";
import type { FetchedPost } from "@/providers/channel";

export interface StoredPosts {
  /** How many rows were written or refreshed. */
  stored: number;
  /** Newest valid postedAt across the batch, for connection.last_post_at. */
  newest: Date | null;
}

/** A post whose judgement columns are already filled keeps them: re-fetching
 *  the same text must not silently un-judge it and cost another model call.
 *  Text changing IS meaningful though, so the judgement is cleared then. */
export async function storePosts(
  orgId: string,
  connectionId: string,
  fetched: FetchedPost[],
): Promise<StoredPosts> {
  let newest: Date | null = null;
  let stored = 0;

  for (const f of fetched) {
    const text = (f.text ?? "").trim();
    if (!text || !f.id) continue;

    const d = f.postedAt ? new Date(f.postedAt) : null;
    const postedAt = d && !Number.isNaN(d.getTime()) ? d : null;
    if (postedAt && (!newest || postedAt > newest)) newest = postedAt;

    await db.insert(post).values({
      orgId,
      connectionId,
      providerId: f.id,
      text,
      url: f.url ?? null,
      postedAt,
    }).onConflictDoUpdate({
      target: [post.connectionId, post.providerId],
      set: {
        text,
        url: f.url ?? null,
        postedAt,
        // Only wipe the verdict when the words actually changed.
        relevance: sql`case when ${post.text} = ${text} then ${post.relevance} else null end`,
        category: sql`case when ${post.text} = ${text} then ${post.category} else null end`,
        hook: sql`case when ${post.text} = ${text} then ${post.hook} else null end`,
        judgedAt: sql`case when ${post.text} = ${text} then ${post.judgedAt} else null end`,
      },
    });
    stored += 1;
  }

  return { stored, newest };
}

/** How many posts in this workspace are still waiting on the relevance pass. */
export async function unjudgedCount(orgId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(post)
    .where(and(eq(post.orgId, orgId), sql`${post.judgedAt} is null`));
  return row?.n ?? 0;
}
