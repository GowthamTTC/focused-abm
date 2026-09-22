/**
 * ABM Intelligence — what LinkedIn is saying about a company.
 *
 * Deliberately NOT a band inside Account Pulse, and deliberately not about
 * people. Pulse's Network band scores the posts of people you already know at
 * an account, which means it goes silent for exactly the accounts worth reading
 * about: the ones nobody has a route into yet. This reads the open feed instead
 * — anyone posting about the company, connection or not — and returns a tone,
 * the themes under it, and the posts themselves.
 *
 * It never returns a contact. Who to approach is a different question with
 * different consequences, and folding it in here would make a reading tool into
 * a prospecting one by accident.
 *
 * Storage is `account_signal` under kind "linkedin". That table is already
 * company-keyed and carries sentiment/theme/evidence, and loadPulse filters to
 * news+filing, so these rows cannot leak into Pulse's narrative score and be
 * counted twice.
 */
import { and, eq } from "drizzle-orm";
import { db, channelAccount } from "@/db";
import { env } from "@/lib/env";
import { getChannelProvider } from "@/providers/channel";
import { storeSignals } from "@/modules/pulse/news";
import { toCountry } from "@/modules/connections/country";
import type { NewsItem } from "@/modules/pulse/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Posts shorter than this carry no judgeable opinion — a bare reshare, an
 *  emoji, a job link. Storing them would spend a model call to learn nothing
 *  and would pull the count up without moving the score. */
const MIN_TEXT = 40;

export type IntelWindow = "past_day" | "past_week" | "past_month";

function norm(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * LinkedIn's post search is a relevance engine, not a filter: ask it about a
 * company and it will happily return posts that merely rhyme with the query.
 * Requiring the company's own distinctive word in the text is a cheap, honest
 * guard — it costs nothing and it keeps the tone score about this company.
 *
 * The longest token is used rather than the whole name so "Allergan Aesthetics"
 * still matches a post that only says "Allergan", which is what people write.
 */
export function mentionsCompany(text: string, companyName: string): boolean {
  const hay = norm(text);
  const tokens = norm(companyName).trim().split(/\s+/).filter((t) => t.length >= 4);
  if (tokens.length === 0) {
    const whole = norm(companyName).trim();
    return whole.length > 0 && hay.includes(` ${whole} `);
  }
  return tokens.some((t) => hay.includes(` ${t} `));
}

export interface IntelScanResult {
  /** Posts the search returned, before any filtering. */
  seen: number;
  /** Posts that survived the guards and were written to account_signal. */
  stored: number;
  /** Pages of search results actually requested. */
  pages: number;
  /** True when the cap stopped the scan rather than LinkedIn running out. */
  capped: boolean;
}

/**
 * Search LinkedIn for a company and store what it says.
 *
 * Costs one LinkedIn search request per page and nothing else — judging is a
 * separate pass, so a scan that finds nothing never bills the model.
 */
export async function scanCompanyPosts(
  orgId: string,
  companyKey: string,
  companyName: string,
  /** `keywords` searches for something other than the company name while the
   *  rows still belong to the company — "Allergan restructuring" is a question
   *  ABOUT Allergan Aesthetics, not a different account. The mention guard
   *  keeps using the company name, so a post still has to name the company. */
  opts: { window?: IntelWindow; limit?: number; keywords?: string } = {},
  onProgress?: (done: number, total: number) => Promise<void>,
): Promise<IntelScanResult> {
  const name = companyName.trim();
  if (!name) throw new Error("Intelligence needs a company name.");

  const [seat] = await db.select().from(channelAccount).where(and(
    eq(channelAccount.orgId, orgId),
    eq(channelAccount.status, "operational"),
  ));
  if (!seat) throw new Error("Connect a LinkedIn account in Settings first.");

  const cap = Math.min(opts.limit ?? env.INTEL_POSTS_MAX, env.INTEL_POSTS_MAX);
  const query = (opts.keywords ?? "").trim() || name;
  const provider = getChannelProvider();

  const items: NewsItem[] = [];
  const seenIds = new Set<string>();
  let cursor: string | null = null;
  let seen = 0;
  let pages = 0;
  let capped = false;

  while (items.length < cap) {
    let page: { items: Awaited<ReturnType<typeof provider.searchPosts>>["items"]; cursor: string | null };
    try {
      page = await provider.searchPosts({
        accountId: seat.unipileAccountId,
        keywords: query,
        datePosted: opts.window ?? "past_month",
        cursor,
        limit: 25,
      });
    } catch {
      // A failed page ends the scan with what it already has rather than
      // throwing away a good first page because the second timed out.
      break;
    }
    pages += 1;
    if (page.items.length === 0) break;

    for (const p of page.items) {
      seen += 1;
      const text = (p.text ?? "").replace(/\s+/g, " ").trim();
      if (text.length < MIN_TEXT) continue;
      if (!mentionsCompany(text, name)) continue;

      // The post id is the dedupe key when LinkedIn gives one. It often does
      // not, so the URL is the fallback and the author+opening-words pair is the
      // last resort — a stable string beats a random one, because account_signal
      // is unique on it and a random id would store the same post twice.
      const sourceId = p.id
        || p.url
        || `li:${p.author.publicIdentifier ?? p.author.memberId ?? "anon"}:${text.slice(0, 60)}`;
      if (seenIds.has(sourceId)) continue;
      seenIds.add(sourceId);

      const who = p.isCompany
        ? `${p.author.firstName} ${p.author.lastName}`.trim() || name
        : [`${p.author.firstName} ${p.author.lastName}`.trim(), p.author.headline]
            .filter(Boolean).join(" — ");

      const when = p.postedAt ? new Date(p.postedAt) : null;
      const where = (p.author.location ?? "").trim() || null;
      items.push({
        kind: "linkedin",
        sourceId,
        source: "linkedin",
        title: who.slice(0, 200) || "LinkedIn post",
        url: p.url ?? "",
        body: text,
        publishedAt: when && !Number.isNaN(when.getTime()) ? when : null,
        authorLocation: where,
        authorCountry: toCountry(where),
        capturedBy: query,
        authorProfileUrl: p.author.profileUrl ?? null,
      });
      if (items.length >= cap) {
        capped = true;
        break;
      }
    }

    if (onProgress) await onProgress(items.length, cap);
    cursor = page.cursor;
    if (!cursor) break;
    // The same courtesy pacing the event scan uses. One company is not worth
    // hammering a seat that the whole workspace depends on.
    await sleep(1200);
  }

  const stored = items.length > 0
    ? await storeSignals(orgId, companyKey, name, items)
    : 0;

  return { seen, stored, pages, capped };
}
