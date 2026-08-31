import { eq } from "drizzle-orm";
import { db, appUser } from "@/db";

export type NovaLearn = {
  topics: Record<string, number>;
  last: string[];
  updatedAt?: string;
};

const TOPIC_RE: [string, RegExp][] = [
  ["title", /\b(vp|director|title|head|cxo|chief|president)\b/],
  ["account", /\b(account|company|shortlist|capital)\b/],
  ["enrich", /\b(enrich|research)\b/],
  ["radar", /\b(radar|scan|event)\b/],
  ["review", /\b(draft|send|review)\b/],
];

export function emptyLearn(): NovaLearn {
  return { topics: {}, last: [] };
}

/** Multiply all weights by 0.9 so old habits fade; then +1 this turn's topics. */
export function absorb(prev: NovaLearn | null | undefined, message: string): NovaLearn {
  const next: NovaLearn = {
    topics: { ...(prev?.topics ?? {}) },
    last: [...(prev?.last ?? [])],
    updatedAt: new Date().toISOString(),
  };
  for (const k of Object.keys(next.topics)) {
    next.topics[k] = Math.round(next.topics[k]! * 0.9 * 100) / 100;
    if (next.topics[k]! < 0.15) delete next.topics[k];
  }
  const m = message.toLowerCase();
  for (const [topic, re] of TOPIC_RE) {
    if (re.test(m)) next.topics[topic] = Math.round(((next.topics[topic] ?? 0) + 1) * 100) / 100;
  }
  next.last = [...next.last.filter((x) => x !== message), message].slice(-12);
  return next;
}

export function topTopic(learn: NovaLearn | null | undefined): string | null {
  const entries = Object.entries(learn?.topics ?? {});
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]![0];
}

export function habitBlock(learn: NovaLearn | null | undefined): string {
  if (!learn || (!Object.keys(learn.topics).length && !learn.last.length)) {
    return "No stored habits yet.";
  }
  const topics = Object.entries(learn.topics)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  const last = learn.last.slice(-5).join(" | ");
  return `Decayed topic weights: ${topics || "none"}. Recent asks: ${last || "none"}. Lean follow-ups and examples toward the strongest topic, without ignoring this turn.`;
}

export async function loadLearn(userId: string): Promise<NovaLearn> {
  const [row] = await db.select({ n: appUser.novaLearnJson }).from(appUser).where(eq(appUser.id, userId)).limit(1);
  return row?.n ?? emptyLearn();
}

export async function saveLearn(userId: string, learn: NovaLearn) {
  await db.update(appUser).set({ novaLearnJson: learn }).where(eq(appUser.id, userId));
}
