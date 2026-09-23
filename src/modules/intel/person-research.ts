/**
 * Deep research on the people found at an account.
 *
 * The people search gives a name, a headline and a profile link. That is enough
 * to build a list and not enough to walk into a conversation. This fetches each
 * person's profile and their recent posts through a chosen LinkedIn seat, then
 * asks the model to say who they are, what they are under pressure to deliver
 * and where the workspace's offer touches it — with the fetched evidence stored
 * beside the conclusion so a claim can be checked rather than trusted.
 *
 * The seat is explicit. A profile read is done by somebody, and who did it
 * decides what LinkedIn showed and what network distance means.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, accountPerson, channelAccount } from "@/db";
import { complete } from "@/llm/client";
import { getChannelProvider } from "@/providers/channel";
import { getOrgSettings } from "@/modules/settings/org-settings";

const researchOut = z.object({
  about_summary: z.string(),
  posts_summary: z.string(),
  priorities: z.string(),
  angle: z.string(),
  evidence: z.string().nullable(),
  flag: z.string().nullable(),
});
export type PersonResearch = z.infer<typeof researchOut>;

const DEFAULT_SELLER_CONTEXT =
  "A leadership and communication development firm. It sells presence, storytelling, "
  + "influence and team development to the people who own capability inside large companies.";

export interface ResearchResult {
  /** People the pass looked at. */
  seen: number;
  /** People whose profile was fetched and summarised. */
  researched: number;
  /** Skipped because LinkedIn gave nothing back for the identifier. */
  unreachable: number;
  seat: string;
}

/** Identifier LinkedIn will accept: its own public id, else the slug in the URL. */
function identifierOf(p: { publicIdentifier: string | null; profileUrl: string | null }): string | null {
  if (p.publicIdentifier) return p.publicIdentifier;
  const m = (p.profileUrl ?? "").match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? m[1] : null;
}

export async function researchAccountPeople(
  orgId: string,
  companyKey: string,
  opts: {
    /** The Unipile account doing the reading. Required — there is no sensible
     *  default when the seat that owns the data and the seat doing the work can
     *  be different people. */
    seatAccountId: string;
    /** Re-research people already done. Off by default, so a re-run costs
     *  nothing for the ones that are finished. */
    force?: boolean;
    limit?: number;
    /** Only these people, by exact name. The table holds everyone found at the
     *  account; a research pass usually wants only the ones a list shows. */
    onlyNames?: string[];
  },
  onProgress?: (done: number, total: number) => Promise<void>,
): Promise<ResearchResult> {
  const [seat] = await db.select().from(channelAccount)
    .where(eq(channelAccount.unipileAccountId, opts.seatAccountId));
  if (!seat) throw new Error("no such LinkedIn seat");
  if (seat.status !== "operational") throw new Error(`seat is ${seat.status}, not operational`);

  const provider = getChannelProvider();
  const settings = await getOrgSettings(orgId);
  const sellerContext = settings.sellerContext?.trim() || DEFAULT_SELLER_CONTEXT;

  const people = await db.select().from(accountPerson).where(and(
    eq(accountPerson.orgId, orgId),
    eq(accountPerson.companyKey, companyKey),
    ...(opts.force ? [] : [isNull(accountPerson.researchedAt)]),
    ...(opts.onlyNames?.length ? [inArray(accountPerson.name, opts.onlyNames)] : []),
  )).limit(opts.limit ?? 200);

  const out: ResearchResult = {
    seen: people.length, researched: 0, unreachable: 0,
    seat: seat.displayName ?? seat.unipileAccountId,
  };

  for (const [i, p] of people.entries()) {
    const identifier = identifierOf(p);
    if (!identifier) { out.unreachable += 1; continue; }

    let about: string | null = null;
    let headline = p.headline;
    try {
      const profile = await provider.fetchProfile({ accountId: seat.unipileAccountId, identifier });
      if (profile) {
        about = profile.about;
        headline = profile.headline ?? headline;
      }
    } catch { /* a profile LinkedIn will not serve is not a failed run */ }

    let posts: { text: string; postedAt: string | null; url: string | null }[] = [];
    try {
      const fetched = await provider.fetchRecentPosts({
        accountId: seat.unipileAccountId, identifier, limit: 5,
      });
      posts = fetched.map((f) => ({ text: f.text, postedAt: f.postedAt, url: f.url }));
    } catch { /* posts stay empty, and the prompt is told that means something */ }

    if (!about && posts.length === 0 && !headline) { out.unreachable += 1; continue; }

    const postsBlock = posts.length > 0
      ? posts.map((x, n) => `[${n + 1}] (${x.postedAt ?? "undated"}) ${x.text.slice(0, 600)}`).join("\n\n")
      : "NONE";

    const research = await complete({
      stage: "deepdive",
      prompt: "account-person-research",
      vars: {
        seller_context: sellerContext,
        company_name: p.companyName,
        full_name: p.name,
        headline: headline || "(not available)",
        location: p.location || "(not available)",
        linkedin_url: p.profileUrl || "(not available)",
        about: about || "(not available)",
        posts_block: postsBlock,
      },
      schema: researchOut,
      maxTokens: 1200,
    });

    await db.update(accountPerson).set({
      about,
      headline,
      postsJson: posts,
      researchJson: research,
      researchedAt: new Date(),
      researchedBy: seat.displayName ?? seat.unipileAccountId,
      updatedAt: sql`now()`,
    }).where(eq(accountPerson.id, p.id));

    out.researched += 1;
    if (onProgress) await onProgress(i + 1, people.length);
  }

  return out;
}
