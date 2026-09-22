/**
 * Trigger vocabulary — the phrases that mean "this account needs what we sell".
 *
 * Every workspace sells something different, so the words that matter are
 * different too. A leadership-development firm cares that an account is running
 * a national sales meeting; a data consultancy does not. The vocabulary is
 * therefore per workspace, editable, and it does two jobs: it tells the scanner
 * what to search for, and it scores what came back.
 *
 * WHY NOT JUST LOOK FOR TROUBLE. The obvious hunt is distress — restructuring,
 * layoffs. On this account fifteen searches for it found nothing, while
 * "speaker training" returned eighteen posts out of nineteen. Distress is rare,
 * visible to everyone, and late. A buying moment is none of those things.
 */

export interface TriggerSignal {
  /** What the scanner searches for and the matcher looks for in a post. */
  phrase: string;
  /** What it means, in the words a seller would use. */
  label: string;
  /** 1–5. How strongly this phrase indicates a need for what we sell. */
  weight: number;
}

/** A leadership-and-communication seller's vocabulary, ordered by weight.
 *  Measured on a real account rather than guessed: the yield of each phrase is
 *  in the comment, kept/returned, from a past-month scan of Allergan
 *  Aesthetics. Phrases that found nothing are still here — a trigger that is
 *  quiet this month is not a trigger that is wrong. */
export const DEFAULT_TRIGGERS: TriggerSignal[] = [
  { phrase: "speaker training", label: "Speaker training programme", weight: 5 },        // 18/19
  { phrase: "national sales meeting", label: "National sales meeting", weight: 5 },      // 9/10
  { phrase: "sales kickoff", label: "Sales kickoff", weight: 5 },                        // 0/0
  { phrase: "town hall", label: "Town hall / all-hands", weight: 4 },                    // 1/1
  { phrase: "leadership development", label: "Leadership development", weight: 4 },      // 7/35
  { phrase: "high potential", label: "High-potential programme", weight: 4 },            // 8/38
  { phrase: "succession", label: "Succession planning", weight: 4 },
  { phrase: "bootcamp", label: "New-hire bootcamp", weight: 3 },                         // 1/1
  { phrase: "onboarding", label: "Onboarding wave", weight: 3 },                         // 1/1
  { phrase: "coaching", label: "Coaching", weight: 3 },                                  // 2/3
  { phrase: "employee engagement", label: "Employee engagement", weight: 3 },            // 2/5
  { phrase: "women in leadership", label: "Women in leadership / ERG", weight: 3 },      // 3/12
  { phrase: "sales conference", label: "Sales conference", weight: 3 },
  { phrase: "offsite", label: "Leadership offsite", weight: 2 },
  { phrase: "launch readiness", label: "Launch readiness", weight: 2 },                  // 0/0
];

export interface TriggerHit {
  trigger: TriggerSignal;
  /** Posts this phrase appears in. */
  hits: number;
  lastSeenAt: Date | null;
  /** Weight after age decay, summed across hits — the trigger's contribution. */
  points: number;
  /** One post, so the reader can go and check rather than take the count. */
  example: { title: string | null; url: string | null; line: string | null } | null;
}

export interface TriggerScore {
  /** Sum of the hits' decayed weights. Deliberately NOT normalised to 100:
   *  there is no defensible ceiling, and a number out of 100 implies one. */
  points: number;
  fired: TriggerHit[];
  quiet: TriggerSignal[];
}

const DAY = 86400000;
const WINDOW = 90;

/** Full weight inside a month, tapering to a third at ninety days. A programme
 *  announced last week is a live opportunity; the same words a quarter ago are
 *  context. Never zero inside the window — it happened. */
export function recencyFactor(at: Date | null, now = Date.now()): number {
  if (!at) return 0.3;
  const age = (now - at.getTime()) / DAY;
  if (age <= 30) return 1;
  if (age >= WINDOW) return 0.3;
  return 1 - ((age - 30) / (WINDOW - 30)) * 0.7;
}

function norm(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

export interface ScorableSignal {
  title: string | null;
  body: string | null;
  evidence: string | null;
  url: string | null;
  publishedAt: Date | null;
  /** True when the post is by someone who works at the account, or by the
   *  company's own page. Only these can score — see below. */
  inside: boolean;
}

export function scoreTriggers(
  signals: ScorableSignal[],
  vocab: TriggerSignal[] = DEFAULT_TRIGGERS,
  now = Date.now(),
): TriggerScore {
  const fired: TriggerHit[] = [];
  const quiet: TriggerSignal[] = [];

  for (const t of vocab) {
    const needle = norm(t.phrase).trim();
    if (!needle) continue;
    let hits = 0, points = 0;
    let lastSeenAt: Date | null = null;
    let example: TriggerHit["example"] = null;

    for (const s of signals) {
      // A BUYING SIGNAL HAS TO COME FROM THE ACCOUNT.
      //
      // Scoring every post that contains the phrase put twenty points on this
      // account for "high potential" — matched inside a market-research bot's
      // "Top Companies in Breast Implant Tissue Expander Market" — and gave
      // further points to a COMPETITOR's event marketing, which is evidence
      // that somebody else is already selling rather than that this account is
      // looking. Neither is the account saying anything.
      if (!s.inside) continue;
      // Title as well as body: a person's headline is where "Leadership
      // Development" most often appears, and a post by that person is exactly
      // the one a seller wants to see.
      const hay = norm(`${s.title ?? ""} ${s.body ?? ""}`);
      if (!hay.includes(` ${needle} `)) continue;
      hits += 1;
      points += t.weight * recencyFactor(s.publishedAt, now);
      if (!lastSeenAt || (s.publishedAt && s.publishedAt > lastSeenAt)) {
        lastSeenAt = s.publishedAt ?? lastSeenAt;
        example = { title: s.title, url: s.url, line: s.evidence ?? (s.body ?? "").slice(0, 180) };
      }
    }

    if (hits === 0) quiet.push(t);
    else fired.push({ trigger: t, hits, lastSeenAt, points: Math.round(points * 10) / 10, example });
  }

  fired.sort((a, b) => b.points - a.points || b.hits - a.hits);
  return {
    points: Math.round(fired.reduce((a, b) => a + b.points, 0)),
    fired,
    quiet,
  };
}
