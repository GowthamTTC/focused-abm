/**
 * The Radar CSV: who named the event, and what they actually said.
 *
 * Seven columns, in the order a person reads them — the human, then how to
 * reach them, then the evidence:
 *
 *   Search query · Name · Connection · Title · Company · Location ·
 *   LinkedIn profile · Posted date · Post link · Post text
 *
 * The post columns are the reason this exists, and they are the ones with a
 * story. A person's row carries only mention_snippet — 180 characters, no link
 * — so the full text and the deep link come from the `post` table, which both
 * Radar paths now write: the 1st-degree scan stores what it fetched, and the
 * event search stores the post it matched on. Where neither is available the
 * snippet is used and the link column is left EMPTY rather than filled with a
 * profile URL, because a link that does not go to the post is worse than no
 * link at all.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, connection, post } from "@/db";
import { loadRadar, type RadarPerson } from "@/modules/radar/query";

export const RADAR_CSV_HEADER = [
  // First, not last, and deliberately: it is the grouping key — the column you
  // sort by when several exports are pasted together — and anything placed
  // after the post text is buried behind a field that runs to thousands of
  // characters.
  "Search query",
  "Name",
  // Beside the name, because it is a fact about the person and it is the one
  // that decides whether you can message them at all. NULL means 1st: CSV and
  // sync never write the column, so only Radar's own search ever sets it.
  "Connection",
  "Title",
  "Company",
  "Location",
  "LinkedIn profile",
  // Before the link, so the three post columns sit together and the long text
  // stays last. ISO yyyy-mm-dd: it sorts correctly as a string in every
  // spreadsheet, which a localised date does not.
  "Posted date",
  "LinkedIn post link",
  "LinkedIn post text",
] as const;

/** RFC 4180: quote every field, double the quotes inside. Post text carries
 *  newlines and commas as a matter of course, so quoting is not optional and
 *  the row separator is \r\n for the spreadsheets that insist on it. */
function csvCell(v: string | null | undefined): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}
export function toCsv(rows: readonly (readonly (string | null)[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Their own post, preferred over the stored snippet.
 *
 *  Picks the post that matches the mention: same day as mention_at when we have
 *  it, else the one whose text starts with the snippet, else the newest. A
 *  person can have several stored posts once the hook feed has been scanning
 *  them, and exporting the wrong one would attribute the wrong words. */
function bestPost(
  person: RadarPerson,
  posts: { text: string; url: string | null; postedAt: Date | null }[],
): { text: string; url: string | null; postedAt: Date | null } {
  // mention_at is the date of the post that matched, so it stands in when the
  // post itself was never stored — which is every row imported before the
  // search path started keeping them.
  const fallback = {
    text: person.mentionSnippet ?? "",
    url: null as string | null,
    postedAt: person.mentionAt ?? null,
  };
  if (posts.length === 0) return fallback;

  const snippet = (person.mentionSnippet ?? "").replace(/\s+/g, " ").trim();
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();

  if (snippet) {
    const byText = posts.find((p) => norm(p.text).startsWith(snippet.slice(0, 60)));
    if (byText) return { text: byText.text, url: byText.url, postedAt: byText.postedAt };
  }
  if (person.mentionAt) {
    const day = person.mentionAt.toISOString().slice(0, 10);
    const sameDay = posts.find((p) => p.postedAt?.toISOString().slice(0, 10) === day);
    if (sameDay) return { text: sameDay.text, url: sameDay.url, postedAt: sameDay.postedAt };
  }
  const newest = [...posts].sort(
    (a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0),
  )[0]!;
  return { text: newest.text, url: newest.url, postedAt: newest.postedAt };
}

/** "1st" · "2nd" · "3rd". The column is written out rather than left as a bare
 *  2 or 3, because a spreadsheet reader should not have to know the encoding —
 *  and a bare number risks being read as a count. */
function degreeLabel(d: string | null): string {
  if (d === "2") return "2nd";
  if (d === "3") return "3rd";
  return "1st";
}

export interface RadarCsv { csv: string; rows: number }

/** Exactly the people the screen is showing, in the same order.
 *
 *  It calls loadRadar with the caller's own filters rather than re-querying, so
 *  an export can never disagree with the list it was downloaded from — the
 *  failure mode where a client is sent a spreadsheet nobody can reproduce. */
export async function buildRadarCsv(
  orgId: string,
  opts: {
    metro: string; days: number; pool: "first" | "extended";
    country: string; query?: string; tab?: "mentioned" | "met";
  },
): Promise<RadarCsv> {
  const view = await loadRadar(orgId, opts.metro, opts.days, opts.pool, opts.country, opts.query);
  const people: RadarPerson[] = view
    ? (opts.tab === "met" ? view.met : view.mentioned)
    : [];

  const byPerson = new Map<string, { text: string; url: string | null; postedAt: Date | null }[]>();
  if (people.length > 0) {
    const stored = await db.select({
      connectionId: post.connectionId, text: post.text, url: post.url, postedAt: post.postedAt,
    }).from(post)
      .innerJoin(connection, eq(connection.id, post.connectionId))
      .where(and(eq(connection.orgId, orgId), inArray(post.connectionId, people.map((p) => p.id))));
    for (const row of stored) {
      const arr = byPerson.get(row.connectionId) ?? [];
      arr.push({ text: row.text, url: row.url, postedAt: row.postedAt });
      byPerson.set(row.connectionId, arr);
    }
  }

  const body = people.map((p) => {
    const { text, url, postedAt } = bestPost(p, byPerson.get(p.id) ?? []);
    return [
      // What was searched for, per row: a person can be found by more than one
      // event across exports, and without this the merged file cannot say which.
      p.eventQuery ?? "",
      `${p.firstName} ${p.lastName}`.trim(),
      degreeLabel(p.networkDistance),
      p.positionRaw ?? "",
      p.companyRaw ?? "",
      // City where we have one, country otherwise: "country or city" means the
      // most specific place known, not two columns of mostly-empty.
      p.location ?? p.country ?? "",
      p.linkedinUrl ?? "",
      postedAt ? postedAt.toISOString().slice(0, 10) : "",
      url ?? "",
      text,
    ];
  });

  return { csv: toCsv([[...RADAR_CSV_HEADER], ...body]), rows: body.length };
}
