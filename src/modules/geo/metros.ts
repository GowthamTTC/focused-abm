/**
 * Conservative metro resolver. Profile location is "where they say they live",
 * never live GPS. We only assign a metro when a phrase is specific enough
 * that a false positive would be rare (San Diego ≠ Bay Area; Tampa Bay ≠ Bay Area).
 */
export interface Metro {
  slug: string;
  label: string;
  country: string;
  /** Already-normalised phrases; longer phrases should be listed first. */
  phrases: string[];
  cities: string[];
  /** Hits that need extra country/context before we trust them. */
  ambiguous: string[];
  anti: string[];
  /** LinkedIn Classic location IDs for Unipile people search, when known. */
  linkedinLocationIds?: number[];
}

export const METROS: Metro[] = [
  {
    slug: "sf-bay-area",
    label: "SF Bay Area",
    country: "United States",
    phrases: [
      "san francisco bay area", "sf bay area", "san francisco bay", "sf bay",
      "silicon valley", "south bay", "east bay", "bay area", "the bay", "to the bay",
    ],
    cities: [
      "san francisco", "oakland", "berkeley", "palo alto", "mountain view",
      "sunnyvale", "cupertino", "santa clara", "fremont", "hayward",
      "redwood city", "menlo park", "san mateo", "walnut creek", "pleasanton",
      "livermore", "milpitas", "campbell", "los gatos", "los altos",
      "emeryville", "alameda", "burlingame", "foster city", "daly city",
      "south san francisco", "san carlos", "belmont", "saratoga",
      "san ramon", "union city", "dublin ca", "concord ca", "mountain view ca",
    ],
    ambiguous: ["sf", "san jose", "san jose ca"],
    anti: [
      "san diego", "tampa bay", "green bay", "hudson bay", "mission bay san diego",
      "costa rica", "san jose costa", "san jose del cabo",
    ],
    linkedinLocationIds: [102277331],
  },
  {
    slug: "los-angeles",
    label: "Los Angeles",
    country: "United States",
    phrases: ["los angeles", "greater los angeles", "la county"],
    cities: ["santa monica", "pasadena", "burbank", "glendale", "long beach", "irvine", "anaheim", "culver city"],
    ambiguous: ["la"],
    anti: ["louisiana", "new orleans"],
  },
  {
    slug: "new-york",
    label: "New York",
    country: "United States",
    phrases: ["new york city", "new york", "greater new york", "nyc metro"],
    cities: ["brooklyn", "manhattan", "queens", "bronx", "jersey city", "hoboken", "stamford"],
    ambiguous: ["nyc", "ny"],
    anti: ["upstate new york"],
  },
  {
    slug: "seattle",
    label: "Seattle",
    country: "United States",
    phrases: ["seattle", "greater seattle"],
    cities: ["bellevue", "redmond", "kirkland", "tacoma"],
    ambiguous: [],
    anti: [],
  },
  {
    slug: "austin",
    label: "Austin",
    country: "United States",
    phrases: ["austin"],
    cities: ["austin tx", "austin texas"],
    ambiguous: [],
    anti: ["austin texas county"],
  },
  {
    slug: "chicago",
    label: "Chicago",
    country: "United States",
    phrases: ["chicago", "greater chicago", "chicagoland"],
    cities: ["evanston"],
    ambiguous: [],
    anti: [],
  },
  {
    slug: "boston",
    label: "Boston",
    country: "United States",
    phrases: ["boston", "greater boston"],
    cities: ["cambridge ma", "somerville", "cambridge massachusetts"],
    ambiguous: ["cambridge"],
    anti: ["cambridge uk", "cambridge england"],
  },
  {
    slug: "washington-dc",
    label: "Washington DC",
    country: "United States",
    phrases: ["washington dc", "washington d c", "district of columbia"],
    cities: ["arlington va", "alexandria va", "bethesda"],
    ambiguous: ["dc", "washington"],
    anti: ["washington state", "seattle"],
  },
  {
    slug: "london",
    label: "London",
    country: "United Kingdom",
    phrases: ["greater london", "london"],
    cities: ["canary wharf", "shoreditch"],
    ambiguous: [],
    anti: ["london ontario", "london ky"],
  },
  {
    slug: "singapore",
    label: "Singapore",
    country: "Singapore",
    phrases: ["singapore"],
    cities: [],
    ambiguous: [],
    anti: [],
  },
  {
    slug: "dubai",
    label: "Dubai",
    country: "United Arab Emirates",
    phrases: ["dubai", "dubai uae"],
    cities: ["abu dhabi"],
    ambiguous: [],
    anti: [],
  },
  {
    slug: "bengaluru",
    label: "Bengaluru",
    country: "India",
    phrases: ["bengaluru", "bangalore", "greater bengaluru", "bengaluru urban"],
    cities: ["whitefield", "koramangala", "indiranagar"],
    ambiguous: [],
    anti: [],
  },
  {
    slug: "mumbai",
    label: "Mumbai",
    country: "India",
    phrases: ["mumbai", "bombay", "navi mumbai", "mumbai metropolitan"],
    cities: ["bandra", "andheri", "powai"],
    ambiguous: [],
    anti: [],
  },
  {
    slug: "delhi-ncr",
    label: "Delhi NCR",
    country: "India",
    phrases: ["new delhi", "delhi ncr", "ncr", "national capital region"],
    cities: ["gurgaon", "gurugram", "noida", "ghaziabad", "faridabad"],
    ambiguous: ["delhi"],
    anti: [],
  },
  {
    slug: "chennai",
    label: "Chennai",
    country: "India",
    phrases: ["chennai", "madras", "greater chennai"],
    cities: [],
    ambiguous: [],
    anti: [],
  },
  {
    slug: "hyderabad",
    label: "Hyderabad",
    country: "India",
    phrases: ["hyderabad", "cyberabad"],
    cities: ["secunderabad"],
    ambiguous: [],
    anti: [],
  },
  {
    slug: "pune",
    label: "Pune",
    country: "India",
    phrases: ["pune"],
    cities: [],
    ambiguous: [],
    anti: [],
  },
  {
    slug: "toronto",
    label: "Toronto",
    country: "Canada",
    phrases: ["toronto", "greater toronto", "gta"],
    cities: ["mississauga", "vaughan"],
    ambiguous: [],
    anti: [],
  },
];

export function metroBySlug(slug: string): Metro | undefined {
  return METROS.find((m) => m.slug === slug);
}

export const US_METROS = METROS.filter((m) => m.country === "United States");

export function isUsMetro(slug: string): boolean {
  return US_METROS.some((m) => m.slug === slug);
}

export function normalizePlace(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function padded(s: string): string {
  return ` ${s} `;
}

function hasPhrase(hay: string, needle: string): boolean {
  if (!needle) return false;
  return padded(hay).includes(padded(needle));
}

function countryFits(metro: Metro, country: string | null): boolean {
  if (!country) return true;
  const c = country.toLowerCase();
  const want = metro.country.toLowerCase();
  if (c === want) return true;
  if (want === "united states" && (c === "usa" || c === "us")) return true;
  if (want === "united kingdom" && (c === "uk" || c === "england")) return true;
  return false;
}

function contextOk(metro: Metro, hay: string, country: string | null): boolean {
  if (metro.slug === "sf-bay-area") {
    return countryFits(metro, country)
      || hasPhrase(hay, "california")
      || hasPhrase(hay, "ca")
      || hasPhrase(hay, "bay")
      || hasPhrase(hay, "francisco");
  }
  if (metro.slug === "new-york") {
    return countryFits(metro, country) || hasPhrase(hay, "city") || hasPhrase(hay, "manhattan");
  }
  if (metro.slug === "washington-dc") {
    return hasPhrase(hay, "dc") || hasPhrase(hay, "district") || hasPhrase(hay, "arlington");
  }
  if (metro.slug === "los-angeles") {
    return countryFits(metro, country) || hasPhrase(hay, "california") || hasPhrase(hay, "ca");
  }
  if (metro.slug === "boston" && hasPhrase(hay, "cambridge")) {
    return hasPhrase(hay, "ma") || hasPhrase(hay, "massachusetts") || countryFits(metro, country);
  }
  return countryFits(metro, country);
}

export interface PlaceHit {
  metro: Metro;
  evidence: "profile" | "headline";
  matched: string;
}

/**
 * Resolve a home metro. Location wins over headline. Country conflict rejects
 * the hit — a Bengaluru profile is not "based in SF" because the headline
 * name-drops the city.
 */
export function resolveHomeMetro(input: {
  location?: string | null;
  headline?: string | null;
  country?: string | null;
}): PlaceHit | null {
  const loc = normalizePlace(input.location ?? "");
  if (loc) {
    const hit = matchHay(loc, input.country ?? null);
    if (hit) return { ...hit, evidence: "profile" };
  }
  const head = normalizePlace(input.headline ?? "");
  if (head) {
    const hit = matchHay(head, input.country ?? null);
    if (hit) return { ...hit, evidence: "headline" };
  }
  return null;
}

function matchHay(hay: string, country: string | null): { metro: Metro; matched: string } | null {
  for (const metro of METROS) {
    if (metro.anti.some((a) => hasPhrase(hay, a))) continue;
    if (country && !countryFits(metro, country) && looksLikeOtherCountry(hay, metro)) continue;

    for (const p of metro.phrases) {
      if (hasPhrase(hay, p)) {
        if (p === "bay area" && metro.anti.some((a) => hasPhrase(hay, a))) continue;
        if (country && !countryFits(metro, country) && isCountryNamed(hay) && !hasPhrase(hay, normalizePlace(metro.country))) {
          continue;
        }
        return { metro, matched: p };
      }
    }
    for (const c of metro.cities) {
      if (hasPhrase(hay, c)) return { metro, matched: c };
    }
    for (const a of metro.ambiguous) {
      if (!hasPhrase(hay, a)) continue;
      if (!contextOk(metro, hay, country)) continue;
      if (a === "san jose" && hasPhrase(hay, "costa")) continue;
      return { metro, matched: a };
    }
  }
  return null;
}

function isCountryNamed(hay: string): boolean {
  return /\b(india|united states|usa|united kingdom|uk|singapore|uae|canada|germany|france|australia|costa rica)\b/.test(hay);
}

function looksLikeOtherCountry(hay: string, metro: Metro): boolean {
  const named = hay.match(/\b(india|united states|usa|united kingdom|uk|singapore|united arab emirates|uae|canada|costa rica)\b/);
  if (!named) return false;
  return !countryFits(metro, named[1]);
}

export function stampMetro(input: {
  location?: string | null;
  headline?: string | null;
  country?: string | null;
}): { metro: string | null; metroEvidence: "profile" | "headline" | null } {
  const hit = resolveHomeMetro(input);
  return {
    metro: hit?.metro.slug ?? null,
    metroEvidence: hit?.evidence ?? null,
  };
}
