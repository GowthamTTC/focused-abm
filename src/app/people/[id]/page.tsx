import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, connection } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { ago } from "@/components/dash-bits";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage();
  const { id } = await params;
  const [person] = await db.select().from(connection).where(and(
    eq(connection.orgId, user.orgId),
    eq(connection.id, id),
  )).limit(1);

  if (!person) {
    return (
      <Shell user={user} active="people">
        <h1 className="text-xl font-semibold">Person not found</h1>
        <p className="mt-2 text-sm text-[#475467]">This contact is not in your workspace.</p>
        <Link href="/people" className="mt-4 inline-block text-sm text-[#263BAA]">← Back to People</Link>
      </Shell>
    );
  }

  const enriched = person.enrichStatus === "done";
  const fit = person.bucket === "pitchable";

  return (
    <Shell user={user} active="people">
      <div className="mb-4">
        <Link href="/people" className="text-sm text-[#263BAA]">← People</Link>
      </div>

      <div className="rounded-[14px] border border-[#DDE2EE] bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{person.firstName} {person.lastName}</h1>
            <p className="mt-1 text-sm text-[#475467]">
              {person.positionRaw ?? person.headlineRaw ?? "—"}
              {person.companyRaw ? ` · ${person.companyRaw}` : ""}
              {person.country || person.location ? ` · ${person.country || person.location}` : ""}
            </p>
            <p className="mt-2 flex flex-wrap gap-2 text-[12px]">
              <span className={`rounded-full px-2 py-0.5 ${fit ? "bg-[#ECFDF3] text-[#067647]" : "bg-[#F4F6FB] text-[#475467]"}`}>
                {fit ? `Fit${person.serviceSlug ? ` · ${person.serviceSlug}` : ""}` : person.bucket ?? "Unmatched"}
              </span>
              {person.score != null && (
                <span className="rounded-full bg-[#EEF1FC] px-2 py-0.5 text-[#263BAA]">Score {person.score}</span>
              )}
              {person.tier != null && (
                <span className="rounded-full bg-[#F4F6FB] px-2 py-0.5 text-[#475467]">T{person.tier}</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {person.linkedinUrl && (
              <a href={person.linkedinUrl} target="_blank" rel="noreferrer"
                className="rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 text-[12px]">Open LinkedIn</a>
            )}
            {person.batchId && (
              <Link href={`/batches/${person.batchId}?view=${enriched ? "enriched" : "pitchable"}&p=${person.id}`}
                className="rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 text-[12px]">Open in batch</Link>
            )}
          </div>
        </div>

        {person.matchWhy && (
          <p className="mt-4 rounded-[8px] bg-[#F4F6FB] px-3 py-2 text-[13px] leading-5 text-[#475467]">
            {person.matchWhy}
          </p>
        )}

        {!enriched ? (
          <div className="mt-6 rounded-[12px] border border-[#E7CE96] bg-[#FEFBF3] p-5">
            <h2 className="font-medium text-[#B54708]">Research not run yet</h2>
            <p className="mt-2 text-sm text-[#475467]">
              Posts, pain points, and outreach drafts appear after Stage B enrich.
              Shortlist their company on Accounts, or enrich from the batch view.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/accounts"
                className="rounded-[8px] bg-[#263BAA] px-3 py-1.5 text-[12px] font-medium text-white">
                Go to Accounts
              </Link>
              {person.batchId && (
                <Link href={`/batches/${person.batchId}?view=pitchable&p=${person.id}`}
                  className="rounded-[8px] border border-[#DDE2EE] bg-white px-3 py-1.5 text-[12px]">
                  Enrich in batch
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <section className="rounded-[12px] border border-[#DDE2EE] p-4">
              <h2 className="text-[11px] uppercase tracking-wider text-[#98A2B3]">About</h2>
              <p className="mt-2 text-sm leading-6 text-[#475467]">{person.aboutSummary ?? "—"}</p>
            </section>
            <section className="rounded-[12px] border border-[#DDE2EE] p-4">
              <h2 className="text-[11px] uppercase tracking-wider text-[#98A2B3]">Posts</h2>
              <p className="mt-2 text-sm leading-6 text-[#475467]">{person.postsSummary ?? "—"}</p>
            </section>
            <section className="rounded-[12px] border border-[#DDE2EE] p-4">
              <h2 className="text-[11px] uppercase tracking-wider text-[#98A2B3]">Pain points</h2>
              <p className="mt-2 text-sm leading-6 text-[#475467]">{person.painPoints ?? "—"}</p>
            </section>
            <section className="rounded-[12px] border border-[#DDE2EE] p-4">
              <h2 className="text-[11px] uppercase tracking-wider text-[#98A2B3]">Outreach draft</h2>
              <p className="mt-2 text-sm leading-6 text-[#475467] whitespace-pre-wrap">{person.outreachMessage ?? "—"}</p>
            </section>
            {person.enrichedAt && (
              <p className="text-[12px] text-[#98A2B3] md:col-span-2">Researched {ago(person.enrichedAt)}</p>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
