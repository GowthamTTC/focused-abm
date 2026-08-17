/** Topic frequencies from the pain points of researched prospects.
 *  Honest scope: this is what the machine actually read and wrote — not a
 *  guess about the whole network. */
import { and, eq, isNotNull } from "drizzle-orm";
import { db, connection } from "@/db";

const STOP = new Set(("a an and are as at be but by for from has have in is it its of on or that the their "
  + "they this to was were will with your you our not they're it's more than into over under about need needs "
  + "needing without can could may might should would there when where which while who whose after before "
  + "during between against new using use used based across also both each such very").split(" "));

export async function topicCloud(orgId: string, max = 28) {
  const rows = await db.select({ pains: connection.painPoints })
    .from(connection)
    .where(and(eq(connection.orgId, orgId), eq(connection.enrichStatus, "done"), isNotNull(connection.painPoints)));
  const freq = new Map<string, number>();
  for (const r of rows) {
    const raw = r.pains;
    const pains: string[] = Array.isArray(raw) ? (raw as string[])
      : typeof raw === "string" ? raw.split(/[\n;•·|]+/) : [];
    for (const phrase of pains) {
      for (const raw of String(phrase).toLowerCase().split(/[^a-z][^a-z]*/)) {
        const w = raw.trim();
        if (w.length < 4 || STOP.has(w)) continue;
        freq.set(w, (freq.get(w) ?? 0) + 1);
      }
    }
  }
  return {
    people: rows.length,
    terms: [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, max)
      .map(([term, n]) => ({ term, n })),
  };
}
