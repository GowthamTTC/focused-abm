/**
 * Whose voice is this?
 *
 * A company-keyed LinkedIn search returns two conversations wearing the same
 * hashtag, and averaging them produces a number that describes neither. For
 * Allergan Aesthetics the market half (dermatologists, med-spa operators)
 * talked about product launches and was loudly positive; the half that matters
 * to a leadership-development seller — people who actually work there, moving
 * roles and teams — sat underneath it barely moving the mean.
 *
 * So voice is separated before tone is taken, and the author's own headline is
 * the evidence. It is what LinkedIn already made them write about themselves,
 * and it is stored on every row, so this costs nothing and needs no re-scan.
 *
 * Derived at read time rather than frozen at scan time on purpose: the company
 * a row belongs to can be renamed or given a parent later, and every row should
 * then re-answer the question rather than keep an old answer.
 */

export type Voice = "employee" | "company" | "market";

export const VOICE_LABEL: Record<Voice, string> = {
  employee: "Inside",
  company: "Company",
  market: "Market",
};

export const VOICE_BLURB: Record<Voice, string> = {
  employee: "people whose own headline says they work there",
  company: "the brand's own pages",
  market: "practitioners, customers, press — everyone else",
};

/** The separator scan.ts writes between a person's name and their headline. */
const SEP = " — ";

function norm(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * Names that mean "this company" in a headline.
 *
 * ONLY the first word of a multi-word name is added, because that is the
 * distinctive one: people shorten "Allergan Aesthetics" to "Allergan", never to
 * "Aesthetics". Taking every token instead made the category word an alias, and
 * "Aesthetics" then matched every clinic and conference in the industry — which
 * files complete strangers as staff. A false positive here is far worse than a
 * miss: the Inside list is read as "these people work there".
 *
 * Words shorter than five characters are dropped for the same reason; the whole
 * name is always kept, so a short name still matches in full.
 */
export function companyAliases(companyName: string, extra: string[] = []): string[] {
  const out = new Set<string>();
  const whole = norm(companyName).trim();
  if (whole.length >= 4) out.add(whole);
  const head = whole.split(/\s+/)[0] ?? "";
  if (head.length >= 5) out.add(head);
  for (const e of extra) {
    const n = norm(e).trim();
    if (n.length >= 4) out.add(n);
  }
  return [...out];
}

function namesCompany(text: string, aliases: string[]): boolean {
  const hay = norm(text);
  return aliases.some((a) => hay.includes(` ${a} `));
}

/**
 * `authorLine` is account_signal.title as scan.ts wrote it: either
 * "Name — headline" for a person, or a bare page name for a company.
 */
export function voiceOf(
  authorLine: string | null,
  companyName: string,
  extraAliases: string[] = [],
): Voice {
  const line = (authorLine ?? "").trim();
  if (!line) return "market";
  const aliases = companyAliases(companyName, extraAliases);

  const at = line.indexOf(SEP);
  if (at < 0) {
    // No headline at all. Company pages arrive this way, and a page whose own
    // name is the company is the company talking. A bare personal name with no
    // headline tells us nothing, so it stays market rather than being guessed
    // into the staff list.
    return namesCompany(line, aliases) ? "company" : "market";
  }

  const headline = line.slice(at + SEP.length);
  return namesCompany(headline, aliases) ? "employee" : "market";
}
