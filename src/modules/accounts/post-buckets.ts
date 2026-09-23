/**
 * What a post is ABOUT, decided from its own words.
 *
 * Not a model call and not the judge's theme — those say what subject the post
 * touches. This says what KIND of post it is, which is the thing a seller sorts
 * by: somebody arriving, somebody hiring, a room they all stood in, a product
 * being sold, a tenure milestone. One pass, first match wins, and the order is
 * deliberate: an arrival and an anniversary use the same verbs, so the
 * anniversary test runs before the arrival is believed.
 */
export type PostBucket =
  | "arrival" | "tenure" | "hiring" | "event" | "product" | "other";

const ARRIVAL = /\b(joined|joining|starting a new|started a new|new chapter|new position|new role|took on a new)\b/i;
const TENURE = /\b(\d+(st|nd|rd|th)?[- ]?year|anniversary|years ago|years at|years with|decade)\b/i;
const HIRING = /\b(we are hiring|we're hiring|now hiring|#hiring|open role|open position|join our team|apply (here|now)|is looking for|we are looking for)\b/i;
const EVENT = /\b(summit|conference|congress|symposium|workshop|training|masterclass|webinar|national sales meeting|kickoff|offsite|town hall)\b/i;
const PRODUCT = /\b(botox|juv[eé]derm|skinvive|coolsculpting|cooltone|natrelle|skinmedica|diamondglow|rebate|promotion|launch|portfolio)\b/i;

export const BUCKET_LABELS: Record<PostBucket, string> = {
  arrival: "Arrivals",
  tenure: "Tenure milestones",
  hiring: "Hiring",
  event: "Events and training",
  product: "Product and promotion",
  other: "Everything else",
};

/** The order they are shown in: what a seller can act on first. */
export const BUCKET_ORDER: PostBucket[] = ["event", "arrival", "hiring", "product", "tenure", "other"];

export function bucketOf(text: string | null | undefined): PostBucket {
  const t = text ?? "";
  if (TENURE.test(t)) return "tenure";
  if (ARRIVAL.test(t)) return "arrival";
  if (HIRING.test(t)) return "hiring";
  if (EVENT.test(t)) return "event";
  if (PRODUCT.test(t)) return "product";
  return "other";
}
