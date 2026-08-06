import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, connection, connectionBatch } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { LedgerStrip } from "@/components/ledger";
import { ExportCard } from "@/components/export-card";
import { CopyButton } from "@/components/copy-button";
import { bucketCounts } from "@/modules/matching/service-fit";
import { moveToPitchable, reclassifyAllAction, retryPerson, runClassify, runDeepEnrich, selectTopN } from "./actions";
import { getOrgSettings } from "@/modules/settings/org-settings";

const BUCKET_LABEL: Record<string, string> = {
  pitchable: "Pitchable", off_icp: "Off-ICP", peer_competitor: "Peers", excluded: "Excluded",
};

function StatusChip({ s }: { s: string }) {
  const cls = s === "done" ? "bg-[#B6FF2E]/15 text-[#B6FF2E]"
    : s === "running" ? "bg-[#E7B75F]/15 text-[#E7B75F]"
    : s === "failed" ? "bg-red-500/15 text-red-300"
    : "bg-white/10 text-white/60";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${cls}`}>{s}</span>;
}

export default async function BatchPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; p?: string }>;
}) {
  const user = await requirePage();
  const { id } = await props.params;
  const { view = "pitchable", p } = await props.searchParams;

  const [batch] = await db.select().from(connectionBatch)
    .where(and(eq(connectionBatch.id, id), eq(connectionBatch.orgId, user.orgId)));
  if (!batch) notFound();

  const counts = await bucketCounts(id);
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const classifiedRows = totalRows - counts.unclassified;
  const { enrichLimit } = await getOrgSettings(user.orgId);

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
    .where(and(eq(connection.batchId, id),
      view === "enriched" ? eq(connection.selectedForEnrich, true) : eq(connection.bucket, view)))
    .orderBy(asc(connection.rank), asc(connection.createdAt))
    .limit(400);

  const nOptions = [10, 20, 30, 50].filter((o) => enrichLimit === "all" || o <= enrichLimit);
  const defaultN = nOptions.includes(30) ? 30 : (nOptions[nOptions.length - 1] ?? 10);
  const person = view === "enriched" ? (rows.find((r) => r.id === p) ?? rows[0]) : undefined;

  return (
    <Shell user={user} active="connections">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{batch.label}</h1>
          <p className="tnum mt-1 text-white/45">
            {batch.source} · {batch.createdAt.toISOString().slice(0, 10)} · {totalRows.toLocaleString()} rows
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {counts.unclassified > 0 && (
            <form action={runClassify.bind(null, id)}>
              <button className="rounded-lg bg-[#B6FF2E] px-3 py-2 text-sm font-semibold text-[#16191E] shadow-[0_0_18px_rgba(182,255,46,.25)] hover:bg-[#9FE51F]">
                Run matching ({counts.unclassified.toLocaleString()})
              </button>
            </form>
          )}
          {counts.unclassified === 0 && classifiedRows > 0 && (
            <form action={runClassify.bind(null, id)}>
              <button title="Recompute scores, tiers and ranks — zero model calls."
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/70 hover:bg-white/5">Re-rank</button>
            </form>
          )}
          {classifiedRows > 0 && (
            <form action={reclassifyAllAction.bind(null, id)}>
              <button title="Re-run Stage A on every row — use after ICP/prompt edits."
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/70 hover:bg-white/5">Reclassify all</button>
            </form>
          )}
          {counts.pitchable > 0 && (
            <form action={selectTopN.bind(null, id)} className="flex items-center gap-2">
              <select name="n" defaultValue={defaultN}
                className="rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-sm">
                {nOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <button className="rounded-lg bg-[#B6FF2E] px-3 py-2 text-sm font-semibold text-[#16191E] hover:bg-[#9FE51F]">
                Select top N
              </button>
              <Link href="/settings" className="text-xs text-white/40 underline decoration-white/20 hover:text-white/80"
                title="Per-run enrichment cap — change in Settings">
                guardrail {enrichLimit === "all" ? "off" : enrichLimit}
              </Link>
            </form>
          )}
          {selTotal > 0 && (
            <form action={runDeepEnrich.bind(null, id)}>
              <button className={selQueued > 0
                ? "rounded-lg bg-[#B6FF2E] px-3 py-2 text-sm font-semibold text-[#16191E] hover:bg-[#9FE51F]"
                : "rounded-lg border border-[#B6FF2E]/40 bg-[#B6FF2E]/10 px-3 py-2 text-sm font-medium text-[#D9FF8A] hover:bg-[#B6FF2E]/15"}>
                Deep enrich queued
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
        <div className="mt-1.5 flex items-baseline justify-between text-xs">
          <span className="text-white/35">One tick per connection, rank order — lime Top-N ignites as enrichment completes.</span>
          {selTotal > 0 && (
            <span className="text-[#B6FF2E]">Top {selTotal} selected — {selQueued} queued · {selDone} done</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <nav className="mt-6 flex gap-4 border-b border-white/10 text-sm">
        {(["pitchable", "enriched", "off_icp", "peer_competitor", "excluded"] as const).map((v) => (
          <Link key={v} href={`/batches/${id}?view=${v}`}
            className={`-mb-px border-b-2 px-1 pb-2 ${view === v
              ? "border-[#B6FF2E] font-medium text-[#B6FF2E]"
              : "border-transparent text-white/55 hover:text-[#E8EAF0]"}`}>
            {v === "enriched"
              ? `Batch (${selDone} done)`
              : `${BUCKET_LABEL[v]} (${(counts[v] ?? 0).toLocaleString()})`}
          </Link>
        ))}
      </nav>

      {view === "enriched" ? (
        /* ── Two-pane enrichment view (design 1e) ── */
        rows.length === 0 ? (
          <div className="mt-6 rounded-[18px] border border-dashed border-white/10 p-10 text-center text-sm text-white/55">
            Select top N in the Pitchable tab to build a batch.
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-5 lg:flex-row">
            <ul className="w-full shrink-0 self-start rounded-[18px] border border-white/10 bg-[#1F2329] lg:sticky lg:top-0 lg:max-h-[calc(100dvh-14rem)] lg:w-72 lg:overflow-y-auto">
              {rows.map((c, i) => (
                <li key={c.id} className={`border-b border-white/5 last:border-0 ${person?.id === c.id ? "border-l-2 border-l-[#B6FF2E] bg-white/5" : ""}`}>
                  <Link href={`/batches/${id}?view=enriched&p=${c.id}`}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-white/5">
                    <span className="tnum w-5 text-white/35">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{c.firstName} {c.lastName}</span>
                    {c.flag && <span className="rounded border border-red-400/40 px-1 text-[10px] text-red-300">⚑</span>}
                    <StatusChip s={c.enrichStatus} />
                  </Link>
                </li>
              ))}
            </ul>

            {person && (
              <div className="min-w-0 flex-1 rounded-[18px] border border-white/10 bg-[#1F2329] p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-xl font-semibold">{person.firstName} {person.lastName}</h2>
                  {person.linkedinUrl && (
                    <a href={person.linkedinUrl} target="_blank" className="text-sm text-[#B6FF2E] underline decoration-[#B6FF2E]/40 hover:text-[#9FE51F]">
                      Open profile ↗
                    </a>
                  )}
                  <span className="ml-auto"><StatusChip s={person.enrichStatus} /></span>
                </div>

                {/* Stage A */}
                <h3 className="mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/45">
                  <span className="h-2.5 w-2.5 rounded-sm bg-white/25" /> Stage A — matched from metadata
                </h3>
                <div className="mt-2 grid grid-cols-1 gap-x-8 gap-y-3 rounded-xl border border-white/10 bg-black/20 p-4 text-sm md:grid-cols-2">
                  <div><p className="text-xs text-white/45">Company</p><p className="mt-0.5">{person.companyRaw ?? "—"}</p></div>
                  <div><p className="text-xs text-white/45">Position</p><p className="mt-0.5">{person.positionRaw ?? person.headlineRaw ?? "—"}</p></div>
                  <div><p className="text-xs text-white/45">Provisional service</p><p className="tnum mt-0.5">{person.serviceSlug ?? "—"}</p></div>
                  <div><p className="text-xs text-white/45">Why</p><p className="mt-0.5 text-white/80">{person.matchWhy ?? "—"}</p></div>
                </div>

                {/* Stage B */}
                <h3 className="mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#E7B75F]/80">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#E7B75F]" /> Stage B — read from profile
                </h3>
                {person.enrichStatus === "failed" ? (
                  <div className="mt-2 rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm">
                    <p className="text-red-300">{person.enrichError ?? "Enrichment failed."}</p>
                    <form action={retryPerson.bind(null, id, person.id)} className="mt-3">
                      <button className="rounded-lg border border-red-400/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/15">
                        Retry this person
                      </button>
                    </form>
                  </div>
                ) : person.enrichStatus !== "done" ? (
                  <p className="mt-2 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">
                    {person.enrichStatus === "running" ? "Reading profile now…" : "Queued — press Deep enrich to run."}
                  </p>
                ) : (
                  <div className="mt-2 space-y-5 rounded-xl border border-[#E7B75F]/15 bg-[#E7B75F]/[.04] p-4 text-sm">
                    <div>
                      <p className="text-xs text-[#E7B75F]/70">About — summary</p>
                      <p className="mt-1 text-white/85">{person.aboutSummary ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#E7B75F]/70">
                        Posts{" "}
                        {(person.activityUrl || person.linkedinUrl) && (
                          <a href={person.activityUrl ?? `${person.linkedinUrl?.replace(/\/$/, "")}/recent-activity/all/`}
                            target="_blank" className="text-[#B6FF2E] underline decoration-[#B6FF2E]/40">activity feed ↗</a>
                        )}
                      </p>
                      {person.postsSummary
                        ? <p className="mt-1 text-white/85">{person.postsSummary}</p>
                        : <p className="mt-1 text-[#E7B75F]">No original posts found — summary generated from profile only.</p>}
                    </div>
                    <div>
                      <p className="text-xs text-[#E7B75F]/70">
                        Pain points{" "}
                        {person.painInferred && (
                          <span className="rounded border border-[#E7B75F]/50 px-1.5 py-px text-[10px] text-[#E7B75F]">inferred</span>
                        )}
                      </p>
                      <p className="mt-1 text-white/85">{person.painPoints ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#E7B75F]/70">Service to pitch</p>
                      <p className="mt-1">
                        {person.serviceConfirmed && person.serviceConfirmed !== person.serviceSlug ? (
                          <><span className="tnum text-white/40 line-through">{person.serviceSlug}</span>
                            <span className="mx-1.5 text-white/40">→</span>
                            <span className="tnum text-[#E8EAF0]">{person.serviceConfirmed}</span></>
                        ) : (
                          <span className="tnum">{person.serviceConfirmed ?? person.serviceSlug ?? "—"}</span>
                        )}
                        {person.correctionReason && <span className="text-white/60"> — {person.correctionReason}</span>}
                      </p>
                      {person.flag && (
                        <p className="mt-1.5">
                          <span className="rounded border border-red-400/50 px-1.5 py-px text-[10px] text-red-300">⚑ flag</span>
                          <span className="ml-2 text-white/70">{person.flag}</span>
                        </p>
                      )}
                    </div>
                    {person.outreachMessage && (
                      <div>
                        <p className="text-xs text-[#E7B75F]/70">Outreach message</p>
                        <div className="mt-1.5 rounded-xl border border-white/10 bg-black/30 p-4 text-[15px] leading-relaxed text-[#E8EAF0]">
                          {person.outreachMessage}
                        </div>
                        <div className="mt-2.5 flex items-center gap-3">
                          <CopyButton text={person.outreachMessage} />
                          {person.linkedinUrl && (
                            <a href={person.linkedinUrl} target="_blank" className="text-sm text-[#B6FF2E] underline decoration-[#B6FF2E]/40 hover:text-[#9FE51F]">
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
        <div className="mt-6 rounded-[18px] border border-dashed border-white/10 p-12 text-center">
          {view === "pitchable" && counts.unclassified > 0 ? (
            <>
              <p className="text-[#E8EAF0]">Run matching to classify {counts.unclassified.toLocaleString()} connections into buckets.</p>
              <p className="mt-1 text-sm text-white/45">Rows appear live as they classify — no skeleton table.</p>
            </>
          ) : (
            <p className="text-sm text-white/55">Nothing here yet.</p>
          )}
        </div>
      ) : (
        /* ── Bucket tables ── */
        <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10 bg-[#1F2329]">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/45">
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
            <tbody className="divide-y divide-white/5 align-top">
              {rows.map((c) => {
                const b = c.scoreBreakdownJson;
                return (
                  <tr key={c.id} className={c.selectedForEnrich && view === "pitchable"
                    ? "border-l-2 border-l-[#B6FF2E] bg-[#B6FF2E]/5" : ""}>
                    {view === "pitchable" ? (<>
                      <td className="tnum px-3 py-2.5 text-white/40">{c.rank ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        {c.tier && (
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            c.tier === 1 ? "bg-[#B6FF2E]/20 text-[#B6FF2E]" : "bg-white/10 text-white/60"}`}>
                            T{c.tier}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-medium">
                        {c.linkedinUrl
                          ? <a href={c.linkedinUrl} target="_blank" className="underline decoration-white/20 hover:decoration-[#B6FF2E]">{c.firstName} {c.lastName}</a>
                          : <>{c.firstName} {c.lastName}</>}
                      </td>
                      <td className="px-3 py-2.5">{c.companyRaw}</td>
                      <td className="px-3 py-2.5">{c.positionRaw ?? c.headlineRaw}</td>
                      <td className="px-3 py-2.5">
                        {c.serviceSlug && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/75">{c.serviceSlug}</span>}
                      </td>
                      <td className="relative max-w-sm px-3 py-2.5 text-xs text-white/55">
                        <div className="group">
                          <span className="line-clamp-2">{c.matchWhy}</span>
                          <div className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-[26rem] max-w-[80vw] rounded-xl border border-white/10 bg-[#1F2329]/95 p-3.5 shadow-2xl backdrop-blur group-hover:block">
                            <p className="text-sm text-[#E8EAF0]">{c.matchWhy}</p>
                            {b && (
                              <p className="tnum mt-2 text-white/65">
                                seniority {b.seniority} · function {b.function_fit} · confidence {b.confidence} · founder {b.founder_bonus} · company {b.company_present}
                                {b.service_bonus ? ` · service ${b.service_bonus}` : ""} = {b.total}{c.tier ? ` → T${c.tier}` : ""}
                              </p>
                            )}
                            <span className="mt-2 inline-block rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/60">
                              {c.matchMethod === "rule" ? "rule pass" : c.matchMethod === "manual" ? "manual" : "model pass"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="tnum px-3 py-2.5 text-right text-white/70">{c.score ?? "—"}</td>
                    </>) : (<>
                      <td className="px-3 py-2.5 font-medium">
                        {c.linkedinUrl
                          ? <a href={c.linkedinUrl} target="_blank" className="underline decoration-white/20 hover:decoration-[#B6FF2E]">{c.firstName} {c.lastName}</a>
                          : <>{c.firstName} {c.lastName}</>}
                      </td>
                      <td className="px-3 py-2.5">{c.companyRaw}</td>
                      <td className="px-3 py-2.5">{c.positionRaw ?? c.headlineRaw}</td>
                      <td className="max-w-md px-3 py-2.5 text-xs text-white/55">{c.matchWhy}</td>
                      <td className="px-3 py-2.5 text-right">
                        {(view === "off_icp" || view === "peer_competitor") && (
                          <form action={moveToPitchable.bind(null, id, c.id)}>
                            <button className="whitespace-nowrap text-xs text-white/35 hover:text-[#B6FF2E]">
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
