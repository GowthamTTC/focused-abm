/** Parse LinkedIn-style locations; keep country dropdown clean. */

const NOT_COUNTRY = /\b(area|metro|metroplex|region|county|district|province|state)\b/i;

export function parseCountryFromLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  if (!isLikelyCountry(last)) return null;
  return last;
}

/** Prefer stored country when clean; else location tail. */
export function resolveCountry(
  country: string | null | undefined,
  location: string | null | undefined,
): string | null {
  const c = (country ?? "").trim();
  if (c && isLikelyCountry(c)) return c;
  return parseCountryFromLocation(location);
}

export function isLikelyCountry(value: string): boolean {
  const v = value.trim();
  if (!v || v.length < 2) return false;
  if (NOT_COUNTRY.test(v)) return false;
  if (/\d/.test(v)) return false;
  return true;
}
