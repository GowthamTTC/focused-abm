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
];

export function normalizeTitle(raw: string): string {
  let s = raw.toLowerCase();
  s = s.replace(/[|/,&+@()\-–—·•]+/g, " ");
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
  for (const [re, sub] of ABBREV) s = s.replace(re, sub);
  return s.replace(/\s+/g, " ").trim();
}
