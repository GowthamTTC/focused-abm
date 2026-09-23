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
  /** Why this is an opening, in the seller's own terms. Written once against
   *  the phrase rather than generated per post: the reason a national sales
   *  meeting is an opportunity is the same reason every time, and a model
   *  asked to explain each post afresh writes something plausible and
   *  different each time, which is how a panel stops being believed. */
  why?: string;
}

/** A leadership-and-communication seller's vocabulary, ordered by weight.
 *  Measured on a real account rather than guessed: the yield of each phrase is
 *  in the comment, kept/returned, from a past-month scan of Allergan
 *  Aesthetics. Phrases that found nothing are still here — a trigger that is
 *  quiet this month is not a trigger that is wrong. */
export const DEFAULT_TRIGGERS: TriggerSignal[] = [
  { phrase: "speaker training", label: "Speaker training programme", weight: 5, why: "They already train faculty to present, so the principle is conceded and the budget exists. The content is theirs; presence, structure and landing a room are a separate skill and a separate line." },        // 18/19
  { phrase: "national sales meeting", label: "National sales meeting", weight: 5, why: "The year's largest presentation moment. Message landing, manager readiness and speaker coaching are bought in the months before it, not after." },      // 9/10
  { phrase: "sales kickoff", label: "Sales kickoff", weight: 5, why: "A kickoff sets the year's story. Whoever owns it is buying help to make it land before the date, not after." },                        // 0/0
  { phrase: "town hall", label: "Town hall / all-hands", weight: 4, why: "Town halls are where leaders are judged on delivery rather than content. Internal communications owns the moment and usually the budget." },                    // 1/1
  { phrase: "leadership development", label: "Leadership development", weight: 4, why: "The category named openly. Someone owns a programme, a budget line and a calendar — the conversation starts at comparison, not education." },      // 7/35
  { phrase: "high potential", label: "High-potential programme", weight: 4, why: "A HiPo cohort is a defined audience, a named sponsor in talent, and a programme that recurs annually." },            // 8/38
  { phrase: "succession", label: "Succession planning", weight: 4, why: "Succession work names a bench. Naming it creates the obligation to develop it, which is the part that gets outsourced." },
  { phrase: "bootcamp", label: "New-hire bootcamp", weight: 3, why: "A new-hire bootcamp needs people who can teach and managers who can coach — both buyable, and both usually thin when hiring is fast." },                         // 1/1
  { phrase: "onboarding", label: "Onboarding wave", weight: 3, why: "An onboarding wave means managers absorbing new people at once. First-time-manager capability is the thing that breaks first." },                         // 1/1
  { phrase: "coaching", label: "Coaching", weight: 3, why: "Said out loud, coaching is already an accepted category here. The question is who provides it, not whether it is needed." },                                  // 2/3
  { phrase: "employee engagement", label: "Employee engagement", weight: 3, why: "Engagement programmes route to leader communication within a quarter — that is where the spend lands." },            // 2/5
  { phrase: "women in leadership", label: "Women in leadership / ERG", weight: 3, why: "ERG and development programmes carry a standing budget and a named executive sponsor, which is a short path to a buyer." },      // 3/12
  { phrase: "sales conference", label: "Sales conference", weight: 3, why: "A field conference is a presentation moment with a deadline. Preparation is bought; the date does not move." },
  { phrase: "offsite", label: "Leadership offsite", weight: 2, why: "Leadership offsites are designed and facilitated by somebody. That somebody is often external and chosen weeks ahead." },
  { phrase: "launch readiness", label: "Launch readiness", weight: 2, why: "A launch means field teams learning a new story fast and telling it consistently. That is training work with a fixed date." },                  // 0/0
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

/** Which of the vocabulary's phrases appear in one piece of text.
 *
 *  The score says an account is interesting; this says WHY THIS POST is. A
 *  reader scanning a feed should not have to hold the vocabulary in their head
 *  to see that "the 2026 AMI Speaker Training Summit" is the thing they sell. */
export function triggersIn(
  text: string,
  vocab: TriggerSignal[] = DEFAULT_TRIGGERS,
): TriggerSignal[] {
  const hay = norm(text);
  return vocab.filter((t) => {
    const needle = norm(t.phrase).trim();
    return needle.length >= 2 && hay.includes(` ${needle} `);
  });
}
