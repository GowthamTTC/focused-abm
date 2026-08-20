/** Country scope for 2nd/3rd event search. LinkedIn Classic location IDs. */
export interface RadarCountry {
  slug: string;
  label: string;
  /** Matches connection.country after toCountry(). */
  country: string;
  linkedinLocationIds: number[];
}

export const RADAR_COUNTRIES: RadarCountry[] = [
  {
    slug: "united-states",
    label: "United States",
    country: "United States",
    linkedinLocationIds: [103644278],
  },
  {
    slug: "india",
    label: "India",
    country: "India",
    linkedinLocationIds: [102713980],
  },
];

export function countryBySlug(slug: string | null | undefined): RadarCountry | undefined {
  if (!slug) return undefined;
  return RADAR_COUNTRIES.find((c) => c.slug === slug);
}
