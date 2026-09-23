/**
 * Find the people at an account by searching for them.
 *
 * The post feed answers "who wrote something this month", which is a small and
 * self-selecting slice of an organisation: the head of a faculty team who never
 * posts is invisible to it, and he is exactly who an account plan is about.
 * This asks LinkedIn's people search instead, once per role phrase, and stores
 * what it returns — a name, a headline, a location, a profile. Nothing is
 * inferred beyond what the headline says.
 *
 * Costs one LinkedIn search request per page. It never calls the model.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, channelAccount, accountPerson } from "@/db";
import { getChannelProvider } from "@/providers/channel";
import { toCountry } from "@/modules/connections/country";


/** Does this headline say the person works for THIS employer?
 *
 *  The post guard asks whether any word of the company name appears, which is
 *  right for a post — "Allergan" or "Aesthetics" in a paragraph is a mention.
 *  It is wrong for a headline: "Founder & Owner of KORÉ Aesthetics" matched
 *  Allergan Aesthetics on the industry word alone, and a people search returns
 *  that by the dozen. So the brand word — the first real word of the name —
 *  has to be there. A dropped plural does not count as a different employer.
 */
export function headlineNamesEmployer(headline: string, companyName: string): boolean {
  const hay = ` ${headline.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const brand = companyName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .split(/\s+/).find((w) => w.length >= 4);
  if (!brand) return false;
  const stem = brand.replace(/s$/, "");
  return hay.includes(` ${stem} `) || hay.includes(` ${stem}s `);
}

export interface PeopleScanResult {
  /** Profiles the searches returned, before any guard. */
  seen: number;
  /** Profiles whose headline names the company and that were written. */
  stored: number;
  /** Dropped because the headline never names the company — LinkedIn's people
   *  search is a keyword search, and it will happily return someone whose
   *  profile merely mentions a competitor's product. */
  offCompany: number;
  /** Dropped because the profile says it is somewhere other than the US. */
  elsewhere: number;
  queries: string[];
}

/** Role phrases that describe the people who buy leadership and communication
 *  development, or who own the teams it is bought for. Each one is searched
 *  beside the company name, because "Allergan Aesthetics" alone returns the
 *  whole company in no useful order. */
export const ICP_QUERIES = [
  "learning and development",
  "talent development",
  "leadership development",
  "training",
  "field training",
  "medical education",
  "faculty",
  "human resources",
  "communications",
  "organizational development",
  "enablement",
];

/** A second pass, for when the first has been run and the account is still
 *  thinner than it should be. Same idea, further out: the functions that own a
 *  rollout, the people who run the field's own capability, and the HR roles
 *  that sit inside a business unit rather than above it. */
/** The buyer's job titles, as the buyer writes them. The role-phrase lists
 *  above find people by what they do; this finds them by what their card says,
 *  which is how a seller of leadership development actually describes its
 *  market. CEO is deliberately absent — the account is entered through the
 *  people function, not the corner office. */
export const ICP_TITLES = [
  "Chief Learning Officer",
  "Chief Human Resources Officer",
  "Chief Operating Officer",
  "Chief People Officer",
  "VP of Human Resources",
  "VP of Organizational Development",
  "VP of Talent Management",
  "VP of Learning and Development",
  "VP of People and Culture",
  "Director of Leadership Development",
  "Director of Organizational Effectiveness",
  "Director of Talent and Learning",
  "Director of Change Management",
  "Director of Employee Experience",
  "Head of People",
  "Head of Culture and Engagement",
  "Organizational Development Manager",
  "Change Management Lead",
  "Learning and Development Manager",
];

export const ICP_QUERIES_WIDE = [
  "sales training",
  "commercial excellence",
  "commercial operations",
  "customer experience",
  "change management",
  "internal communications",
  "employee experience",
  "talent acquisition",
  "coaching",
  "onboarding",
  "capability",
  "academy",
  "HR business partner",
  "people operations",
  "speaker training",
  "field force effectiveness",
];

export async function scanCompanyPeople(
  orgId: string,
  companyKey: string,
  companyName: string,
  opts: {
    queries?: string[];
    perQuery?: number;
    locationQuery?: string;
    /** What each role phrase is searched beside. Defaults to the company name;
     *  "Allergan" finds the institute's people too, whose headlines name the
     *  brand but not the unit. */
    prefix?: string;
  } = {},
  onProgress?: (done: number, total: number) => Promise<void>,
): Promise<PeopleScanResult> {
  const name = companyName.trim();
  if (!name) throw new Error("A people scan needs a company name.");

  const [seat] = await db.select().from(channelAccount).where(and(
    eq(channelAccount.orgId, orgId),
    eq(channelAccount.status, "operational"),
  ));
  if (!seat) throw new Error("Connect a LinkedIn account in Settings first.");

  const provider = getChannelProvider();
  const prefix = (opts.prefix ?? name).trim();
  const queries = (opts.queries ?? ICP_QUERIES).map((q) => `${prefix} ${q}`);
  const perQuery = Math.max(10, Math.min(50, opts.perQuery ?? 25));
  const locationQuery = opts.locationQuery ?? "United States";

  const out: PeopleScanResult = { seen: 0, stored: 0, offCompany: 0, elsewhere: 0, queries };
  const writtenUrls = new Set<string>();

  for (const [i, keywords] of queries.entries()) {
    // LinkedIn answers a search ten at a time whatever limit is asked for, so
    // the pages are walked until the per-query cap is met. One query that dies
    // does not end the scan; the rest are independent of it.
    const hitItems: Awaited<ReturnType<typeof provider.searchPeople>>["items"] = [];
    let cursor: string | null = null;
    while (hitItems.length < perQuery) {
      let page: Awaited<ReturnType<typeof provider.searchPeople>>;
      try {
        page = await provider.searchPeople({
          accountId: seat.unipileAccountId,
          keywords,
          networkDistance: [2, 3],
          locationQuery,
          cursor,
          limit: Math.min(50, perQuery),
        });
      } catch {
        break;
      }
      if (page.items.length === 0) break;
      hitItems.push(...page.items);
      cursor = page.cursor;
      if (!cursor) break;
    }

    for (const h of hitItems) {
      out.seen += 1;
      const headline = (h.headline ?? "").replace(/\s+/g, " ").trim();
      // The guard is the headline, not the search phrase: LinkedIn returns
      // people who match loosely, and "works at the company" has to come from
      // what the person says about themselves.
      if (!headlineNamesEmployer(headline, name)) { out.offCompany += 1; continue; }

      const location = (h.location ?? "").trim() || null;
      const country = toCountry(location);
      // Said to be somewhere else. A blank location is kept — LinkedIn often
      // omits it, and dropping the unknown would quietly shrink the account.
      if (country && country !== "US") { out.elsewhere += 1; continue; }

      const profileUrl = h.profileUrl
        ?? (h.publicIdentifier ? `https://www.linkedin.com/in/${h.publicIdentifier}` : null);
      if (!profileUrl || writtenUrls.has(profileUrl)) continue;
      writtenUrls.add(profileUrl);

      const person = {
        orgId,
        companyKey,
        companyName: name,
        name: `${h.firstName} ${h.lastName}`.replace(/\s+/g, " ").trim(),
        headline: headline || null,
        location,
        country,
        profileUrl,
        publicIdentifier: h.publicIdentifier,
        memberId: h.memberId,
        networkDistance: h.networkDistance,
        capturedBy: keywords,
      };
      await db.insert(accountPerson).values(person).onConflictDoUpdate({
        target: [accountPerson.orgId, accountPerson.companyKey, accountPerson.profileUrl],
        set: {
          name: person.name,
          headline: person.headline,
          location: person.location,
          country: person.country,
          publicIdentifier: person.publicIdentifier,
          memberId: person.memberId,
          networkDistance: person.networkDistance,
          updatedAt: sql`now()`,
        },
      });
      out.stored += 1;
    }

    if (onProgress) await onProgress(i + 1, queries.length);
  }

  return out;
}
