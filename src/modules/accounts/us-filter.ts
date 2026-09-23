/**
 * "Only US posts" — decided from what the post itself carries.
 *
 * LinkedIn's post search returns no author location, so there is no country
 * field to filter on. Two things ARE available and are honest about what they
 * mean: the page's own name, and the language it wrote in.
 *
 * Global companies run a LinkedIn page per market and name them plainly —
 * "AbbVie | Canada", "AbbVie | Australia". Naming a country other than the US
 * is the page saying which market it speaks for. And a post written in French
 * is not addressed to a US audience whichever page carried it.
 *
 * This EXCLUDES what it can show is elsewhere rather than including what it
 * can prove is American: the parent page posts for the US without saying so,
 * and a rule that demanded proof of US-ness would drop it.
 */

/** Country and region words that appear in localised page names. US spellings
 *  are absent on purpose — this list only ever removes. */
const ELSEWHERE = [
  "canada", "australia", "new zealand", "united kingdom", "uk", "ireland",
  "france", "deutschland", "germany", "espana", "españa", "spain", "italia",
  "italy", "nederland", "netherlands", "belgique", "belgium", "brasil",
  "brazil", "mexico", "méxico", "india", "japan", "korea", "china", "taiwan",
  "singapore", "malaysia", "indonesia", "philippines", "thailand", "vietnam",
  "saudi", "uae", "emirates", "qatar", "egypt", "israel", "turkiye", "turkey",
  "polska", "poland", "sverige", "sweden", "norge", "norway", "danmark",
  "denmark", "suomi", "finland", "portugal", "greece", "austria", "schweiz",
  "switzerland", "south africa", "nigeria", "kenya", "argentina", "chile",
  "colombia", "peru", "emea", "apac", "latam", "benelux", "nordics", "uk&i",
];

/** Function words that are common in one language and rare in English. A post
 *  is judged foreign only when several appear, so an English post quoting a
 *  French product name is not thrown away. */
const FOREIGN_WORDS = [
  "les", "des", "dans", "pour", "nous", "vous", "avec", "cette", "aux", "réservé",
  "para", "como", "esta", "nuestro", "con", "por",
  "und", "für", "mit", "eine", "wir", "der", "die", "das",
  "che", "della", "nostro", "con",
  "não", "mais", "uma",
];

function norm(s: string): string {
  return ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

/** The page speaks for a market that is not the US. */
export function pageIsElsewhere(pageName: string | null | undefined): boolean {
  const hay = norm(pageName ?? "");
  return ELSEWHERE.some((c) => hay.includes(` ${c} `));
}

/** The post is written in a language other than English. */
export function postIsForeignLanguage(body: string | null | undefined): boolean {
  const text = (body ?? "").slice(0, 600);
  if (text.trim().length < 40) return false;
  const hay = norm(text);
  const hits = FOREIGN_WORDS.filter((w) => hay.includes(` ${w} `)).length;
  // Three distinct markers, not one: "des" alone appears in English text
  // quoting a brand, and dropping a US post over one word is the expensive
  // mistake here.
  return hits >= 3;
}

export function isUsPost(pageName: string | null | undefined, body: string | null | undefined): boolean {
  return !pageIsElsewhere(pageName) && !postIsForeignLanguage(body);
}
