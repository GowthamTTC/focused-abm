import type { IcpJson } from "@/db/schema";
import { detectSeniority, normalizeTitle, type Seniority } from "./normalize";

export interface RuleHit { serviceSlug: string; personaSlug: string; pattern: string; seniority: Seniority }
export interface RuleExclusion { serviceSlug: string; pattern: string }

/**
 * Pre-signals mined from the TTC Batch-1 ground truth. These run BEFORE persona
 * title matching because titles alone lie: a "Founder" at an agency is a PEER,
 * not a Marketeroid target — the company name is the tell (ground truth: 114
 * peers, overwhelmingly founder-titled people at digital/media/studio shops).
 * Off-ICP is title-driven: 59 of 85 were coaches/mentors/facilitators.
 */
export const PEER_COMPANY_SIGNALS = [
  "agency", "agencies", "studio", "advertis", "branding", "creative",
  "design", "media", "digital marketing", "marketing", "productions",
  "films", "adtech", "event management",
];

export const OFF_ICP_TITLE_SIGNALS = [
  "coach", "mentor", "facilitator", "personal brand", "brand therapist",
  "motivational", "therapist", "astrolog", "numerolog", "tarot",
  "spiritual", "yoga",
];

/** Company-name peer signal, e.g. "Radeecal Communications" founder = peer not buyer. */
export function companyPeerSignal(companyRaw: string): string | null {
  const co = normalizeTitle(companyRaw);
  if (!co) return null;
  for (const sig of PEER_COMPANY_SIGNALS) if (co.includes(sig)) return sig;
  return null;
}

/** Title-based off-ICP signal (coaches, personal-brand, spiritual services). */
export function offIcpTitleSignal(titleRaw: string): string | null {
  const t = normalizeTitle(titleRaw);
  if (!t) return null;
  for (const sig of OFF_ICP_TITLE_SIGNALS) if (t.includes(sig)) return sig;
  return null;
}

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
  const seniority = detectSeniority(titleRaw);

  const hits: RuleHit[] = [];
  for (const s of services) {
    for (const p of s.icp.personas) {
      // Seniority gate: a persona with a non-empty seniority list only
      // rule-matches titles inside that band; everything else goes to the
      // model for judgment instead of a blind pattern hit.
      if (p.seniority && p.seniority.length > 0 && !p.seniority.includes(seniority)) continue;
      for (const pat of p.title_exclude) {
        if (pat && title.includes(normalizeTitle(pat))) {
          return { hit: null, ambiguous: false, excluded: { serviceSlug: s.slug, pattern: pat } };
        }
      }
      for (const pat of p.title_include) {
        if (pat && title.includes(normalizeTitle(pat))) {
          hits.push({ serviceSlug: s.slug, personaSlug: p.slug, pattern: pat, seniority });
          break; // one hit per persona is enough
        }
      }
    }
  }
  const distinctServices = new Set(hits.map((h) => h.serviceSlug));
  if (distinctServices.size === 1) return { hit: hits[0], ambiguous: false, excluded: null };
  return { hit: null, ambiguous: distinctServices.size > 1, excluded: null };
}
