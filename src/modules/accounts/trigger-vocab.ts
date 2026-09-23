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
  /** The offer this opens, as a slug from the workspace's own catalogue. Null
   *  when the signal is real but nothing in the catalogue credibly opens on it
   *  — a respectable answer, and better than routing everything to whatever is
   *  nearest. */
  offer?: string | null;
}

/** A leadership-and-communication seller's vocabulary, ordered by weight.
 *  Measured on a real account rather than guessed: the yield of each phrase is
 *  in the comment, kept/returned, from a past-month scan of Allergan
 *  Aesthetics. Phrases that found nothing are still here — a trigger that is
 *  quiet this month is not a trigger that is wrong. */
export const DEFAULT_TRIGGERS: TriggerSignal[] = [
  {
    phrase: "restructuring", label: "Restructuring", weight: 5,
    offer: "leadership-communication-development-ingo",
    why: "A reorganisation is announced once and lived with for a year. The people who stay need their leaders to explain it credibly and repeatedly, and that is the work — not the announcement, the eighteen months after it.",
  },
  {
    phrase: "reorganization", label: "Reorganisation", weight: 5,
    offer: "team-organizational-development",
    why: "Teams reassembled under new leaders have to rebuild trust before they perform. That is the gap between a new structure on a chart and a team that works.",
  },
  {
    phrase: "layoffs", label: "Layoffs", weight: 4,
    offer: "leadership-communication-development-ingo",
    why: "Survivors watch how it was handled and decide what the company is. Managers carrying that conversation are usually doing it for the first time.",
  },
  {
    phrase: "loyalty program", label: "Customer programme relaunch", weight: 4,
    offer: "communicating-with-storytelling",
    why: "The field has to go back to customers who called the last version too complex and ask for a second hearing. That is credibility work, not a features conversation — product training teaches the tiers, and nobody teaches a rep how to say \"we got that wrong\". Managers cascade it to teams a year after a reorganisation, which is low-trust communication by definition, and faculty carry it to practices faster than reps do. Treat it as proof that now is the moment rather than as the pitch itself: the opening is the faculty and the managers, not the rebate.",
  },
  {
    phrase: "new president", label: "New unit leader", weight: 5,
    offer: "leadership-communication-development-ingo",
    why: "A leader arriving over an existing team spends the first year explaining a direction nobody there chose. What that costs is decided in how it is said, not in the strategy deck.",
  },
  {
    phrase: "speaker training", label: "Speaker training programme", weight: 5,
    offer: "communicating-with-storytelling",
    why: "They already put faculty in front of rooms, so the principle is settled. The science is theirs; what earns attention is presence and a story that lands. That layer sits beside the content they own.",
  },
  {
    phrase: "national sales meeting", label: "National sales meeting", weight: 5,
    offer: "communicating-with-storytelling",
    why: "The room that sets the year. Leaders rehearse content and neglect connection — the work is in the weeks before, so the message is felt and not just heard.",
  },
  {
    phrase: "sales kickoff", label: "Sales kickoff", weight: 5,
    offer: "communicating-with-storytelling",
    why: "A kickoff is a performance with a fixed date. Preparing leaders to land it — presence, story, the first ninety seconds — is bought ahead of the day.",
  },
  {
    phrase: "town hall", label: "Town hall / all-hands", weight: 4,
    offer: "leadership-communication-development-ingo",
    why: "Town halls are where leaders are believed, or are not. Presence under scrutiny is learnable, and internal communications owns both the moment and the budget.",
  },
  {
    phrase: "leadership development", label: "Leadership development", weight: 4,
    offer: "leadership-communication-development-ingo",
    why: "Our category, named by them. Someone already owns a programme and a calendar, so the conversation starts at fit rather than at why this matters.",
  },
  {
    phrase: "high potential", label: "High-potential programme", weight: 4,
    offer: "high-potential-succession-programs",
    why: "A defined cohort with a sponsor in talent, being readied to lead. Presence is usually the thing they are closest to missing.",
  },
  {
    phrase: "succession", label: "Succession planning", weight: 4,
    offer: "high-potential-succession-programs",
    why: "Naming a bench creates the duty to develop it. Successors are chosen on capability and then judged on how they carry a room.",
  },
  {
    phrase: "bootcamp", label: "New-hire bootcamp", weight: 3,
    offer: "team-organizational-development",
    why: "People arriving together need managers who can teach and coach. That capability is thin wherever hiring is fast.",
  },
  {
    phrase: "onboarding", label: "Onboarding wave", weight: 3,
    offer: "team-organizational-development",
    why: "An onboarding wave lands on managers first. First-time leaders learning to listen and connect is where it strains.",
  },
  {
    phrase: "coaching", label: "Coaching", weight: 3,
    offer: "executive-coaching",
    why: "Said out loud, coaching is already accepted here. The open question is who they trust to do it.",
  },
  {
    phrase: "employee engagement", label: "Employee engagement", weight: 3,
    offer: "leadership-communication-development-ingo",
    why: "Engagement is a leadership-communication problem in a survey's clothing. The spend follows within a quarter.",
  },
  {
    phrase: "women in leadership", label: "Women in leadership / ERG", weight: 3,
    offer: "high-potential-succession-programs",
    why: "ERG and development programmes carry a standing budget and a senior sponsor — a short path to someone who can say yes.",
  },
  {
    phrase: "sales conference", label: "Sales conference", weight: 3,
    offer: "communicating-with-storytelling",
    why: "A field conference is a deadline for being understood. Preparation is bought; the date does not move.",
  },
  {
    phrase: "offsite", label: "Leadership offsite", weight: 2,
    offer: "team-organizational-development",
    why: "Offsites are designed and facilitated by somebody. Teams come to be aligned, which is trust work as much as agenda work.",
  },
  {
    phrase: "launch readiness", label: "Launch readiness", weight: 2,
    offer: "communicating-with-storytelling",
    why: "A launch asks field teams to tell a new story consistently and fast. Rehearsal is the difference between saying it and landing it.",
  },
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


/** Points are an internal ranking device. A salesperson should never have to
 *  translate "5 pts" into an action, so the page shows what the number MEANS:
 *  direct evidence, evidence that strengthens something already believed, or
 *  background that cannot carry a conclusion on its own. */
export type EvidenceStrength = "Strong contributor" | "Supporting contributor" | "Context only";

export function evidenceStrength(points: number): EvidenceStrength {
  if (points >= 5) return "Strong contributor";
  if (points >= 3) return "Supporting contributor";
  return "Context only";
}
