/** Ceiling on ONE manual tick-and-run from the Matched table.
 *  Deliberately independent of the enrichLimit guardrail: ticking a box is an
 *  explicit per-person decision, not a "spend N on whoever ranks highest".
 *  The daily cap in the worker remains the real brake. */
export const MAX_MANUAL_SELECT = 50;
