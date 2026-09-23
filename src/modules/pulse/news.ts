/**
 * Pulse's news collector: read an account's allowed domains, keep the items that
 * actually mention the company, and file them in account_signal for the signal
 * judge to score later.
 *
 * All of this is HTTP and string work, so collection costs nothing and can be
 * re-run freely; the model only sees these rows afterwards. Items are stored
 * whether or not they look interesting, because what was collected and then
 * scored flat has to be auditable the way post verdicts are (docs/ACCOUNT-PULSE.md §5).
 *
 * Nothing here extracts a person. Feeds carry bylines and this file deliberately
 * ignores them: a signal is an event at a company (§0).
 */
import { sql } from "drizzle-orm";
import { accountSignal, db } from "@/db";
import { env } from "@/lib/env";
import { fetchAllowed, hostOf } from "@/modules/pulse/fetch";
import type { NewsItem } from "@/modules/pulse/types";

/** The conventional feed locations, cheapest guess first: /feed is what
 *  WordPress and most corporate newsrooms serve, and the .xml spellings are the
 *  static-site generators. Tried in order and stopped at the first that yields
 *  items, so a newsroom answering all five costs exactly one request. */
const FEED_PATHS = ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml"];

/** Trade press routinely syndicates the whole article into the feed. The judge
 *  reads a few hundred words of it, and this same string is the value compared
 *  on re-collection to decide whether a verdict survives, so it is bounded once
 *  here rather than separately at every reader. */
const BODY_MAX = 4000;

const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g;

/** The five XML entities, with &amp; decoded LAST. Doing it first turns a
 *  correctly escaped "&amp;lt;" into "&lt;" and then into "<", inventing markup
 *  the feed never contained. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return s
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ");
}

/** CDATA unwrapped, tags removed, entities decoded — in that order. Decoding
 *  before stripping would promote an author's escaped "&lt;div&gt;" into a real
 *  tag and then delete the words they were quoting. Entities are decoded even
 *  inside CDATA, where strictly they are literal, because feeds escape in there
 *  anyway and a title reading "Q3 &amp; beyond" on the panel reads as our bug. */
function plain(raw: string | undefined): string {
  if (!raw) return "";
  return decodeEntities(stripTags(raw.replace(CDATA, "$1"))).replace(/\s+/g, " ").trim();
}

/** The same pass, run twice. Atom's type="html" summaries arrive double-escaped
 *  ("&lt;p&gt;Reps said &amp;quot;wait&amp;quot;"), so one pass hands back a
 *  fresh layer of live markup and half-decoded entities that the first strip
 *  never saw — those bodies reached the judge as "<p>…&quot;wait&quot;…</p>"
 *  until the second pass existed. The cost is an author's deliberately quoted
 *  "&lt;div&gt;" disappearing, which is the cheaper mistake: a body is model
 *  input and panel prose, never source code. Titles keep the single pass, where
 *  a stray "&quot;" is ugly but a vanished word is a lie. */
function plainBody(raw: string | undefined): string {
  return plain(plain(raw));
}

/** First matching element's inner text. The optional namespace prefix is what
 *  lets this find dc:date and content:encoded, which enough of the trade press
 *  uses that ignoring them would lose their bodies entirely. */
function tagged(block: string, name: string): string | undefined {
  const re = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "i");
  return block.match(re)?.[1];
}

/** The item's own URL, absolute. Atom hides it in an attribute and ships several
 *  links per entry, of which rel="self" is the feed and rel="replies" or
 *  "enclosure" is not the article, so only an alternate or unlabelled link
 *  counts; RSS 2.0 puts it in the element body instead. A permalink guid is the
 *  last resort because sourceId IS the dedupe key — an item without one has to
 *  be dropped rather than stored under a guess that will duplicate next run. */
function linkOf(block: string, feedUrl: string): string | null {
  let href: string | undefined;
  for (const m of block.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const attrs = m[1] ?? "";
    const rel = attrs.match(/\brel\s*=\s*["']([^"']*)["']/i)?.[1]?.toLowerCase();
    if (rel && rel !== "alternate") continue;
    const h = attrs.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1];
    if (h) { href = h; break; }
  }
  const raw = href || plain(tagged(block, "link")) || plain(tagged(block, "guid"));
  if (!raw) return null;

  try {
    const abs = new URL(raw, feedUrl);
    // A guid that is not a permalink (urn:uuid:…) would dedupe fine but the
    // panel links every signal it shows, so anything unclickable is dropped.
    return abs.protocol === "http:" || abs.protocol === "https:" ? abs.toString() : null;
  } catch {
    return null;
  }
}

/** RSS 2.0 items and Atom entries, read by the same extractor because the only
 *  thing that differs between them is which element names carry the body and
 *  the date. Returns empty for anything that is not a feed, which is how the
 *  caller decides to try the next path. */
function parseFeed(xml: string, feedUrl: string, feedHost: string): NewsItem[] {
  const blocks = [
    ...(xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? []),
    ...(xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) ?? []),
  ];

  const items: NewsItem[] = [];
  for (const b of blocks) {
    const url = linkOf(b, feedUrl);
    if (!url) continue;

    const when = plain(
      tagged(b, "pubDate") || tagged(b, "published") || tagged(b, "updated") || tagged(b, "date"),
    );
    const d = when ? new Date(when) : null;

    items.push({
      // Always "news". "filing" belongs to the filings source, which knows what
      // it fetched; inferring it from a feed title would file every earnings
      // press release as a legally-obliged document, which is the one thing
      // that classification is meant to promise (§5).
      kind: "news",
      sourceId: url,
      source: hostOf(url) ?? feedHost,
      title: plain(tagged(b, "title")),
      url,
      body: plainBody(
        tagged(b, "description") || tagged(b, "summary") || tagged(b, "encoded") || tagged(b, "content"),
      ).slice(0, BODY_MAX),
      publishedAt: d && !Number.isNaN(d.getTime()) ? d : null,
    });
  }
  return items;
}

/** companyKey()'s normalisation applied to free text: lowercased, every run of
 *  non-alphanumerics collapsed to a single space, padded so a match cannot start
 *  mid-word. "Allergan Aesthetics", "allergan-aesthetics" and "ALLERGAN
 *  AESTHETICS." all land on the same string.
 *
 *  Deliberately not an import of companyKey from radar/score: that function mints
 *  an account key and answers "_none" for a missing name, and a text search that
 *  inherited that fallback would match the literal "_none" against every body. */
function normalise(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Newest first, with undated items last. Not (b - a) over a null read as
 *  -Infinity: two undated items then compare NaN and the order becomes whatever
 *  the engine's sort does with it. Undated last also means the cap below sheds
 *  the items we cannot place in time before it sheds one we can. */
function byNewest(a: NewsItem, b: NewsItem): number {
  if (!a.publishedAt && !b.publishedAt) return 0;
  if (!a.publishedAt) return 1;
  if (!b.publishedAt) return -1;
  return b.publishedAt.getTime() - a.publishedAt.getTime();
}

/** An allowlist entry is typed by a human into org settings, so it arrives as
 *  "news.abbvie.com", "https://news.abbvie.com/" or with a path stuck on the
 *  end. hostOf decides what the host is, so this file and the allowlist check
 *  in fetchAllowed cannot disagree about it. Any path the user typed is dropped:
 *  feeds live at the paths above, off the root. */
function feedBase(domain: string): string | null {
  const raw = domain.trim();
  if (!raw) return null;
  const host = hostOf(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  return host ? `https://${host}` : null;
}

/** One domain's feed, or nothing. Catches everything: a domain that is down,
 *  slow, blocked or serving a login page contributes no items and must not take
 *  the other domains' news down with it. */
async function collectDomain(domain: string, domains: string[]): Promise<NewsItem[]> {
  const base = feedBase(domain);
  if (!base) return [];
  const host = hostOf(base) ?? "";

  // The bare host and its www. form are different servers as far as a CDN is
  // concerned, and plenty of publishers serve the feed on ONE of them.
  // fiercepharma.com answers every feed path with 403 and does not redirect;
  // www.fiercepharma.com serves 60KB of RSS from /rss.xml. A workspace that
  // typed the domain without the prefix therefore collected nothing from a
  // source it had deliberately configured — which is how the largest story
  // about an account went unseen for months.
  const bases = host.startsWith("www.")
    ? [base, base.replace("://www.", "://")]
    : [base, base.replace("://", "://www.")];

  for (const b of bases) {
    for (const path of FEED_PATHS) {
      const feedUrl = `${b}${path}`;
      try {
        const xml = await fetchAllowed(feedUrl, domains);
        if (!xml) continue;
        const items = parseFeed(xml, feedUrl, host);
        // "Parses" has to mean "yielded items", not "returned 200". Newsrooms
        // answer an unknown /feed with their HTML homepage, which parses to
        // nothing, and stopping there would never reach the real /rss.xml.
        if (items.length > 0) return items;
      } catch {
        // Keep trying this domain's remaining paths; a thrown fetch says nothing
        // about whether the next path exists.
      }
    }
  }
  return [];
}

/**
 * Every allowed domain's feed, filtered to items that name the company.
 *
 * The cap TRUNCATES SILENTLY — nothing in the returned array records how many
 * matches were dropped — so the caller is owed the rule for noticing it: a list
 * whose length is exactly env.PULSE_NEWS_MAX_ITEMS means at least that many items
 * matched and the OLDEST of them are missing, never that the feeds happened to
 * hold precisely that many. Anything shorter is the whole match set. A caller
 * that needs the true total has to count before capping, which means changing
 * this signature rather than inferring it from the length.
 */
export async function collectNews(domains: string[], companyName: string): Promise<NewsItem[]> {
  const needle = normalise(companyName);
  // With no company name there is no test to apply, and returning the feeds
  // unfiltered would file every unrelated press release under this account.
  if (needle.trim() === "") return [];

  const perDomain = await Promise.all(domains.map((d) => collectDomain(d, domains)));

  const byUrl = new Map<string, NewsItem>();
  for (const item of perDomain.flat()) {
    if (!normalise(`${item.title} ${item.body}`).includes(needle)) continue;
    // Two domains syndicating one story resolve to one canonical URL, which is
    // the key storeSignals writes on. Deduping here keeps the returned count
    // equal to the number of rows it will produce.
    if (!byUrl.has(item.sourceId)) byUrl.set(item.sourceId, item);
  }

  return [...byUrl.values()].sort(byNewest).slice(0, env.PULSE_NEWS_MAX_ITEMS);
}

/** Write the collected items, idempotently on (org, company, source).
 *
 *  Same rule as storePosts: re-collecting an unchanged item must not silently
 *  un-judge it and cost another model call, but an edited body is a different
 *  claim about the company and has to be re-read. Note the three-valued logic —
 *  a stored body of null compares NULL, falls to the else and clears, which is
 *  the safe direction: re-judging costs a call, keeping a verdict that belongs
 *  to text nobody can see costs trust.
 *
 *  Returns how many rows were written or refreshed. */
export async function storeSignals(
  orgId: string,
  companyKey: string,
  companyName: string,
  items: NewsItem[],
): Promise<number> {
  let stored = 0;

  for (const it of items) {
    if (!it.sourceId) continue;
    const body = it.body;

    await db.insert(accountSignal).values({
      orgId,
      companyKey,
      companyName,
      kind: it.kind,
      sourceId: it.sourceId,
      source: it.source,
      title: it.title,
      url: it.url,
      body,
      publishedAt: it.publishedAt,
      authorLocation: it.authorLocation ?? null,
      authorCountry: it.authorCountry ?? null,
      capturedBy: it.capturedBy ?? null,
      authorProfileUrl: it.authorProfileUrl ?? null,
    }).onConflictDoUpdate({
      target: [accountSignal.orgId, accountSignal.companyKey, accountSignal.sourceId],
      set: {
        title: it.title,
        url: it.url,
        body,
        // Backfilled on re-scan: rows stored before this column existed have
        // null here, and a re-run is the only chance to learn it. Left alone
        // when the new value is null so a provider that omits it cannot erase
        // a location already known.
        ...(it.authorLocation ? { authorLocation: it.authorLocation } : {}),
        ...(it.authorCountry ? { authorCountry: it.authorCountry } : {}),
        // The FIRST query to surface a post is the interesting one, so a later
        // scan fills a blank but never overwrites an answer already recorded.
        ...(it.capturedBy ? { capturedBy: sql`coalesce(${accountSignal.capturedBy}, ${it.capturedBy})` } : {}),
        ...(it.authorProfileUrl ? { authorProfileUrl: it.authorProfileUrl } : {}),
        publishedAt: it.publishedAt,
        // Only wipe the verdict when the words actually changed.
        sentiment: sql`case when ${accountSignal.body} = ${body} then ${accountSignal.sentiment} else null end`,
        theme: sql`case when ${accountSignal.body} = ${body} then ${accountSignal.theme} else null end`,
        evidence: sql`case when ${accountSignal.body} = ${body} then ${accountSignal.evidence} else null end`,
        judgedAt: sql`case when ${accountSignal.body} = ${body} then ${accountSignal.judgedAt} else null end`,
      },
    });
    stored += 1;
  }

  return stored;
}
