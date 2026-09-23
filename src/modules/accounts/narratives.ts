/**
 * Narratives — what the signals keep saying when you stop reading them one at
 * a time.
 *
 * A signal is one observation. A narrative is the same thing observed from
 * more than one direction: a sales meeting, a speaker summit and an education
 * function are three posts and one story. The point of the layer is that a
 * seller should not have to read a hundred and fifty posts to find four
 * repeated themes, and that every theme keeps the evidence that made it so it
 * can be disbelieved.
 *
 * Definitions are declarative and few on purpose. Three to five durable
 * narratives beat twenty that change every scan.
 */
import type { TriggerHit } from "@/modules/accounts/trigger-vocab";

export interface NarrativeDef {
  key: string;
  /** What is happening, as a sentence a seller could repeat out loud. */
  title: string;
  /** Why it is commercially interesting — the bridge to an offer. */
  relevance: string;
  /** Trigger phrases whose firing counts as evidence for this narrative. */
  phrases: string[];
  /** Words in a press title or body that also count as evidence. */
  pressWords: RegExp;
  /** The offer this narrative most credibly opens. */
  offer: string;
}

export const NARRATIVES: NarrativeDef[] = [
  {
    key: "field-enablement",
    title: "Field enablement is active",
    relevance: "Communication, presentation and storytelling — the people in those rooms are judged on how they land, not on what they know.",
    phrases: ["national sales meeting", "sales kickoff", "sales conference", "speaker training", "bootcamp", "launch readiness"],
    pressWords: /\b(national sales meeting|sales kickoff|speaker training|field training|bootcamp)\b/i,
    offer: "communicating-with-storytelling",
  },
  {
    key: "absorbing-change",
    title: "The organisation is still absorbing change",
    relevance: "Leadership alignment and manager communication. A reorganisation is announced once and explained for a year.",
    phrases: ["restructuring", "reorganization", "layoffs", "new president", "town hall", "succession"],
    pressWords: /\b(reorganization|reorganisation|restructur|layoff|warn notice|new president|appointed)\b/i,
    offer: "leadership-communication-development-ingo",
  },
  {
    key: "customer-reset",
    title: "Customer communication is being reset",
    relevance: "Customer-facing messaging and change communication — the field has to re-explain something the customer already found confusing.",
    phrases: ["loyalty program"],
    pressWords: /\b(loyalty program|partner privileges|rebate|pricing|programme relaunch)\b/i,
    offer: "communicating-with-storytelling",
  },
  {
    key: "medical-education",
    title: "Medical education is strategically important",
    relevance: "Faculty communication and learning effectiveness. The faculty carry the message further than the field does.",
    phrases: ["speaker training", "coaching", "onboarding", "leadership development", "high potential"],
    pressWords: /\b(allergan medical institute|\bAMI\b|faculty|curricula|medical education)\b/i,
    offer: "team-organizational-development",
  },
];

export interface NarrativeEvidence {
  kind: "signal" | "press";
  label: string;
  detail: string;
  /** Posts behind it, for a signal. 1 for a press item. */
  hits: number;
  at: Date | null;
  url: string | null;
}

export interface Narrative extends NarrativeDef {
  evidence: NarrativeEvidence[];
  /** Independent sources behind it — the number that makes it a narrative
   *  rather than a post. */
  strands: number;
  newest: Date | null;
}

export function buildNarratives(
  fired: TriggerHit[],
  press: { title: string | null; body: string | null; url: string | null; publishedAt: Date | null; kind: string }[],
): Narrative[] {
  const out: Narrative[] = [];
  for (const def of NARRATIVES) {
    const evidence: NarrativeEvidence[] = [];

    for (const hit of fired) {
      if (!def.phrases.includes(hit.trigger.phrase)) continue;
      evidence.push({
        kind: "signal",
        label: hit.trigger.label,
        detail: `${hit.hits} post${hit.hits === 1 ? "" : "s"} · ${Math.round(hit.points)} pts`,
        hits: hit.hits,
        at: hit.lastSeenAt,
        url: hit.example?.url ?? null,
      });
    }

    for (const p of press) {
      if (!def.pressWords.test(`${p.title ?? ""} ${p.body ?? ""}`)) continue;
      evidence.push({
        kind: "press",
        label: p.title ?? "(untitled)",
        detail: p.kind === "filing" ? "filing" : "on the record",
        hits: 1,
        at: p.publishedAt,
        url: p.url,
      });
    }

    if (evidence.length === 0) continue;
    const dates = evidence.map((e) => e.at?.getTime() ?? 0).filter(Boolean);
    out.push({
      ...def,
      evidence: evidence.slice(0, 6),
      strands: evidence.length,
      newest: dates.length ? new Date(Math.max(...dates)) : null,
    });
  }
  // Most independent evidence first: convergence is the thing being measured.
  return out.sort((a, b) => b.strands - a.strands);
}
