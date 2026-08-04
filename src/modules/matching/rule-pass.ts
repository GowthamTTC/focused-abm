import type { IcpJson } from "@/db/schema";
import { normalizeTitle } from "./normalize";

export interface RuleHit { serviceSlug: string; personaSlug: string; pattern: string }
export interface RuleExclusion { serviceSlug: string; pattern: string }

/**
 * Free pass across ALL selected services' persona patterns.
 * A hit in exactly one service → confident rule assignment (skip the LLM).
 * Hits in 2+ services → ambiguous → fall through to the LLM.
 */
export function rulePass(
  titleRaw: string,
  services: { slug: string; icp: IcpJson }[],
): { hit: RuleHit | null; ambiguous: boolean; excluded: RuleExclusion | null } {
  const title = normalizeTitle(titleRaw);
  if (!title) return { hit: null, ambiguous: false, excluded: null };

  const hits: RuleHit[] = [];
  for (const s of services) {
    for (const p of s.icp.personas) {
      for (const pat of p.title_exclude) {
        if (pat && title.includes(normalizeTitle(pat))) {
          return { hit: null, ambiguous: false, excluded: { serviceSlug: s.slug, pattern: pat } };
        }
      }
      for (const pat of p.title_include) {
        if (pat && title.includes(normalizeTitle(pat))) {
          hits.push({ serviceSlug: s.slug, personaSlug: p.slug, pattern: pat });
          break; // one hit per persona is enough
        }
      }
    }
  }
  const distinctServices = new Set(hits.map((h) => h.serviceSlug));
  if (distinctServices.size === 1) return { hit: hits[0], ambiguous: false, excluded: null };
  return { hit: null, ambiguous: distinctServices.size > 1, excluded: null };
}
