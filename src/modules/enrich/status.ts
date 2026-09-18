/** One name per research state, for every screen that shows one.
 *
 *  People used to print "research" on a finished row and "open" on an unfinished
 *  one — two words that name the link's destination rather than the person's
 *  state, so the same row read differently there than on its batch card. The
 *  fact lives in connection.enrich_status; this is where it becomes English.
 *
 *  Derived, not stored: enrich_status already carries every state the worker can
 *  put a row in (including the in-flight and failed ones a boolean could not),
 *  and enriched_at already dates the success, so a new column would only add a
 *  second thing to keep true. */

export type EnrichState = "enriched" | "researching" | "failed" | "skipped" | "not-enriched";

const LABEL: Record<EnrichState, string> = {
  enriched: "enriched",
  researching: "researching",
  failed: "failed",
  skipped: "skipped",
  "not-enriched": "not enriched",
};

/** `queued` and `running` are the same fact to a human: a live run holds them.
 *  A row re-queued after an earlier success reads as researching, not enriched —
 *  what is on screen is about to be replaced. */
export function enrichStateOf(row: { enrichStatus: string; enrichedAt?: Date | null }): EnrichState {
  switch (row.enrichStatus) {
    case "done": return "enriched";
    case "queued":
    case "running": return "researching";
    case "failed": return "failed";
    case "skipped": return "skipped";
    default: return row.enrichedAt ? "enriched" : "not-enriched";
  }
}

export function enrichStateLabel(state: EnrichState): string {
  return LABEL[state];
}

/** Whether research has to be paid for again before this row has anything to
 *  read — the predicate the batch-select and per-row Enrich controls key off. */
export function isEnrichable(state: EnrichState): boolean {
  return state === "not-enriched" || state === "failed" || state === "skipped";
}

/** The same predicate for a WHERE clause, where a row cannot be handed to
 *  enrichStateOf first. It is deliberately the looser of the two — a 'pending'
 *  row that already carries an enriched_at reads as enriched and isEnrichable
 *  refuses it — so this is a pre-filter and never the decision: every caller
 *  that spends money re-checks with isEnrichable after loading the row. */
export const ENRICHABLE_STATUSES = ["pending", "failed", "skipped"] as const;
