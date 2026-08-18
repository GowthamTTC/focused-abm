/** LinkedIn locations are free text ("Chennai, Tamil Nadu, India", "Greater
 *  London Area, United Kingdom"). The last comma segment is the country in
 *  most cases; this normalises the common aliases so grouping is stable. */
const ALIAS: Record<string, string> = {
  "usa": "United States", "us": "United States", "u.s.": "United States",
  "u.s.a.": "United States", "united states of america": "United States",
  "uk": "United Kingdom", "u.k.": "United Kingdom", "great britain": "United Kingdom",
  "england": "United Kingdom", "scotland": "United Kingdom", "wales": "United Kingdom",
  "uae": "United Arab Emirates", "ksa": "Saudi Arabia", "bharat": "India",
  "the netherlands": "Netherlands", "holland": "Netherlands",
  "republic of india": "India", "republic of singapore": "Singapore",
};

export function toCountry(location: string | null | undefined): string | null {
  if (!location) return null;
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  // "Greater Chennai Area" style strings name no country — better null than a lie.
  if (parts.length === 1 && /\b(area|region|metropolitan|greater)\b/i.test(last)) return null;
  const key = last.toLowerCase().replace(/\.$/, "");
  return ALIAS[key] ?? last;
}
