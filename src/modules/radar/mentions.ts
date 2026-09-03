/**
 * Travel / event mentions in recent posts. Weaker than a home-city match:
 * talking about SF from Bangalore is not "based in the Bay".
 */
import { metroBySlug, normalizePlace, type Metro } from "@/modules/geo/metros";

const TRAVEL = [
  "in town", "this week", "next week", "flying to", "headed to", "heading to",
  "on my way", "see you", "see ya", "here for", "in sf", "in the bay",
  "at the conference", "speaking at", "attending", "on stage", "booth",
];

export interface MentionHit {
  metro: string;
  snippet: string;
  postedAt: Date | null;
  kind: "travel" | "event" | "place";
}

function padded(s: string): string {
  return ` ${s} `;
}

function eventMatches(hay: string, event: string): boolean {
  if (!event || event.length < 3) return false;
  if (padded(hay).includes(padded(event))) return true;
  const compact = event.replace(/ /g, "");
  if (compact.length >= 5 && hay.replace(/ /g, "").includes(compact)) return true;
  const tokens = event.split(/\s+/).filter((t) => t.length >= 5 && !/^(20\d{2}|conference|summit|annual)$/.test(t));
  return tokens.some((t) => padded(hay).includes(padded(t)));
}

function near(hay: string, a: string, b: string, window = 48): boolean {
  const ia = padded(hay).indexOf(padded(a));
  const ib = padded(hay).indexOf(padded(b));
  if (ia < 0 || ib < 0) return false;
  return Math.abs(ia - ib) <= window;
}

export function detectMentions(
  posts: { text: string; postedAt: string | Date | null }[],
  metro: Metro,
  eventName?: string,
): MentionHit | null {
  const event = eventName ? normalizePlace(eventName) : "";
  let best: MentionHit | null = null;

  for (const post of posts) {
    const hay = normalizePlace(post.text ?? "");
    if (!hay) continue;
    const when = post.postedAt ? new Date(post.postedAt) : null;
    const postedAt = when && !Number.isNaN(when.getTime()) ? when : null;
    const snippet = (post.text ?? "").replace(/\s+/g, " ").trim().slice(0, 180);

    const placeHit = [...metro.phrases, ...metro.cities, ...metro.ambiguous]
      .filter((p) => p.length >= 2)
      .some((p) => padded(hay).includes(padded(p)));
    const travelHit = TRAVEL.some((t) => padded(hay).includes(padded(normalizePlace(t))))
      || TRAVEL.some((t) => placeHit && near(hay, normalizePlace(t), metro.phrases[0] ?? "bay"));
    const eventHit = eventMatches(hay, event);

    // Event name in the post is enough — do not pull in people who only live in the metro.
    if (eventHit) {
      const hit: MentionHit = { metro: metro.slug, snippet, postedAt, kind: "event" };
      if (!best || (postedAt && (!best.postedAt || postedAt > best.postedAt))) best = hit;
      continue;
    }
    if (placeHit && travelHit) {
      const hit: MentionHit = { metro: metro.slug, snippet, postedAt, kind: "travel" };
      if (!best || (postedAt && (!best.postedAt || postedAt > best.postedAt))) best = hit;
      continue;
    }
    if (placeHit) {
      const hit: MentionHit = { metro: metro.slug, snippet, postedAt, kind: "place" };
      if (!best || (postedAt && (!best.postedAt || postedAt > best.postedAt))) best = hit;
    }
  }
  return best;
}

export function mentionForSlug(
  posts: { text: string; postedAt: string | Date | null }[],
  slug: string,
  eventName?: string,
): MentionHit | null {
  const metro = metroBySlug(slug);
  if (!metro) return null;
  return detectMentions(posts, metro, eventName);
}

/** Country-wide 2nd/3rd scan: event name in the post is the only filter. */
export function mentionForEvent(
  posts: { text: string; postedAt: string | Date | null }[],
  eventName: string,
  countrySlug: string,
): MentionHit | null {
  const event = normalizePlace(eventName);
  if (!event || event.length < 3) return null;
  let best: MentionHit | null = null;
  for (const post of posts) {
    const hay = normalizePlace(post.text ?? "");
    if (!hay || !eventMatches(hay, event)) continue;
    const when = post.postedAt ? new Date(post.postedAt) : null;
    const postedAt = when && !Number.isNaN(when.getTime()) ? when : null;
    const snippet = (post.text ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
    const hit: MentionHit = { metro: countrySlug, snippet, postedAt, kind: "event" };
    if (!best || (postedAt && (!best.postedAt || postedAt > best.postedAt))) best = hit;
  }
  return best;
}


/** Companies to leave out of an event scan — normally the event's host.
 *
 *  A Dreamforce search is mostly Salesforce staff and an Unbound search mostly
 *  HubSpot's; they are the loudest posters about their own event and the least
 *  useful result, because they are not attendees you can sell to.
 *
 *  Matches an EMPLOYMENT CLAIM, never a mention. "Product Marketer at
 *  Salesforce" and "Senior Director @ Salesforce" are excluded; "Salesforce
 *  MVP", "HubSpot AI Consultant" and "Salesforce consultant at Acme" are kept,
 *  because those people work somewhere else and are exactly who the search is
 *  for. Getting this backwards would drop most of an event's real audience.
 */
export function parseExcludedCompanies(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2);
}

export function isExcludedCompany(
  terms: string[],
  company: string | null | undefined,
  headline: string | null | undefined,
): boolean {
  if (terms.length === 0) return false;
  const co = (company ?? "").toLowerCase();
  const head = (headline ?? "").toLowerCase();
  return terms.some((t) => {
    if (co.includes(t)) return true;
    // The parser only splits on the FIRST " at "/"@", so an employment claim
    // can still be sitting further along a crowded headline.
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:\\bat|@)\\s+${escaped}\\b`, "i").test(head);
  });
}
