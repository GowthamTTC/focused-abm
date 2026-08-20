/**
 * Hallway rank — who is worth walking up to this week.
 * Presence is labeled; we never claim someone is at the venue.
 */
export type Presence = "based_active" | "mentioned_active" | "based_quiet";

export interface RadarInput {
  metro: string | null;
  metroEvidence: string | null;
  mentionMetro: string | null;
  mentionAt: Date | null;
  mentionKind?: string | null;
  lastPostAt: Date | null;
  lastScanAt: Date | null;
  tier: number | null;
  rank: number | null;
  score: number | null;
  sentAt: Date | null;
  flagVerdict: string | null;
  bucket: string | null;
  floorStatus: string | null;
  companyKey: string;
  sameCompanyCount: number;
}

export interface RadarScore {
  presence: Presence;
  total: number;
  why: string;
}

const DAY = 86400000;

export function daysAgo(d: Date | null, now = Date.now()): number | null {
  if (!d) return null;
  return Math.max(0, (now - d.getTime()) / DAY);
}

export function presenceOf(row: RadarInput, slug: string, windowDays: number, now = Date.now()): Presence | null {
  if (row.bucket && row.bucket !== "pitchable") return null;
  if (row.flagVerdict === "dropped") return null;
  if (row.floorStatus === "skipped") return null;

  const based = row.metro === slug;
  const mentioned = row.mentionMetro === slug && row.mentionAt
    && (now - row.mentionAt.getTime()) <= windowDays * DAY;
  const posted = row.lastPostAt && (now - row.lastPostAt.getTime()) <= windowDays * DAY;

  if (based && posted) return "based_active";
  if (mentioned && (posted || (row.mentionAt && (now - row.mentionAt.getTime()) <= windowDays * DAY))) {
    return "mentioned_active";
  }
  if (based) return "based_quiet";
  return null;
}

export function scoreRadar(row: RadarInput, slug: string, windowDays: number, now = Date.now()): RadarScore | null {
  const presence = presenceOf(row, slug, windowDays, now);
  if (!presence) return null;

  const postDays = daysAgo(row.lastPostAt, now);
  let total = 0;
  const bits: string[] = [];

  if (presence === "based_active") { total += 100; bits.push("based here + posted in window"); }
  else if (presence === "mentioned_active") { total += 70; bits.push("recent post names this metro"); }
  else { total += 40; bits.push("based here, no recent post"); }

  if (row.metroEvidence === "profile") total += 8;
  else if (row.metroEvidence === "headline") { total += 3; bits.push("city from headline"); }

  if (postDays !== null) {
    if (postDays <= 1) { total += 28; bits.push("posted today/yesterday"); }
    else if (postDays <= 3) { total += 22; }
    else if (postDays <= 7) { total += 16; }
  } else if (presence === "based_quiet") {
    bits.push(row.lastScanAt ? "scanned, no posts in window" : "activity not scanned yet");
  }

  if (row.tier === 1) { total += 20; bits.push("T1"); }
  else if (row.tier === 2) { total += 10; }
  else if (row.tier === 3) total += 4;

  if (typeof row.score === "number") total += Math.min(12, Math.round(row.score / 10));
  if (typeof row.rank === "number" && row.rank <= 30) total += 6;

  if (row.sameCompanyCount >= 3) { total += 12; bits.push(`${row.sameCompanyCount} from same company`); }
  else if (row.sameCompanyCount === 2) { total += 6; bits.push("another person from this company"); }

  if (row.sentAt && (now - row.sentAt.getTime()) <= 14 * DAY) {
    total -= 25;
    bits.push("already messaged in last 14d");
  }

  if (row.mentionKind === "travel" || row.mentionKind === "event") {
    total += 10;
    bits.push(row.mentionKind === "event" ? "named the event" : "travel language");
  }

  return { presence, total, why: bits.join(" · ") };
}

export function companyKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || "_none";
}
