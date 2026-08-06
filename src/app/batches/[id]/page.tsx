import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, connection, connectionBatch, job } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { AutoRefresh } from "@/app/auto-refresh";
import { bucketCounts } from "@/modules/matching/service-fit";
import { reclassifyAllAction, runClassify, runDeepEnrich, selectTopN } from "./actions";
import { getOrgSettings } from "@/modules/settings/org-settings";

const BUCKET_LABEL: Record<string, string> = {
  pitchable: "Pitchable", off_icp: "Off-ICP", peer_competitor: "Peers", excluded: "Excluded", unclassified: "Unclassified",
};

export default async function BatchPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requirePage();
  const { id } = await props.params;
  const { view = "pitchable" } = await props.searchParams;

  const [batch] = await db.select().from(connectionBatch)
    .where(and(eq(connectionBatch.id, id), eq(connectionBatch.orgId, user.orgId)));
  if (!batch) notFound();

  const counts = await bucketCounts(id);
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const classifiedRows = totalRows - counts.unclassified;
  const { enrichLimit } = await getOrgSettings(user.orgId);
  const defaultN = enrichLimit === "all" ? 30 : Math.min(30, enrichLimit);
  // Only the LATEST job's state matters: a failure that a newer run has
  // since superseded should not haunt the page as a red banner.
  const [latestJob] = await db.select().from(job)
    .where(eq(job.orgId, user.orgId))
    .orderBy(desc(job.createdAt)).limit(1);
  const activeJob = latestJob && (latestJob.status === "running" || latestJob.status === "queued") ? latestJob : undefined;
  const failedJob = latestJob && latestJob.status === "failed" ? latestJob : undefined;

  const rows = await db.select().from(connection)
    .where(and(eq(connection.batchId, id),
      view === "enriched" ? eq(connection.selectedForEnrich, true) : eq(connection.bucket, view)))
    .orderBy(asc(connection.rank), asc(connection.createdAt))
    .limit(400);

  const enrichedDone = rows.filter((r) => r.enrichStatus === "done").length;

  return (
    <Shell user={user} active="connections">
      {activeJob && <AutoRefresh />}
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">{batch.label}</h1>
          <p className="mt-1 text-sm text-[#16191E]/55">
            {Object.entries(counts).filter(([, n]) => n > 0)
              .map(([b, n]) => `${BUCKET_LABEL[b]} ${n}`).join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {counts.unclassified > 0 && (
            <form action={runClassify.bind(null, id)}>
              <button className="rounded bg-[#B6FF2E] px-3 py-2 text-sm font-medium text-[#16191E] hover:bg-[#9FE51F]">
                Run matching ({counts.unclassified})
              </button>
            </form>
          )}
          {counts.unclassified === 0 && classifiedRows > 0 && (
            <form action={runClassify.bind(null, id)}>
              <button title="Recompute scores, tiers and ranks without any model calls — use after scoring or ICP changes."
                className="rounded border border-white/15 px-3 py-2 text-sm text-[#16191E]/70 hover:bg-[#1F2329]/5">
                Re-rank
              </button>
            </form>
          )}
          {classifiedRows > 0 && (
            <form action={reclassifyAllAction.bind(null, id)}>
              <button title="Re-run Stage A on every row, overwriting verdicts — use after editing ICPs or prompts."
                className="rounded border border-white/15 px-3 py-2 text-sm text-[#16191E]/70 hover:bg-[#1F2329]/5">
                Reclassify all
              </button>
            </form>
          )}
          {counts.pitchable > 0 && (
            <form action={selectTopN.bind(null, id)} className="flex items-center gap-2">
              <input name="n" type="number" defaultValue={defaultN} min={1}
                {...(enrichLimit === "all" ? {} : { max: enrichLimit })}
                className="w-16 rounded border border-white/15 px-2 py-2 text-sm" />
              <button className="rounded border border-white/15 px-3 py-2 text-sm font-medium hover:bg-[#1F2329]/5">Select top N</button>
              <Link href="/settings" className="text-xs text-[#16191E]/40 hover:text-[#16191E]/80"
                title="Per-run enrichment cap — change in Settings">
                guardrail {enrichLimit === "all" ? "off" : enrichLimit}
              </Link>
            </form>
          )}
          <form action={runDeepEnrich.bind(null, id)}>
            <button className="rounded border border-[#B6FF2E]/40 bg-[#B6FF2E]/10 px-3 py-2 text-sm font-medium text-[#D9FF8A] hover:bg-[#B6FF2E]/15">
              Deep enrich queued
            </button>
          </form>
          <form action={`/api/export/${id}`} method="get" className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-[#16191E]/55" title="Adds an internal diagnostics tab: score breakdown, confidence, rule/model provenance, enrichment status, flags. Leave off for client-facing exports.">
              <input type="checkbox" name="ops" value="1" className="h-3.5 w-3.5 accent-neutral-900" />
              Ops tab
            </label>
            <button className="rounded bg-[#B6FF2E] px-3 py-2 text-sm font-medium text-[#16191E] hover:bg-[#9FE51F]">
              Export .xlsx
            </button>
          </form>
        </div>
      </div>

      {activeJob && (
        <p className="mt-3 rounded bg-sky-500/10 px-3 py-2 text-sm text-sky-300">
          {activeJob.kind} running — {activeJob.progress}/{activeJob.total}
        </p>
      )}
      {!activeJob && failedJob && (
        <p className="mt-3 rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Last {failedJob.kind} job failed: {failedJob.error}
        </p>
      )}

      <nav className="mt-6 flex gap-3 border-b border-white/10 text-sm">
        {["pitchable", "enriched", "off_icp", "peer_competitor", "excluded"].map((v) => (
          <Link key={v} href={`/batches/${id}?view=${v}`}
            className={`-mb-px border-b-2 px-1 pb-2 ${view === v ? "border-[#B6FF2E] font-medium" : "border-transparent text-[#16191E]/55 hover:text-[#E8EAF0]"}`}>
            {v === "enriched" ? `Batch (${enrichedDone} done)` : BUCKET_LABEL[v]}
          </Link>
        ))}
      </nav>

      <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10 bg-[#1F2329]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#1F2329]/10 text-xs uppercase tracking-wide text-[#16191E]/55">
            <tr>
              <th className="px-3 py-2">#</th><th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Company</th><th className="px-3 py-2">Position</th>
              {view === "enriched"
                ? (<><th className="px-3 py-2">Status</th><th className="px-3 py-2">Service to pitch</th><th className="px-3 py-2">Message</th></>)
                : (<><th className="px-3 py-2">Tier</th><th className="px-3 py-2">Service</th><th className="px-3 py-2">Why</th></>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 align-top">
            {rows.map((c) => (
              <tr key={c.id} className={c.selectedForEnrich && view === "pitchable" ? "bg-[#B6FF2E]/5" : ""}>
                <td className="px-3 py-2 text-[#16191E]/40">{c.rank ?? "—"}</td>
                <td className="px-3 py-2 font-medium">
                  {c.linkedinUrl
                    ? <a href={c.linkedinUrl} target="_blank" className="hover:underline">{c.firstName} {c.lastName}</a>
                    : <>{c.firstName} {c.lastName}</>}
                </td>
                <td className="px-3 py-2">{c.companyRaw}</td>
                <td className="px-3 py-2">{c.positionRaw ?? c.headlineRaw}</td>
                {view === "enriched" ? (<>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      c.enrichStatus === "done" ? "bg-[#B6FF2E]/15 text-[#B6FF2E]"
                      : c.enrichStatus === "failed" ? "bg-red-500/100/15 text-red-300"
                      : "bg-[#1F2329]/10 text-[#16191E]/70"}`}>{c.enrichStatus}</span>
                    {c.flag && <p className="mt-1 text-xs text-red-400">⚑ {c.flag}</p>}
                  </td>
                  <td className="px-3 py-2 text-xs">{c.serviceConfirmed}</td>
                  <td className="max-w-md px-3 py-2 text-xs text-[#16191E]/70">{c.outreachMessage}</td>
                </>) : (<>
                  <td className="px-3 py-2">{c.tier ? `T${c.tier}` : ""}</td>
                  <td className="px-3 py-2 text-xs">{c.serviceSlug}</td>
                  <td className="max-w-md px-3 py-2 text-xs text-[#16191E]/55" title={JSON.stringify(c.scoreBreakdownJson)}>{c.matchWhy}</td>
                </>)}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-[#16191E]/55">
                Nothing here yet{view === "pitchable" ? " — run matching first." : "."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
