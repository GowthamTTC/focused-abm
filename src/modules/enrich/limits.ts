/** Ceiling on ONE manual tick-and-run, wherever the ticking happens — the
 *  Matched table and People both get it through enrichAllowance().
 *  Deliberately independent of the enrichLimit guardrail: ticking a box is an
 *  explicit per-person decision, not a "spend N on whoever ranks highest".
 *  The daily cap is the other half of the brake, and the smaller of the two
 *  wins. */
export const MAX_MANUAL_SELECT = 50;
