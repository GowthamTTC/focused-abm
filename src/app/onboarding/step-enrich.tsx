import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { getDailyEnrichUsage, resetsIn } from "@/modules/enrich/usage";

/** Step 8 — the last thing setup teaches, and the one habit the product runs on.
 *
 *  Deliberately not a second People table: the batch-select, the profile pane
 *  and the copy handoff all already exist on the real screens, and a first-run
 *  copy of them would be a second place to keep correct. This explains the loop
 *  against the user's own numbers and opens the door to it. */
export async function StepEnrich({ orgId }: { orgId: string }) {
  const [agg] = await db.select({
    matched: sql<number>`count(*) filter (where bucket = 'pitchable')::int`,
    enriched: sql<number>`count(*) filter (where enrich_status = 'done')::int`,
    drafted: sql<number>`count(*) filter (where outreach_message is not null)::int`,
  }).from(connection).where(eq(connection.orgId, orgId));
  const [top] = await db.select({
    firstName: connection.firstName,
    lastName: connection.lastName,
  }).from(connection)
    .where(and(eq(connection.orgId, orgId), eq(connection.bucket, "pitchable")))
    .orderBy(sql`rank asc nulls last`).limit(1);

  const usage = await getDailyEnrichUsage(orgId);
  const room = Math.max(0, usage.cap - usage.used);
  const matched = agg?.matched ?? 0;
  const enriched = agg?.enriched ?? 0;
  const example = top ? `${top.firstName} ${top.lastName}`.trim() : null;

  return (
    <div className="space-y-5">
      <div className="rounded-[10px] border border-[#DDE2EE] bg-[#F6F7FB] p-6 text-sm text-[#475467]">
        <p>
          Matching told you <span className="font-medium text-[#101828]">who</span> is worth your time.
          Research is what tells you <span className="font-medium text-[#101828]">what to say</span> to them:
          it reads {example ? <>{example}&apos;s</> : "someone's"} profile and recent posts, writes back the
          pain points it can actually evidence, and drafts an opener in the voice you sampled in step 5.
        </p>
        <p className="mt-3">
          You do it in batches, from the People screen: tick everyone you want researched, run them in one
          go, and each row flips from <span className="font-medium text-[#101828]">not enriched</span> to{" "}
          <span className="font-medium text-[#101828]">enriched</span> as it lands. Open a name for the full
          profile, read the pain points, then copy the draft.
        </p>
        <p className="mt-3">
          The last step is yours on purpose. LinkedIn has no API that lets an app message on your behalf, so
          nothing is ever sent for you — you copy the draft, open their profile, and paste it. Editing it
          first is normal, and usually worth it.
        </p>
      </div>

      <div className="rounded-[10px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <p className="text-sm font-medium text-[#101828]">What&apos;s waiting for you</p>
        <p className="tnum mt-2 text-sm text-[#475467]">
          {matched.toLocaleString()} {matched === 1 ? "person" : "people"} matched your ICPs
          {enriched > 0
            ? `, ${enriched.toLocaleString()} already researched`
            : ", none researched yet"}.
          {" "}
          {room > 0
            ? `You can research up to ${room.toLocaleString()} more today${usage.used > 0 ? ` (${usage.used}/${usage.cap} spent)` : ""} — the ceiling keeps the seat looking human, and resets in ${resetsIn(usage.resetsAt)}.`
            : `Today's ${usage.cap} are spent — the ceiling keeps the seat looking human, and resets in ${resetsIn(usage.resetsAt)}.`}
        </p>
        <Link href="/people" target="_blank" rel="noreferrer"
          className="mt-4 inline-block rounded-[10px] bg-[#263BAA] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
          Open People and pick your first batch ↗
        </Link>
        <p className="mt-2 text-xs text-[#98A2B3]">
          Opens in a new tab. Finish setup below whenever you&apos;re ready — nothing here is a gate, and
          everything stays where it is.
        </p>
      </div>
    </div>
  );
}
