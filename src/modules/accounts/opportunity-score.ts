/**
 * Opportunity strength — a number whose parts are visible.
 *
 * Post sentiment cannot be acted on: "+30" does not tell an account director
 * whether to call. This asks the five questions that do — how many independent
 * things say the same, how recent they are, whether the people are identifiable,
 * whether we credibly sell the answer, and how authoritative the evidence is —
 * and shows each part beside the total.
 *
 * It is a prioritisation aid, not a probability. Nothing here has been
 * calibrated against won business, and until it has, the explanation is worth
 * more than the score.
 */
export interface ScoreComponent {
  label: string;
  /** Out of the component's own weight. */
  earned: number;
  weight: number;
  band: "Strong" | "Medium" | "Weak";
  why: string;
}

export interface OpportunityScore {
  total: number;
  components: ScoreComponent[];
}

const bandOf = (ratio: number): ScoreComponent["band"] =>
  ratio >= 0.7 ? "Strong" : ratio >= 0.4 ? "Medium" : "Weak";

function component(label: string, weight: number, ratio: number, why: string): ScoreComponent {
  const r = Math.max(0, Math.min(1, ratio));
  return { label, weight, earned: Math.round(r * weight), band: bandOf(r), why };
}

export function scoreOpportunity(input: {
  /** Independent signals and press items behind it. */
  strands: number;
  /** Newest piece of evidence. */
  newest: Date | null;
  /** ICP people the offer fits. */
  people: number;
  /** True when the offer is a slug from the workspace's own catalogue. */
  inCatalogue: boolean;
  /** Evidence that is a filing or named press rather than a post. */
  authoritative: number;
  now?: number;
}): OpportunityScore {
  const now = input.now ?? Date.now();
  const ageDays = input.newest ? (now - input.newest.getTime()) / 86400000 : 365;

  const components = [
    component("Signal convergence", 30, input.strands / 4,
      `${input.strands} independent ${input.strands === 1 ? "source says" : "sources say"} the same thing`),
    component("Freshness", 20, ageDays <= 30 ? 1 : ageDays >= 180 ? 0.15 : 1 - (ageDays - 30) / 180,
      input.newest ? `newest evidence is ${Math.round(ageDays)} days old` : "no dated evidence"),
    component("Persona coverage", 20, input.people / 8,
      `${input.people} ICP ${input.people === 1 ? "person" : "people"} identified`),
    component("Solution alignment", 15, input.inCatalogue ? 1 : 0.35,
      input.inCatalogue ? "maps to a live offer in the catalogue" : "no catalogue offer maps cleanly"),
    component("Evidence quality", 15, input.authoritative > 0 ? Math.min(1, 0.55 + input.authoritative * 0.22) : 0.35,
      input.authoritative > 0
        ? `${input.authoritative} filing or named source, not only posts`
        : "posts only — nothing filed or published"),
  ];

  return {
    total: components.reduce((t, c) => t + c.earned, 0),
    components,
  };
}
