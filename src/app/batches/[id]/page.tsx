import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, ilike, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db, connection, connectionBatch } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { LedgerStrip } from "@/components/ledger";
import { ExportCard } from "@/components/export-card";
import { CopyButton } from "@/components/copy-button";
import { bucketCounts } from "@/modules/matching/service-fit";
import { clearQueue, enrichOne, enrichSelected, moveToPitchable, reclassifyAllAction, retryPerson, runClassify, scanActivity } from "./actions";
import { SelectRows } from "@/components/select-rows";
import { MAX_MANUAL_SELECT } from "@/modules/enrich/limits";
import { getDailyEnrichUsage } from "@/modules/enrich/usage";
import { UsageMeter } from "@/components/usage-meter";

const BUCKET_LABEL: Record<string, string> = {
  pitchable: "Matched", off_icp: "Off-target", peer_competitor: "Peers", excluded: "Excluded",
};

function StatusChip({ s }: { s: string }) {
  const cls = s === "done" ? "bg-[#EEF1FC] text-[#263BAA]"
    : s === "running" ? "bg-[#FDF6E7] text-[#B54708]"
    : s === "failed" ? "bg-red-500/15 text-[#B42318]"
    : "bg-[#EEF1FC] text-[#475467]";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${cls}`}>{s}</span>;
}

export default async function BatchPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; p?: string; country?: string; posted?: string; order?: string; run?: string; cleared?: string }>;
}) {
  const user = await requirePage();
  const { id } = await props.params;
  const { view = "pitchable", p, country = "", posted = "", order = "rank", run, cleared } = await props.searchParams;
  // Every row action returns to the exact tab + filters it was fired from.
  const qs = new URLSearchParams(
    Object.entries({ view, country, posted, order }).filter(([, v]) => v) as [string, string][],
  ).toString();
  const locRows = await db.selectDistinct({ l: connection.location }).from(connection)
    .where(and(eq(connection.batchId, id), isNotNull(connection.location)));
  const countries = [...new Set(locRows.map((r) => (r.l ?? "").split(",").pop()!.trim()).filter(Boolean))].sort();

  const [batch] = await db.select().from(connectionBatch)
    .where(and(eq(connectionBatch.id, id), eq(connectionBatch.orgId, user.orgId)));
  if (!batch) notFound();

  const counts = await bucketCounts(id);
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const classifiedRows = totalRows - counts.unclassified;
  const usage = await getDailyEnrichUsage(user.orgId);

  // Research state, batch-wide. Read from enrich_status ONLY — selected_for_enrich
  // is a worker handle, not a fact about a person, and reading it is what let a
  // dead tranche keep announcing "120 selected" for days.
  const stAgg = await db.select({ s: connection.enrichStatus, n: sql<number>`count(*)::int` })
    .from(connection).where(eq(connection.batchId, id)).groupBy(connection.enrichStatus);
  const st = Object.fromEntries(stAgg.map((r) => [r.s, r.n])) as Record<string, number>;
  const researched = st.done ?? 0;
  const queuedN = st.queued ?? 0;
  const runningN = st.running ?? 0;
  const failedN = st.failed ?? 0;
  const touched = researched + queuedN + runningN + failedN;
  const capReached = usage.used >= usage.cap;

  const rows = await db.select().from(connection)
    .where(and(
      eq(connection.batchId, id),
      view === "enriched" ? ne(connection.enrichStatus, "pending") : eq(connection.bucket, view),
      ...(country ? [ilike(connection.location, `%${country}`)] : []),
      ...(posted === "none" ? [isNull(connection.lastPostAt)] : []),
      ...(["3", "7", "15"].includes(posted)
        ? [gte(connection.lastPostAt, new Date(Date.now() - Number(posted) * 864e5))] : []),
    ))
    .orderBy(
      order === "score" ? desc(connection.score)
      : order === "posted" ? sql`${connection.lastPostAt} desc nulls last`
      : order === "name" ? asc(connection.firstName)
      : asc(connection.rank),
      asc(connection.createdAt),
    )
    .limit(400);

  const person = view === "enriched" ? (rows.find((r) => r.id === p) ?? rows[0]) : undefined;

  return (
    <Shell user={user} active="connections">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{batch.label}</h1>
          <p className="tnum mt-1 text-[#98A2B3]">
            {batch.source} · {batch.createdAt.toISOString().slice(0, 10)} · {totalRows.toLocaleString()} rows
          </p>
          {cleared && <p className="mt-1 text-sm text-[#475467]">Queue cleared — those people are back in the pool and pickable again.</p>}
          {run === "0" && <p className="mt-1 text-sm text-[#B54708]">Nothing was selected — tick a row or press Enrich on one.</p>}
          {run && run !== "0" && (
            <p className="mt-1 text-sm text-[#067647]">
              Researching {run} {Number(run) === 1 ? "person" : "people"} now — drafts land in Review as each finishes.
              {capReached && <span className="text-[#B54708]"> Today&apos;s budget is spent, so they run after the reset.</span>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {counts.unclassified > 0 && (
            <form action={runClassify.bind(null, id)}>
              <button className="rounded-[8px] bg-[#263BAA] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1D2E86]">
                Run matching ({counts.unclassified.toLocaleString()})
              </button>
            </form>
          )}
          {counts.unclassified === 0 && classifiedRows > 0 && (
            <form action={runClassify.bind(null, id)}>
              <button title="Recompute scores, tiers and ranks — zero model calls."
                className="rounded-[8px] border border-[#DDE2EE] px-3 py-2 text-sm text-[#475467] hover:bg-[#F4F6FB]">Re-rank</button>
            </form>
          )}
          {classifiedRows > 0 && (
            <form action={reclassifyAllAction.bind(null, id)}>
              <button title="Re-run Stage A on every row — use after ICP/prompt edits."
                className="rounded-[8px] border border-[#DDE2EE] px-3 py-2 text-sm text-[#475467] hover:bg-[#F4F6FB]">Reclassify all</button>
            </form>
          )}
          {counts.pitchable > 0 && (
            <form action={scanActivity.bind(null, id)} className="flex items-center gap-2">
              <input type="hidden" name="country" value={country} />
              <input name="n" type="number" defaultValue={50} min={1} max={200}
                className="tnum w-16 rounded-[8px] bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-2 py-1.5 text-xs" />
              <button className="rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 text-xs text-[#475467] hover:bg-[#F4F6FB]"
                title="Fetch recent-post dates only (no AI) so the activity filter has data — light seat touch, its own daily cap.">
                Scan posts
              </button>
            </form>
          )}
          {counts.pitchable > 0 && (
            <Link href="/dashboard"
              className="rounded-[8px] bg-[#263BAA] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1D2E86]">
              Research from Today →
            </Link>
          )}
          {queuedN > 0 && (
            <form action={clearQueue.bind(null, id, qs)}>
              <button title="Release everyone stuck in the queue back into the pool. Researched people are untouched."
                className="rounded-[8px] border border-[#DDE2EE] px-3 py-2 text-sm text-[#475467] hover:border-[#B54708] hover:text-[#B54708]">
                Clear queue ({queuedN.toLocaleString()})
              </button>
            </form>
          )}
          <ExportCard batchId={id} topN={researched} targetPool={counts.pitchable}
            review={counts.off_icp} peers={counts.peer_competitor} />
        </div>
      </div>

      {/* Ledger strip */}
      <div className="mt-5">
        <LedgerStrip counts={{
          topDone: researched, topPending: touched - researched,
          pitchable: Math.max(0, counts.pitchable - touched),
          peers: counts.peer_competitor, offIcp: counts.off_icp,
          excluded: counts.excluded, unclassified: counts.unclassified,
        }} />
        <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-xs">
          <span className="text-[#98A2B3]">One tick per connection, rank order — lime Top-N ignites as research completes.</span>
          <span className="flex items-baseline gap-5">
            <UsageMeter used={usage.used} cap={usage.cap} resetsAt={usage.resetsAt} />
            {touched > 0 && (
              <span className="text-[#263BAA]">
                {researched.toLocaleString()} researched
                {runningN > 0 && <span className="text-[#B54708]"> · {runningN} running</span>}
                {queuedN > 0 && <span className="text-[#98A2B3]"> · {queuedN} queued</span>}
                {failedN > 0 && <span className="text-[#B42318]"> · {failedN} failed</span>}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <nav className="mt-6 flex gap-4 border-b border-[#DDE2EE] text-sm">
        {(["pitchable", "enriched", "off_icp", "peer_competitor", "excluded"] as const).map((v) => (
          <Link key={v} href={`/batches/${id}?view=${v}`}
            className={`-mb-px border-b-2 px-1 pb-2 ${view === v
              ? "border-[#263BAA] font-medium text-[#263BAA]"
              : "border-transparent text-[#98A2B3] hover:text-[#101828]"}`}>
            {v === "enriched"
              ? `Batch (${researched} done)`
              : `${BUCKET_LABEL[v]} (${(counts[v] ?? 0).toLocaleString()})`}
          </Link>
        ))}
      </nav>

      {view === "enriched" ? (
        /* ── Two-pane enrichment view (design 1e) ── */
        rows.length === 0 ? (
          <div className="mt-6 rounded-[14px] border border-dashed border-[#DDE2EE] p-10 text-center text-sm text-[#98A2B3]">
            Nobody researched yet — tick rows in Matched and press Enrich selected, or run the research sentence on Today.
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-5 lg:flex-row">
            <ul className="pane-scroll w-full shrink-0 self-start bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] lg:sticky lg:top-0 lg:max-h-[calc(100dvh-14rem)] lg:w-72 lg:">
              {rows.map((c, i) => (
                <li key={c.id} className={`border-b border-[#263BAA]/8 last:${person?.id === c.id ? "border-l-2 border-l-[#263BAA] bg-[#263BAA]/5" : ""}`}>
                  <Link href={`/batches/${id}?view=enriched&p=${c.id}`}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-[#F4F6FB]">
                    <span className="tnum w-5 text-[#98A2B3]">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{c.firstName} {c.lastName}</span>
                    {c.flag && <span className="rounded border border-[#FDA29B] px-1 text-[10px] text-[#B42318]">⚑</span>}
                    <StatusChip s={c.enrichStatus} />
                  </Link>
                </li>
              ))}
            </ul>

            {person && (
              <div className="min-w-0 flex-1 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-xl font-semibold">{person.firstName} {person.lastName}</h2>
                  {person.linkedinUrl && (
                    <a href={person.linkedinUrl} target="_blank" className="text-sm text-[#263BAA] underline decoration-[#263BAA]/40 hover:text-[#1D2E86]">
                      Open profile ↗
                    </a>
                  )}
                  <span className="ml-auto"><StatusChip s={person.enrichStatus} /></span>
                </div>

                {/* Stage A */}
                <h3 className="mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#98A2B3]">
                  <span className="h-2.5 w-2.5 rounded-sm bg-white/25" /> Stage A — matched from metadata
                </h3>
                <div className="mt-2 grid grid-cols-1 gap-x-8 gap-y-3 bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 text-sm md:grid-cols-2">
                  <div><p className="text-xs text-[#98A2B3]">Company</p><p className="mt-0.5">{person.companyRaw ?? "—"}</p></div>
                  <div><p className="text-xs text-[#98A2B3]">Position</p><p className="mt-0.5">{person.positionRaw ?? person.headlineRaw ?? "—"}</p></div>
                  <div><p className="text-xs text-[#98A2B3]">Provisional service</p><p className="tnum mt-0.5">{person.serviceSlug ?? "—"}</p></div>
                  <div><p className="text-xs text-[#98A2B3]">Why</p><p className="mt-0.5 text-[#475467]">{person.matchWhy ?? "—"}</p></div>
                </div>

                {/* Stage B */}
                <h3 className="mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#B54708]/80">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#B54708]" /> Stage B — read from profile
                </h3>
                {person.enrichStatus === "failed" ? (
                  <div className="mt-2 rounded-[10px] border border-[#FDA29B] bg-red-500/10 p-4 text-sm">
                    <p className="text-[#B42318]">{person.enrichError ?? "Research failed."}</p>
                    <form action={retryPerson.bind(null, id, person.id)} className="mt-3">
                      <button className="rounded-[8px] border border-[#FDA29B] px-3 py-1.5 text-xs text-[#B42318] hover:bg-red-500/15">
                        Retry this person
                      </button>
                    </form>
                  </div>
                ) : person.enrichStatus !== "done" ? (
                  <p className="mt-2 bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 text-sm text-[#98A2B3]">
                    {person.enrichStatus === "running" ? "Reading profile now…" : "Queued — press Research to run."}
                  </p>
                ) : (
                  <div className="mt-2 space-y-5 rounded-[10px] border border-[#B54708]/15 bg-[#B54708]/[.04] p-4 text-sm">
                    <div>
                      <p className="text-xs text-[#B54708]">About — summary</p>
                      <p className="mt-1 text-[#46506E]/85">{person.aboutSummary ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#B54708]">
                        Posts{" "}
                        {(person.activityUrl || person.linkedinUrl) && (
                          <a href={person.activityUrl ?? `${person.linkedinUrl?.replace(/\/$/, "")}/recent-activity/all/`}
                            target="_blank" className="text-[#263BAA] underline decoration-[#263BAA]/40">activity feed ↗</a>
                        )}
                      </p>
                      {person.postsSummary
                        ? <p className="mt-1 text-[#46506E]/85">{person.postsSummary}</p>
                        : <p className="mt-1 text-[#B54708]">No original posts found — summary generated from profile only.</p>}
                    </div>
                    <div>
                      <p className="text-xs text-[#B54708]">
                        Signals{" "}
                        {person.painInferred && (
                          <span className="rounded border border-[#B54708]/50 px-1.5 py-px text-[10px] text-[#B54708]">inferred</span>
                        )}
                      </p>
                      <p className="mt-1 text-[#46506E]/85">{person.painPoints ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#B54708]">Service to pitch</p>
                      <p className="mt-1">
                        {person.serviceConfirmed && person.serviceConfirmed !== person.serviceSlug ? (
                          <><span className="tnum text-[#98A2B3] line-through">{person.serviceSlug}</span>
                            <span className="mx-1.5 text-[#98A2B3]">→</span>
                            <span className="tnum text-[#101828]">{person.serviceConfirmed}</span></>
                        ) : (
                          <span className="tnum">{person.serviceConfirmed ?? person.serviceSlug ?? "—"}</span>
                        )}
                        {person.correctionReason && <span className="text-[#475467]"> — {person.correctionReason}</span>}
                      </p>
                      {person.flag && (
                        <p className="mt-1.5">
                          <span className="rounded border border-red-400/50 px-1.5 py-px text-[10px] text-[#B42318]">⚑ flag</span>
                          <span className="ml-2 text-[#475467]">{person.flag}</span>
                        </p>
                      )}
                    </div>
                    {person.outreachMessage && (
                      <div>
                        <p className="text-xs text-[#B54708]">Outreach message</p>
                        <div className="mt-1.5 bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 text-[15px] leading-relaxed text-[#101828]">
                          {person.outreachMessage}
                        </div>
                        <div className="mt-2.5 flex items-center gap-3">
                          <CopyButton text={person.outreachMessage} />
                          {person.linkedinUrl && (
                            <a href={person.linkedinUrl} target="_blank" className="text-sm text-[#263BAA] underline decoration-[#263BAA]/40 hover:text-[#1D2E86]">
                              Open profile
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-[14px] border border-dashed border-[#DDE2EE] p-12 text-center">
          {view === "pitchable" && counts.unclassified > 0 ? (
            <>
              <p className="text-[#101828]">Run matching to classify {counts.unclassified.toLocaleString()} connections into buckets.</p>
              <p className="mt-1 text-sm text-[#98A2B3]">Rows appear live as they classify — no skeleton table.</p>
            </>
          ) : (
            <p className="text-sm text-[#98A2B3]">Nothing here yet.</p>
          )}
        </div>
      ) : (
        /* ── Bucket tables ── */
        <SelectRows enabled={view === "pitchable"} max={MAX_MANUAL_SELECT}
          action={enrichSelected.bind(null, id, qs)}>
        <div className="mt-4 overflow-x-auto bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F4F6FB] text-xs uppercase tracking-wide text-[#98A2B3]">
              <tr>
                {view === "pitchable" ? (
                  <><th className="w-9 px-3 py-2.5"><span className="sr-only">Select</span></th>
                    <th className="px-3 py-2.5">Rank</th><th className="px-3 py-2.5">Tier</th><th className="px-3 py-2.5">Name</th>
                    <th className="px-3 py-2.5">Company</th><th className="px-3 py-2.5">Position</th>
                    <th className="px-3 py-2.5">Service</th><th className="px-3 py-2.5">Why</th>
                    <th className="px-3 py-2.5 text-right">Score</th>
                    <th className="px-3 py-2.5 text-right">Research</th></>
                ) : (
                  <><th className="px-3 py-2.5">Name</th><th className="px-3 py-2.5">Company</th>
                    <th className="px-3 py-2.5">Position</th><th className="px-3 py-2.5">Why</th>
                    <th className="px-3 py-2.5" /></>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF1F8] align-top">
              {rows.map((c) => {
                const b = c.scoreBreakdownJson;
                return (
                  <tr key={c.id} className={c.enrichStatus === "done" && view === "pitchable"
                    ? "border-l-2 border-l-[#263BAA] bg-[#263BAA]/5" : ""}>
                    {view === "pitchable" ? (<>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" name="ids" value={c.id}
                          disabled={c.enrichStatus === "done" || c.enrichStatus === "running" || c.enrichStatus === "queued"}
                          title={c.enrichStatus === "pending" || c.enrichStatus === "failed"
                            ? "Select for research"
                            : `Already ${c.enrichStatus} — nothing to spend here`}
                          className="h-4 w-4 accent-[#263BAA] disabled:opacity-30" />
                      </td>
                      <td className="tnum px-3 py-2.5 text-[#98A2B3]">{c.rank ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        {c.tier && (
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            c.tier === 1 ? "bg-[#EEF1FC] text-[#263BAA]" : "bg-[#EEF1FC] text-[#475467]"}`}>
                            T{c.tier}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-medium">
                        {c.linkedinUrl
                          ? <a href={c.linkedinUrl} target="_blank" className="underline decoration-[#DDE2EE] hover:decoration-[#263BAA]">{c.firstName} {c.lastName}</a>
                          : <>{c.firstName} {c.lastName}</>}
                      </td>
                      <td className="px-3 py-2.5">{c.companyRaw}</td>
                      <td className="px-3 py-2.5">{c.positionRaw ?? c.headlineRaw}</td>
                      <td className="px-3 py-2.5">
                        {c.serviceSlug && <span className="rounded bg-[#EEF1FC] px-1.5 py-0.5 text-[11px] text-[#475467]">{c.serviceSlug}</span>}
                      </td>
                      <td className="relative max-w-sm px-3 py-2.5 text-xs text-[#98A2B3]">
                        <div className="group">
                          <span className="line-clamp-2">{c.matchWhy}</span>
                          <div className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-[26rem] max-w-[80vw] bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)]/95 p-3.5 shadow-[0_12px_32px_rgba(16,24,40,.14)]  group-hover:block">
                            <p className="text-sm text-[#101828]">{c.matchWhy}</p>
                            {b && (
                              <p className="tnum mt-2 text-[#46506E]/65">
                                seniority {b.seniority} · function {b.function_fit} · confidence {b.confidence} · founder {b.founder_bonus} · company {b.company_present}
                                {b.service_bonus ? ` · service ${b.service_bonus}` : ""} = {b.total}{c.tier ? ` → T${c.tier}` : ""}
                              </p>
                            )}
                            <span className="mt-2 inline-block rounded border border-[#DDE2EE] px-1.5 py-0.5 text-[10px] text-[#475467]">
                              {c.matchMethod === "rule" ? "rule pass" : c.matchMethod === "manual" ? "manual" : "model pass"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="tnum px-3 py-2.5 text-right text-[#475467]">{c.score ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right">
                        {c.enrichStatus === "pending" || c.enrichStatus === "failed" ? (
                          <button formAction={enrichOne.bind(null, id, c.id, qs)}
                            title={c.enrichStatus === "failed"
                              ? `Research ${c.firstName} again`
                              : `Research ${c.firstName} now — one person, one credit`}
                            className="whitespace-nowrap rounded-[8px] border border-[#DDE2EE] px-2.5 py-1 text-xs text-[#475467] hover:border-[#263BAA] hover:text-[#263BAA]">
                            {c.enrichStatus === "failed" ? "Retry" : "Enrich"}
                          </button>
                        ) : (
                          <StatusChip s={c.enrichStatus} />
                        )}
                      </td>
                    </>) : (<>
                      <td className="px-3 py-2.5 font-medium">
                        {c.linkedinUrl
                          ? <a href={c.linkedinUrl} target="_blank" className="underline decoration-[#DDE2EE] hover:decoration-[#263BAA]">{c.firstName} {c.lastName}</a>
                          : <>{c.firstName} {c.lastName}</>}
                      </td>
                      <td className="px-3 py-2.5">{c.companyRaw}</td>
                      <td className="px-3 py-2.5">{c.positionRaw ?? c.headlineRaw}</td>
                      <td className="max-w-md px-3 py-2.5 text-xs text-[#98A2B3]">{c.matchWhy}</td>
                      <td className="px-3 py-2.5 text-right">
                        {(view === "off_icp" || view === "peer_competitor") && (
                          <form action={moveToPitchable.bind(null, id, c.id)}>
                            <button className="whitespace-nowrap text-xs text-[#98A2B3] hover:text-[#263BAA]">
                              Move to pitchable
                            </button>
                          </form>
                        )}
                      </td>
                    </>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </SelectRows>
      )}
    </Shell>
  );
}
