/** Title normalizer: lowercase, strip punctuation/emoji, expand common abbreviations. */
const ABBREV: [RegExp, string][] = [
  [/\bsr\.?\b/g, "senior"], [/\bjr\.?\b/g, "junior"],
  [/\bvp\b/g, "vice president"], [/\bavp\b/g, "assistant vice president"],
  [/\bevp\b/g, "executive vice president"], [/\bsvp\b/g, "senior vice president"],
  [/\bcmo\b/g, "chief marketing officer"], [/\bceo\b/g, "chief executive officer"],
  [/\bcoo\b/g, "chief operating officer"], [/\bcto\b/g, "chief technology officer"],
  [/\bcro\b/g, "chief revenue officer"], [/\bgm\b/g, "general manager"],
  [/\bmktg\b/g, "marketing"], [/\bmgr\b/g, "manager"], [/\bdir\b/g, "director"],
  [/\bbd\b/g, "business development"], [/\bgtm\b/g, "go to market"],
  [/\bdgm\b/g, "deputy general manager"],
];

export function normalizeTitle(raw: string): string {
  let s = raw.toLowerCase();
  s = s.replace(/[|/,&+@()\-–—·•]+/g, " ");
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
  for (const [re, sub] of ABBREV) s = s.replace(re, sub);
  return s.replace(/\s+/g, " ").trim();
}

export type Seniority = "junior" | "founder" | "cxo" | "vp" | "head" | "director" | "manager" | "ic";

/** Read a title's seniority band. Junior checked FIRST so "marketing intern"
 *  and "aspiring founder" never masquerade as senior. Bands align with the
 *  persona `seniority` vocabulary in the ICP JSON. */
export function detectSeniority(titleRaw: string): Seniority {
  const t = normalizeTitle(titleRaw);
  if (/\b(intern|trainee|student|fresher|aspiring|apprentice)\b/.test(t)) return "junior";
  if (/\b(founder|co founder|cofounder|founding partner|proprietor|owner)\b/.test(t)) return "founder";
  if (/vice president/.test(t)) return "vp"; // MUST precede cxo: "vice president" contains "president"
  if (/chief \w+ officer|managing director|managing partner|\bpresident\b/.test(t)) return "cxo";
  if (/\bhead\b/.test(t)) return "head";
  if (/director/.test(t)) return "director";
  if (/general manager|manager|\blead\b/.test(t)) return "manager";
  return "ic";
}
