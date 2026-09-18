export const STEPS: { title: string; blurb: string }[] = [
  { title: "Log in", blurb: "Your workspace exists and you're signed in." },
  { title: "Add services", blurb: "Point us at your website and we draft what you sell." },
  { title: "ICP definition", blurb: "Sharpen who each service is for." },
  { title: "Connect LinkedIn", blurb: "Link the seat we'll read your network from." },
  { title: "Scan tone of voice", blurb: "Sample your own posts so drafts sound like you." },
  { title: "Sync connections", blurb: "Import your network and map it to your ICP." },
  { title: "Dashboard", blurb: "Your daily list of who to reach out to, and why." },
  { title: "Enrich & copy", blurb: "Deep-research a person, then copy the opener to LinkedIn." },
];

export const LAST_STEP = STEPS.length;
export const SERVICES_STEP = 2;
export const ICP_STEP = 3;
export const CONNECT_STEP = 4;
export const VOICE_STEP = 5;
export const SYNC_STEP = 6;
export const DASHBOARD_STEP = 7;
export const ENRICH_STEP = 8;

export function clampStep(raw: string | number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(n, 1), LAST_STEP);
}

export type Move =
  | { kind: "goto"; from: number; step: number; persist: number | null }
  | { kind: "finish"; from: number };

/** Where a Back/Next press lands, and what progress it earns.
 *
 *  `reached` is the trusted value from the row; `rawFrom` arrives in the form
 *  body, so it is clamped to the step the user has actually earned. That clamp
 *  is what stops a hand-edited `from=8` from finishing setup early — finish is
 *  only reachable once reached is already at the second-to-last step.
 *
 *  `from` is returned alongside the destination because per-step gates have to
 *  key off the clamped value, never the posted one. */
export function resolveMove(reached: number, rawFrom: string | number, dir: string): Move {
  const from = Math.min(clampStep(rawFrom), clampStep(reached + 1));
  if (dir === "back") return { kind: "goto", from, step: clampStep(from - 1), persist: null };
  if (from >= LAST_STEP) return { kind: "finish", from };
  return { kind: "goto", from, step: from + 1, persist: from > reached ? from : null };
}
