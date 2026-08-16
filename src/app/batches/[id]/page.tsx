import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, ilike, isNotNull, isNull, sql } from "drizzle-orm";
import { db, connection, connectionBatch } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { LedgerStrip } from "@/components/ledger";
import { ExportCard } from "@/components/export-card";
import { CopyButton } from "@/components/copy-button";
import { bucketCounts } from "@/modules/matching/service-fit";
import { moveToPitchable, reclassifyAllAction, retryPerson, runClassify, runDeepEnrich, selectTopN, scanActivity } from "./actions";
import { getOrgSettings } from "@/modules/settings/org-settings";
import { getDailyEnrichUsage } from "@/modules/enrich/usage";
import { UsageMeter } from "@/components/usage-meter";

const BUCKET_LABEL: Record<string, string> = {
  pitchable: "Pitchable", off_icp: "Off-ICP", peer_competitor: "Peers", excluded: "Excluded",
};

function StatusChip({ s }: { s: string }) {
  const cls = s === "done" ? "bg-[#263BAA]/15 text-[#263BAA]"
    : s === "running" ? "bg-[#B54708]/15 text-[#B54708]"
    : s === "failed" ? "bg-red-500/15 text-red-600"
    : "bg-[#263BAA]/10 text-[#46506E]/60";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${cls}`}>{s}</span>;
}

export default async function BatchPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; p?: string; country?: string; posted?: string; order?: string }>;
}) {
  const user = await requirePage();
  const { id } = await props.params;
  const { view = "pitchable", p, country = "", posted = "", order = "rank" } = await props.searchParams;
  const locRows = await db.selectDistinct({ l: connection.location }).from(connection)
    .where(and(eq(connection.batchId, id), isNotNull(connection.location)));
  const countries = [...new Set(locRows.map((r) => (r.l ?? "").split(",").pop()!.trim()).filter(Boolean))].sort();

  const [batch] = await db.select().from(connectionBatch)
    .where(and(eq(connectionBatch.id, id), eq(connectionBatch.orgId, user.orgId)));
  if (!batch) notFound();

  const counts = await bucketCounts(id);
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const classifiedRows = totalRows - counts.unclassified;
  const { enrichLimit } = await getOrgSettings(user.orgId);
  const usage = await getDailyEnrichUsage(user.orgId);

  // Selection status (batch-wide, independent of the current tab).
  const selAgg = await db.select({ s: connection.enrichStatus, n: sql<number>`count(*)::int` })
    .from(connection)
    .where(and(eq(connection.batchId, id), eq(connection.selectedForEnrich, true)))
    .groupBy(connection.enrichStatus);
  const sel = Object.fromEntries(selAgg.map((r) => [r.s, r.n])) as Record<string, number>;
  const selTotal = selAgg.reduce((a, r) => a + r.n, 0);
  const selDone = sel.done ?? 0;
  const selQueued = (sel.queued ?? 0) + (sel.running ?? 0);

  const rows = await db.select().from(connection)
    .where(and(
      eq(connection.batchId, id),
      view === "enriched" ? eq(connection.selectedForEnrich, true) : eq(connection.bucket, view),
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

  const nOptions = [10, 20, 30, 50, 80].filter((o) => enrichLimit === "all" || o <= enrichLimit);
  const defaultN = nOptions.includes(30) ? 30 : (nOptions[nOptions.length - 1] ?? 10);
  const person = view === "enriched" ? (rows.find((r) => r.id === p) ?? rows[0]) : undefined;

  return (
    <Shell user={user} active="connections">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{batch.label}</h1>
          <p className="tnum mt-1 text-[#46506E]/45">
            {batch.source} · {batch.createdAt.toISOString().slice(0, 10)} · {totalRows.toLocaleString()} rows
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {counts.unclassified > 0 && (
            <form action={runClassify.bind(null, id)}>
              <button className="rounded-lg bg-[#263BAA] px-3 py-2 text-sm font-semibold text-[#14204A] shadow-[0_0_18px_rgba(38,59,170,.25)] hover:bg-[#1D2E86]">
                Run matching ({counts.unclassified.toLocaleString()})
              </button>
            </form>
          )}
          {counts.unclassified === 0 && classifiedRows > 0 && (
            <form action={runClassify.bind(null, id)}>
              <button title="Recompute scores, tiers and ranks — zero model calls."
                className="rounded-lg border border-[#D0D5E4] px-3 py-2 text-sm text-[#46506E]/70 hover:bg-[#263BAA]/5">Re-rank</button>
            </form>
          )}
          {classifiedRows > 0 && (
            <form action={reclassifyAllAction.bind(null, id)}>
              <button title="Re-run Stage A on every row — use after ICP/prompt edits."
                className="rounded-lg border border-[#D0D5E4] px-3 py-2 text-sm text-[#46506E]/70 hover:bg-[#263BAA]/5">Reclassify all</button>
            </form>
          )}
          {counts.pitchable > 0 && (
            <form action={scanActivity.bind(null, id)} className="flex items-center gap-2">
              <input type="hidden" name="country" value={country} />
              <input name="n" type="number" defaultValue={50} min={1} max={200}
                className="tnum w-16 rounded-lg glass border-0 px-2 py-1.5 text-xs" />
              <button className="rounded-lg border border-[#D0D5E4] px-3 py-1.5 text-xs text-[#46506E]/70 hover:bg-[#263BAA]/5"
                title="Fetch recent-post dates only (no AI) so the activity filter has data — light seat touch, its own daily cap.">
                Scan posts
              </button>
            </form>
          )}
          {counts.pitchable > 0 && (
            <form action={selectTopN.bind(null, id)} className="flex items-center gap-2">
              <select name="n" defaultValue={defaultN}
                className="rounded-lg glass-input px-2 py-2 text-sm">
                {nOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <button title="Queue the next N un-enriched people by rank — already-enriched people are never re-taken."
                className="rounded-lg bg-[#263BAA] px-3 py-2 text-sm font-semibold text-[#14204A] hover:bg-[#1D2E86]">
                Select next N
              </button>
              <Link href="/settings" className="text-xs text-[#46506E]/40 underline decoration-white/20 hover:text-[#46506E]/80"
                title="Per-run enrichment cap — change in Settings">
                guardrail {enrichLimit === "all" ? "off" : enrichLimit}
              </Link>
            </form>
          )}
          {selTotal > 0 && (
            <form action={runDeepEnrich.bind(null, id)}>
              <button disabled={selQueued === 0}
                title={selQueued === 0
                  ? "Nothing queued — press Select next N to queue the next tranche of the pool."
                  : `Run enrichment for the ${selQueued} queued people`}
                className={selQueued > 0
                  ? "rounded-lg bg-[#263BAA] px-3 py-2 text-sm font-semibold text-[#14204A] hover:bg-[#1D2E86]"
                  : "cursor-not-allowed rounded-lg border border-[#E4E7F2] bg-[#263BAA]/5 px-3 py-2 text-sm text-[#46506E]/30"}>
                Deep enrich queued{selQueued > 0 ? ` (${selQueued})` : ""}
              </button>
            </form>
          )}
          <ExportCard batchId={id} topN={selTotal} targetPool={counts.pitchable}
            review={counts.off_icp} peers={counts.peer_competitor} />
        </div>
      </div>

      {/* Ledger strip */}
      <div className="mt-5">
        <LedgerStrip counts={{
          topDone: selDone, topPending: selTotal - selDone,
          pitchable: Math.max(0, counts.pitchable - selTotal),
          peers: counts.peer_competitor, offIcp: counts.off_icp,
          excluded: counts.excluded, unclassified: counts.unclassified,
        }} />
        <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-xs">
          <span className="text-[#46506E]/35">One tick per connection, rank order — lime Top-N ignites as enrichment completes.</span>
          <span className="flex items-baseline gap-5">
            <UsageMeter used={usage.used} cap={usage.cap} resetsAt={usage.resetsAt} />
            {selTotal > 0 && (
              <span className="text-[#263BAA]">{selTotal} selected — {selQueued} queued · {selDone} done</span>
            )}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <nav className="mt-6 flex gap-4 border-b border-[#E4E7F2] text-sm">
        {(["pitchable", "enriched", "off_icp", "peer_competitor", "excluded"] as const).map((v) => (
          <Link key={v} href={`/batches/${id}?view=${v}`}
            className={`-mb-px border-b-2 px-1 pb-2 ${view === v
              ? "border-[#263BAA] font-medium text-[#263BAA]"
              : "border-transparent text-[#46506E]/55 hover:text-[#14204A]"}`}>
            {v === "enriched"
              ? `Batch (${selDone} done)`
              : `${BUCKET_LABEL[v]} (${(counts[v] ?? 0).toLocaleString()})`}
          </Link>
        ))}
      </nav>

      {view === "enriched" ? (
        /* ── Two-pane enrichment view (design 1e) ── */
        rows.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[#E4E7F2] p-10 text-center text-sm text-[#46506E]/55">
            Select top N in the Pitchable tab to build a batch.
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-5 lg:flex-row">
            <ul className="pane-scroll w-full shrink-0 self-start rounded-2xl glass border-0 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-14rem)] lg:w-72 lg:">
              {rows.map((c, i) => (
                <li key={c.id} className={`border-b border-[#263BAA]/8 last:border-0 ${person?.id === c.id ? "border-l-2 border-l-[#263BAA] bg-[#263BAA]/5" : ""}`}>
                  <Link href={`/batches/${id}?view=enriched&p=${c.id}`}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-[#263BAA]/5">
                    <span className="tnum w-5 text-[#46506E]/35">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{c.firstName} {c.lastName}</span>
                    {c.flag && <span className="rounded border border-red-500/40 px-1 text-[10px] text-red-600">⚑</span>}
                    <StatusChip s={c.enrichStatus} />
                  </Link>
                </li>
              ))}
            </ul>

            {person && (
              <div className="min-w-0 flex-1 rounded-2xl glass border-0 p-5">
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
                <h3 className="mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#46506E]/45">
                  <span className="h-2.5 w-2.5 rounded-sm bg-white/25" /> Stage A — matched from metadata
                </h3>
                <div className="mt-2 grid grid-cols-1 gap-x-8 gap-y-3 rounded-xl glass border-0 p-4 text-sm md:grid-cols-2">
                  <div><p className="text-xs text-[#46506E]/45">Company</p><p className="mt-0.5">{person.companyRaw ?? "—"}</p></div>
                  <div><p className="text-xs text-[#46506E]/45">Position</p><p className="mt-0.5">{person.positionRaw ?? person.headlineRaw ?? "—"}</p></div>
                  <div><p className="text-xs text-[#46506E]/45">Provisional service</p><p className="tnum mt-0.5">{person.serviceSlug ?? "—"}</p></div>
                  <div><p className="text-xs text-[#46506E]/45">Why</p><p className="mt-0.5 text-[#46506E]/80">{person.matchWhy ?? "—"}</p></div>
                </div>

                {/* Stage B */}
                <h3 className="mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#B54708]/80">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#B54708]" /> Stage B — read from profile
                </h3>
                {person.enrichStatus === "failed" ? (
                  <div className="mt-2 rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm">
                    <p className="text-red-600">{person.enrichError ?? "Enrichment failed."}</p>
                    <form action={retryPerson.bind(null, id, person.id)} className="mt-3">
                      <button className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-600 hover:bg-red-500/15">
                        Retry this person
                      </button>
                    </form>
                  </div>
                ) : person.enrichStatus !== "done" ? (
                  <p className="mt-2 rounded-xl glass border-0 p-4 text-sm text-[#46506E]/55">
                    {person.enrichStatus === "running" ? "Reading profile now…" : "Queued — press Deep enrich to run."}
                  </p>
                ) : (
                  <div className="mt-2 space-y-5 rounded-xl border border-[#B54708]/15 bg-[#B54708]/[.04] p-4 text-sm">
                    <div>
                      <p className="text-xs text-[#B54708]/70">About — summary</p>
                      <p className="mt-1 text-[#46506E]/85">{person.aboutSummary ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#B54708]/70">
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
                      <p className="text-xs text-[#B54708]/70">
                        Pain points{" "}
                        {person.painInferred && (
                          <span className="rounded border border-[#B54708]/50 px-1.5 py-px text-[10px] text-[#B54708]">inferred</span>
                        )}
                      </p>
                      <p className="mt-1 text-[#46506E]/85">{person.painPoints ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#B54708]/70">Service to pitch</p>
                      <p className="mt-1">
                        {person.serviceConfirmed && person.serviceConfirmed !== person.serviceSlug ? (
                          <><span className="tnum text-[#46506E]/40 line-through">{person.serviceSlug}</span>
                            <span className="mx-1.5 text-[#46506E]/40">→</span>
                            <span className="tnum text-[#14204A]">{person.serviceConfirmed}</span></>
                        ) : (
                          <span className="tnum">{person.serviceConfirmed ?? person.serviceSlug ?? "—"}</span>
                        )}
                        {person.correctionReason && <span className="text-[#46506E]/60"> — {person.correctionReason}</span>}
                      </p>
                      {person.flag && (
                        <p className="mt-1.5">
                          <span className="rounded border border-red-400/50 px-1.5 py-px text-[10px] text-red-600">⚑ flag</span>
                          <span className="ml-2 text-[#46506E]/70">{person.flag}</span>
                        </p>
                      )}
                    </div>
                    {person.outreachMessage && (
                      <div>
                        <p className="text-xs text-[#B54708]/70">Outreach message</p>
                        <div className="mt-1.5 rounded-xl glass border-0 p-4 text-[15px] leading-relaxed text-[#14204A]">
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
        <div className="mt-6 rounded-2xl border border-dashed border-[#E4E7F2] p-12 text-center">
          {view === "pitchable" && counts.unclassified > 0 ? (
            <>
              <p className="text-[#14204A]">Run matching to classify {counts.unclassified.toLocaleString()} connections into buckets.</p>
              <p className="mt-1 text-sm text-[#46506E]/45">Rows appear live as they classify — no skeleton table.</p>
            </>
          ) : (
            <p className="text-sm text-[#46506E]/55">Nothing here yet.</p>
          )}
        </div>
      ) : (
        /* ── Bucket tables ── */
        <div className="mt-4 overflow-x-auto rounded-2xl glass border-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#263BAA]/5 text-xs uppercase tracking-wide text-[#46506E]/45">
              <tr>
                {view === "pitchable" ? (
                  <><th className="px-3 py-2.5">Rank</th><th className="px-3 py-2.5">Tier</th><th className="px-3 py-2.5">Name</th>
                    <th className="px-3 py-2.5">Company</th><th className="px-3 py-2.5">Position</th>
                    <th className="px-3 py-2.5">Service</th><th className="px-3 py-2.5">Why</th>
                    <th className="px-3 py-2.5 text-right">Score</th></>
                ) : (
                  <><th className="px-3 py-2.5">Name</th><th className="px-3 py-2.5">Company</th>
                    <th className="px-3 py-2.5">Position</th><th className="px-3 py-2.5">Why</th>
                    <th className="px-3 py-2.5" /></>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAECF5] align-top">
              {rows.map((c) => {
                const b = c.scoreBreakdownJson;
                return (
                  <tr key={c.id} className={c.selectedForEnrich && view === "pitchable"
                    ? "border-l-2 border-l-[#263BAA] bg-[#263BAA]/5" : ""}>
                    {view === "pitchable" ? (<>
                      <td className="tnum px-3 py-2.5 text-[#46506E]/40">{c.rank ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        {c.tier && (
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            c.tier === 1 ? "bg-[#263BAA]/20 text-[#263BAA]" : "bg-[#263BAA]/10 text-[#46506E]/60"}`}>
                            T{c.tier}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-medium">
                        {c.linkedinUrl
                          ? <a href={c.linkedinUrl} target="_blank" className="underline decoration-white/20 hover:decoration-[#263BAA]">{c.firstName} {c.lastName}</a>
                          : <>{c.firstName} {c.lastName}</>}
                      </td>
                      <td className="px-3 py-2.5">{c.companyRaw}</td>
                      <td className="px-3 py-2.5">{c.positionRaw ?? c.headlineRaw}</td>
                      <td className="px-3 py-2.5">
                        {c.serviceSlug && <span className="rounded bg-[#263BAA]/10 px-1.5 py-0.5 text-[11px] text-[#46506E]/75">{c.serviceSlug}</span>}
                      </td>
                      <td className="relative max-w-sm px-3 py-2.5 text-xs text-[#46506E]/55">
                        <div className="group">
                          <span className="line-clamp-2">{c.matchWhy}</span>
                          <div className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-[26rem] max-w-[80vw] rounded-xl glass border-0/95 p-3.5 shadow-2xl backdrop-blur group-hover:block">
                            <p className="text-sm text-[#14204A]">{c.matchWhy}</p>
                            {b && (
                              <p className="tnum mt-2 text-[#46506E]/65">
                                seniority {b.seniority} · function {b.function_fit} · confidence {b.confidence} · founder {b.founder_bonus} · company {b.company_present}
                                {b.service_bonus ? ` · service ${b.service_bonus}` : ""} = {b.total}{c.tier ? ` → T${c.tier}` : ""}
                              </p>
                            )}
                            <span className="mt-2 inline-block rounded border border-[#D0D5E4] px-1.5 py-0.5 text-[10px] text-[#46506E]/60">
                              {c.matchMethod === "rule" ? "rule pass" : c.matchMethod === "manual" ? "manual" : "model pass"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="tnum px-3 py-2.5 text-right text-[#46506E]/70">{c.score ?? "—"}</td>
                    </>) : (<>
                      <td className="px-3 py-2.5 font-medium">
                        {c.linkedinUrl
                          ? <a href={c.linkedinUrl} target="_blank" className="underline decoration-white/20 hover:decoration-[#263BAA]">{c.firstName} {c.lastName}</a>
                          : <>{c.firstName} {c.lastName}</>}
                      </td>
                      <td className="px-3 py-2.5">{c.companyRaw}</td>
                      <td className="px-3 py-2.5">{c.positionRaw ?? c.headlineRaw}</td>
                      <td className="max-w-md px-3 py-2.5 text-xs text-[#46506E]/55">{c.matchWhy}</td>
                      <td className="px-3 py-2.5 text-right">
                        {(view === "off_icp" || view === "peer_competitor") && (
                          <form action={moveToPitchable.bind(null, id, c.id)}>
                            <button className="whitespace-nowrap text-xs text-[#46506E]/35 hover:text-[#263BAA]">
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
      )}
    </Shell>
  );
}
