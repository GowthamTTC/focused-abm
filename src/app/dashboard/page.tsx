import Link from "next/link";
import { and, desc, eq, gte, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db, connection, connectionBatch, channelAccount, job } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { LedgerStrip } from "@/components/ledger";
import { CopyButton } from "@/components/copy-button";
import { UsageMeter } from "@/components/usage-meter";
import { getDailyEnrichUsage, resetsIn } from "@/modules/enrich/usage";
import { bucketCounts } from "@/modules/matching/service-fit";
import { checkQueuePosts, flagVerdict, markSent, runTodaysTranche, undoSent } from "./actions";
import { retryPerson } from "@/app/batches/[id]/actions";
import { startConnect } from "@/app/settings/actions";

function ago(d: Date): string {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function ActivityBadge({ lastPostAt, asOf }: { lastPostAt: Date | null; asOf: Date | null }) {
  const asOfTxt = asOf ? ` as of ${asOf.toISOString().slice(5, 10)}` : "";
  if (!lastPostAt) {
    return <span className="tnum text-[#2B3355]/35">○ {asOf ? "quiet" : "not captured yet"}<span className="text-[#2B3355]/25">{asOfTxt}</span></span>;
  }
  const days = Math.round((Date.now() - lastPostAt.getTime()) / 86400000);
  if (days <= 7) return <span className="tnum text-[#263BAA]">● posted {Math.max(1, days)}d ago<span className="text-[#2B3355]/25">{asOfTxt}</span></span>;
  if (days <= 30) return <span className="tnum text-[#B07818]">● posted {Math.round(days / 7)}w ago<span className="text-[#2B3355]/25">{asOfTxt}</span></span>;
  return <span className="tnum text-[#2B3355]/35">○ quiet<span className="text-[#2B3355]/25">{asOfTxt}</span></span>;
}

const Soon = ({ children, tip }: { children: React.ReactNode; tip?: string }) => (
  <span title={tip ?? "Coming in a later release."} className="relative inline-flex cursor-default items-center gap-1.5 opacity-35">
    {children}
    <span className="rounded bg-[#263BAA]/10 px-1 py-px text-[9px] uppercase tracking-wide text-[#2B3355]/40">soon</span>
  </span>
);

export default async function DashboardPage({ searchParams }: {
  searchParams: Promise<{ c?: string; sort?: string; qf?: string; qp?: string; fp?: string }>;
}) {
  const user = await requirePage();
  const { c, sort = "activity", qf = "all", qp = "1", fp = "1" } = await searchParams;

  const batches = await db.select().from(connectionBatch)
    .where(eq(connectionBatch.orgId, user.orgId)).orderBy(desc(connectionBatch.createdAt));
  const batch = batches.find((b) => b.id === c) ?? batches[0];

  if (!batch) {
    return (
      <Shell user={user} active="dashboard">
        <div className="rounded-[18px] border border-dashed border-[#263BAA]/12 p-12 text-center text-sm text-[#2B3355]/55">
          No campaign yet — import or sync a network on the <Link href="/connections" className="text-[#263BAA] underline">Data</Link> page.
        </div>
      </Shell>
    );
  }

  const counts = await bucketCounts(batch.id);
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const usage = await getDailyEnrichUsage(user.orgId);
  const capReached = usage.used >= usage.cap;
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const enriched = await db.select().from(connection)
    .where(and(eq(connection.batchId, batch.id), eq(connection.enrichStatus, "done")));
  const recentCut = new Date(Date.now() - 7 * 86400000);
  const readyQueue = enriched
    .filter((p) => p.outreachMessage && !p.outreachStatus &&
      (!p.flag || p.flagVerdict === "variant") && p.flagVerdict !== "dropped" && p.flagVerdict !== "verify")
    .filter((p) => qf === "recent" ? (p.lastPostAt && p.lastPostAt >= recentCut)
      : qf === "older" ? (!p.lastPostAt || p.lastPostAt < recentCut) : true)
    .sort((a, b) => sort === "rank"
      ? (a.rank ?? 9e9) - (b.rank ?? 9e9)
      : (a.tier ?? 9) - (b.tier ?? 9)
        || (b.lastPostAt?.getTime() ?? 0) - (a.lastPostAt?.getTime() ?? 0)
        || (a.rank ?? 9e9) - (b.rank ?? 9e9));
  const flagInbox = enriched.filter((p) => p.flag && !p.flagVerdict);
  const sentList = enriched.filter((p) => p.sentAt).sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime());
  const PAGE = 10;
  const qPage = Math.max(1, Number(qp) || 1), qPages = Math.max(1, Math.ceil(readyQueue.length / PAGE));
  const queueSlice = readyQueue.slice((qPage - 1) * PAGE, qPage * PAGE);
  const fPage = Math.max(1, Number(fp) || 1), fPages = Math.max(1, Math.ceil(flagInbox.length / PAGE));
  const flagSlice = flagInbox.slice((fPage - 1) * PAGE, fPage * PAGE);
  const qs = (over: Record<string, string | number>) => {
    const base: Record<string, string | number> = { c: batch.id, sort, qf, qp: qPage, fp: fPage, ...over };
    return "/dashboard?" + Object.entries(base).map(([k, v]) => `${k}=${v}`).join("&");
  };
  const activeWeek = enriched.filter((p) => p.lastPostAt && p.lastPostAt >= weekAgo).length;
  const sentCount = enriched.filter((p) => p.outreachStatus === "sent").length;

  const [selAgg] = await db.select({
    queued: sql<number>`count(*) filter (where enrich_status in ('queued','running'))::int`,
    failed: sql<number>`count(*) filter (where enrich_status = 'failed')::int`,
    done: sql<number>`count(*) filter (where enrich_status = 'done')::int`,
    total: sql<number>`count(*)::int`,
  }).from(connection).where(and(eq(connection.batchId, batch.id), eq(connection.selectedForEnrich, true)));
  const failedRows = await db.select().from(connection)
    .where(and(eq(connection.batchId, batch.id), eq(connection.enrichStatus, "failed"))).limit(4);
  const [t1Remaining] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.batchId, batch.id), eq(connection.tier, 1), ne(connection.enrichStatus, "done")));

  const seats = await db.select().from(channelAccount).where(eq(channelAccount.orgId, user.orgId));
  const seat = seats.find((s) => s.status === "operational") ?? seats.find((s) => s.status === "needs_reauth");

  const recentJobs = await db.select().from(job)
    .where(eq(job.orgId, user.orgId)).orderBy(desc(job.createdAt)).limit(3);
  type Ev = { at: Date; icon: string; text: string; tone?: string };
  const events: Ev[] = [
    ...recentJobs.map((j): Ev => ({
      at: j.updatedAt, icon: j.status === "failed" ? "✗" : j.status === "done" ? "✓" : "◌",
      tone: j.status === "failed" ? "text-red-600" : "text-[#263BAA]",
      text: `${j.kind === "classify" ? "Matching" : j.kind === "deep_enrich" ? "Enrichment" : j.kind} · ${j.status} · ${j.progress}/${j.total}`,
    })),
    ...enriched.filter((p) => p.flag).slice(0, 3).map((p): Ev => ({
      at: p.enrichedAt ?? new Date(0), icon: "⚑", tone: "text-red-600",
      text: `${p.firstName} ${p.lastName} flagged — ${p.flag}`,
    })),
    ...enriched.filter((p) => p.sentAt).slice(0, 4).map((p): Ev => ({
      at: p.sentAt!, icon: "✓", tone: "text-[#263BAA]", text: `${p.firstName} ${p.lastName} marked sent`,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 7);

  return (
    <Shell user={user} active="dashboard">
      {/* Campaign switcher */}
      <details className="relative inline-block">
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-[#263BAA]/12 bg-white px-4 py-2">
          <span className="font-medium">{batch.label}</span>
          <span className="tnum text-xs text-[#2B3355]/40">{totalRows.toLocaleString()} rows</span>
          <span className="text-[#2B3355]/30">▾</span>
          <span className="text-xs text-[#2B3355]/30">campaign</span>
        </summary>
        <div className="absolute z-30 mt-1 w-72 rounded-xl border border-[#263BAA]/12 bg-white/95 p-1 shadow-2xl backdrop-blur">
          {batches.map((b) => (
            <Link key={b.id} href={`/dashboard?c=${b.id}`}
              className={`block rounded-lg px-3 py-2 text-sm hover:bg-[#263BAA]/5 ${b.id === batch.id ? "text-[#263BAA]" : ""}`}>
              {b.label}
            </Link>
          ))}
        </div>
      </details>

      {/* ① TODAY BAR */}
      <section className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-[18px] border border-[#263BAA]/12 bg-white p-5">
        {([[readyQueue.length, "ready to send", ""], [flagInbox.length, "needs decision", flagInbox.length > 0 ? "text-[#B07818]" : ""], [activeWeek, "active this week", "text-[#263BAA]"]] as const)
          .map(([n, label, tone]) => (
            <div key={label}>
              <p className={`tnum text-2xl ${tone || "text-[#E8EAF0]"}`}>{n}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#2B3355]/40">{label}</p>
            </div>
          ))}
        <div className="min-w-52"><UsageMeter used={usage.used} cap={usage.cap} resetsAt={usage.resetsAt} bar /></div>
        <div className="ml-auto text-right">
          <form action={runTodaysTranche.bind(null, batch.id)}>
            <button disabled={capReached}
              className={capReached
                ? "cursor-not-allowed rounded-xl bg-[#263BAA]/5 px-5 py-3 text-sm font-semibold text-[#2B3355]/30"
                : "rounded-xl bg-[#263BAA] px-5 py-3 text-sm font-semibold text-[#1B2559] shadow-[0_0_28px_rgba(38,59,170,.35)] hover:bg-[#1D2E86]"}>
              Run today's tranche
            </button>
          </form>
          <p className="tnum mt-1.5 text-[11px] text-[#2B3355]/35">
            {capReached ? "daily budget spent — resumes at reset" : "selects next 30 · enriches within today's budget"}
          </p>
        </div>
      </section>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        {/* ② SEND QUEUE */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-medium">Send queue</h2>
            <div className="flex rounded-lg border border-[#263BAA]/12 bg-[#FBF3DE] p-0.5 text-xs">
              {(["activity", "rank"] as const).map((s) => (
                <Link key={s} href={`/dashboard?c=${batch.id}&sort=${s}`}
                  className={`rounded-md px-2.5 py-1 capitalize ${sort === s ? "bg-[#263BAA]/10 text-[#E8EAF0]" : "text-[#2B3355]/45"}`}>{s}</Link>
              ))}
            </div>
            <div className="flex rounded-lg border border-[#263BAA]/12 bg-[#FBF3DE] p-0.5 text-xs">
              {([["all", "All"], ["recent", "Posted ≤7d"], ["older", "Older"]] as const).map(([v, label]) => (
                <Link key={v} href={qs({ qf: v, qp: 1 })}
                  className={`rounded-md px-2.5 py-1 ${qf === v ? "bg-[#263BAA]/10 text-[#E8EAF0]" : "text-[#2B3355]/45"}`}>{label}</Link>
              ))}
            </div>
            <form action={checkQueuePosts.bind(null, batch.id)} className="ml-auto">
              <button className="rounded-lg border border-[#263BAA]/20 px-3 py-1.5 text-xs text-[#2B3355]/70 hover:bg-[#263BAA]/5"
                title="Lightweight scan: posts only, no AI — refreshes the activity badges for everyone in the queue.">
                Check for new posts now
              </button>
            </form>
          </div>
          <div className="mt-3 space-y-3">
            {readyQueue.length === 0 && (
              <div className="rounded-[18px] border border-dashed border-[#263BAA]/12 p-10 text-center text-sm text-[#2B3355]/45">
                Queue clear — run today's tranche or raise N.
              </div>
            )}
            {queueSlice.map((p) => (
              <div key={p.id} className="rounded-[18px] border border-[#263BAA]/12 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2.5 text-sm">
                  <span className="font-medium">{p.firstName} {p.lastName}</span>
                  <span className="text-[#2B3355]/45">{p.companyRaw}</span>
                  {(p.serviceConfirmed ?? p.serviceSlug) && (
                    <span className="rounded bg-[#263BAA]/10 px-1.5 py-0.5 text-[11px] text-[#2B3355]/70">{p.serviceConfirmed ?? p.serviceSlug}</span>
                  )}
                  {p.tier && <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${p.tier === 1 ? "bg-[#263BAA]/20 text-[#263BAA]" : "bg-[#263BAA]/10 text-[#2B3355]/60"}`}>T{p.tier}</span>}
                  {p.flagVerdict === "variant" && <span className="rounded border border-red-500/40 px-1.5 py-0.5 text-[10px] text-red-600">⚑ variant</span>}
                  <span className="ml-auto text-xs"><ActivityBadge lastPostAt={p.lastPostAt} asOf={p.enrichedAt} /></span>
                </div>
                <details className="group mt-2">
                  <summary className="cursor-pointer list-none text-sm leading-relaxed text-[#2B3355]/75">
                    <span className="line-clamp-2 group-open:hidden">{p.outreachMessage}</span>
                    <span className="hidden text-xs text-[#2B3355]/35 group-open:inline">collapse ▴</span>
                  </summary>
                  <div className="mt-2 max-w-xl rounded-xl border border-[#263BAA]/12 bg-[#FBF3DE] p-4 text-[15px] leading-relaxed">
                    {p.outreachMessage}
                  </div>
                </details>
                {p.lastPostAt && p.enrichedAt && p.lastPostAt > p.enrichedAt && (
                  <div className="mt-2 flex items-center justify-between rounded-lg border border-[#B07818]/30 bg-[#B07818]/10 px-3 py-1.5 text-xs text-[#B07818]">
                    new activity since draft — re-run this person
                    <form action={retryPerson.bind(null, batch.id, p.id)}><button className="underline">Re-run</button></form>
                  </div>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <CopyButton text={p.outreachMessage ?? ""} />
                  {p.linkedinUrl && <a href={p.linkedinUrl} target="_blank" className="text-sm text-[#263BAA] underline decoration-[#263BAA]/40">Open profile</a>}
                  <Link href={`/batches/${batch.id}?view=enriched&p=${p.id}`}
                    className="rounded-lg border border-[#263BAA]/20 px-3 py-1.5 text-sm text-[#2B3355]/70 hover:bg-[#263BAA]/5"
                    title="Full record — activities, pain points, Stage A/B analysis">
                    View record
                  </Link>
                  <form action={markSent.bind(null, batch.id, p.id)}>
                    <button className="rounded-lg border border-[#263BAA]/40 px-3 py-1.5 text-sm text-[#263BAA] hover:bg-[#263BAA]/10">Mark sent</button>
                  </form>
                </div>
              </div>
            ))}
            {qPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-1 text-sm">
                {qPage > 1 && <Link href={qs({ qp: qPage - 1 })} className="rounded-lg border border-[#263BAA]/20 px-3 py-1.5 text-[#2B3355]/70 hover:bg-[#263BAA]/5">← Prev</Link>}
                <span className="tnum text-[#2B3355]/40">page {qPage} / {qPages}</span>
                {qPage < qPages && <Link href={qs({ qp: qPage + 1 })} className="rounded-lg border border-[#263BAA]/20 px-3 py-1.5 text-[#2B3355]/70 hover:bg-[#263BAA]/5">Next →</Link>}
              </div>
            )}
            {readyQueue.length > 0 && (
              <div className="pt-1 text-center"><Soon tip="We deliberately never auto-send — a human pressing send protects the seat and the relationship.">Sequence / auto-send</Soon></div>
            )}
          </div>
        </div>

        {/* ③ ATTENTION */}
        <div className="w-full shrink-0 space-y-4 lg:w-80">
          <div className="rounded-[18px] border border-[#263BAA]/12 bg-white p-4">
            <h3 className="text-sm font-medium">Flag inbox <span className="tnum ml-1 text-[#B07818]">{flagInbox.length}</span></h3>
            {flagInbox.length === 0 && <p className="mt-2 text-sm text-[#2B3355]/40">Nothing waiting on a decision.</p>}
            <ul className="mt-2 divide-y divide-[#263BAA]/8">
              {flagSlice.map((p) => (
                <li key={p.id} className="py-3 text-sm">
                  <p className="font-medium">{p.firstName} {p.lastName} <span className="ml-1 rounded border border-red-500/40 px-1 text-[10px] text-red-600">⚑</span></p>
                  <p className="mt-0.5 text-xs text-[#2B3355]/55">{p.flag}</p>
                  <div className="mt-2 flex gap-1.5">
                    {(["dropped", "verify", "variant"] as const).map((v) => (
                      <form key={v} action={flagVerdict.bind(null, batch.id, p.id, v)}>
                        <button className={`rounded-lg border px-2.5 py-1 text-xs ${v === "variant"
                          ? "border-[#263BAA]/40 text-[#263BAA] hover:bg-[#263BAA]/10"
                          : "border-[#263BAA]/20 text-[#2B3355]/70 hover:bg-[#263BAA]/5"}`}>
                          {v === "dropped" ? "Drop" : v === "verify" ? "Verify" : "Send variant"}
                        </button>
                      </form>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {fPages > 1 && (
              <div className="mt-2 flex items-center justify-between text-xs">
                {fPage > 1 ? <Link href={qs({ fp: fPage - 1 })} className="text-[#2B3355]/60 hover:text-[#1B2559]">← Prev</Link> : <span />}
                <span className="tnum text-[#2B3355]/35">{fPage} / {fPages}</span>
                {fPage < fPages ? <Link href={qs({ fp: fPage + 1 })} className="text-[#2B3355]/60 hover:text-[#1B2559]">Next →</Link> : <span />}
              </div>
            )}
          </div>

          {/* SENT — with undo */}
          <div className="rounded-[18px] border border-[#263BAA]/12 bg-white p-4">
            <h3 className="text-sm font-medium">Sent <span className="tnum ml-1 text-[#263BAA]">{sentList.length}</span></h3>
            {sentList.length === 0 && <p className="mt-2 text-sm text-[#2B3355]/40">Nothing marked sent yet.</p>}
            <ul className="mt-2 divide-y divide-[#263BAA]/8">
              {sentList.slice(0, 10).map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.firstName} {p.lastName}</p>
                    <p className="truncate text-xs text-[#2B3355]/40">{p.companyRaw} · {p.sentAt!.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
                  </div>
                  <form action={undoSent.bind(null, batch.id, p.id)}>
                    <button className="rounded-lg border border-[#263BAA]/20 px-2.5 py-1 text-xs text-[#2B3355]/70 hover:bg-[#263BAA]/5"
                      title="Back to the send queue">Undo</button>
                  </form>
                </li>
              ))}
            </ul>
            {sentList.length > 10 && <p className="mt-2 text-xs text-[#2B3355]/35">Showing latest 10 of {sentList.length}.</p>}
          </div>
          {failedRows.length > 0 && (
            <div className="rounded-[18px] border border-red-500/25 bg-red-500/5 p-4 text-sm">
              <h3 className="font-medium text-red-600">Failed <span className="tnum ml-1">{selAgg?.failed ?? failedRows.length}</span></h3>
              {failedRows.map((p) => (
                <p key={p.id} className="mt-2 text-xs text-[#2B3355]/60">
                  {p.firstName} {p.lastName} — {p.enrichError?.slice(0, 44)}…{" "}
                  <form action={retryPerson.bind(null, batch.id, p.id)} className="inline"><button className="text-red-600 underline">Retry</button></form>
                </p>
              ))}
            </div>
          )}
          {seat && (
            <div className="flex items-center justify-between rounded-[18px] border border-[#263BAA]/12 bg-white p-4 text-sm">
              <span className="tnum truncate">{seat.displayName ?? seat.unipileAccountId}</span>
              <span className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${seat.status === "operational" ? "bg-[#263BAA]/15 text-[#263BAA]" : "bg-[#B07818]/15 text-[#B07818]"}`}>
                  {seat.status === "operational" ? "operational" : "needs re-auth"}
                </span>
                {seat.status !== "operational" && (
                  <form action={startConnect}><button className="rounded-lg border border-[#263BAA]/20 px-2.5 py-1 text-xs">Reconnect</button></form>
                )}
              </span>
            </div>
          )}
          {capReached && (selAgg?.queued ?? 0) > 0 && (
            <div className="tnum rounded-[18px] border border-[#263BAA]/12 bg-white p-4 text-sm text-[#2B3355]/60">
              {selAgg.queued} queued — waiting for daily reset ({resetsIn(usage.resetsAt)})
            </div>
          )}
          <div className="flex items-center justify-between rounded-[18px] border border-[#263BAA]/12 bg-white p-4 text-sm">
            <Soon tip="Reading replies needs inbox access through the seat — a later release.">Auto-detect replies</Soon>
            <span className="h-4 w-8 rounded-full bg-[#263BAA]/10 opacity-35" />
          </div>
        </div>
      </div>

      {/* ④ FUNNEL */}
      <section className="mt-6 rounded-[18px] border border-[#263BAA]/12 bg-white p-5">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          {([["Imported", totalRows], ["Pitchable", counts.pitchable], ["Enriched", selAgg?.done ?? 0], ["Messaged", sentCount]] as const)
            .map(([label, n], i) => (
              <span key={label} className="flex items-baseline gap-2">
                {i > 0 && <span className="text-[#2B3355]/20">→</span>}
                <span className="tnum text-xl">{n.toLocaleString()}</span>
                <span className="text-xs text-[#2B3355]/45">{label}</span>
              </span>
            ))}
          <span className="flex items-baseline gap-2"><span className="text-[#2B3355]/20">→</span>
            <Soon tip="Coming in a later release — replies are marked manually for now."><span className="tnum text-xl">—</span><span className="text-xs">Replied</span></Soon>
          </span>
          <span className="tnum ml-auto text-sm text-[#263BAA]">T1 remaining {t1Remaining?.n ?? 0}</span>
        </div>
        <LedgerStrip className="mt-4" counts={{
          topDone: selAgg?.done ?? 0, topPending: (selAgg?.total ?? 0) - (selAgg?.done ?? 0),
          pitchable: Math.max(0, counts.pitchable - (selAgg?.total ?? 0)),
          peers: counts.peer_competitor, offIcp: counts.off_icp, excluded: counts.excluded, unclassified: counts.unclassified,
        }} />
        <p className="mt-1.5 text-xs text-[#2B3355]/30">one tick per person, rank order — lime Top-N ignites as enrichment completes</p>
      </section>

      {/* ⑤ ACTIVITY FEED */}
      {events.length > 0 && (
        <section className="mt-6 rounded-[18px] border border-[#263BAA]/12 bg-white">
          <ul className="divide-y divide-[#263BAA]/8">
            {events.map((e, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className={e.tone ?? "text-[#2B3355]/40"}>{e.icon}</span>
                <span className="min-w-0 flex-1 truncate text-[#2B3355]/75">{e.text}</span>
                <span className="tnum shrink-0 text-xs text-[#2B3355]/30">{ago(e.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}
