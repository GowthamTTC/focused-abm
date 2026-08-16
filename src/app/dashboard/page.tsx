import Link from "next/link";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db, connection, channelAccount, job } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { LedgerStrip } from "@/components/ledger";
import { UsageMeter } from "@/components/usage-meter";
import { ago, Soon, CampaignSwitcher, NoCampaign, resolveBatch } from "@/components/dash-bits";
import { getDailyEnrichUsage, resetsIn } from "@/modules/enrich/usage";
import { bucketCounts } from "@/modules/matching/service-fit";
import { runTodaysTranche } from "./actions";
import { startConnect } from "@/app/settings/actions";

export default async function DashboardPage({ searchParams }: {
  searchParams: Promise<{ c?: string }>;
}) {
  const user = await requirePage();
  const { c } = await searchParams;
  const { batch, batches } = await resolveBatch(user.orgId, c);
  if (!batch) return <Shell user={user} active="dashboard"><NoCampaign /></Shell>;

  const counts = await bucketCounts(batch.id);
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const usage = await getDailyEnrichUsage(user.orgId);
  const capReached = usage.used >= usage.cap;
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const enriched = await db.select().from(connection)
    .where(and(eq(connection.batchId, batch.id), eq(connection.enrichStatus, "done")));
  const readyCount = enriched.filter((p) => p.outreachMessage && !p.outreachStatus &&
    (!p.flag || p.flagVerdict === "variant") && p.flagVerdict !== "dropped" && p.flagVerdict !== "verify").length;
  const flagCount = enriched.filter((p) => p.flag && !p.flagVerdict).length;
  const activeWeek = enriched.filter((p) => p.lastPostAt && p.lastPostAt >= weekAgo).length;
  const sentCount = enriched.filter((p) => p.sentAt).length;

  const [selAgg] = await db.select({
    queued: sql<number>`count(*) filter (where enrich_status in ('queued','running'))::int`,
    failed: sql<number>`count(*) filter (where enrich_status = 'failed')::int`,
    done: sql<number>`count(*) filter (where enrich_status = 'done')::int`,
    total: sql<number>`count(*)::int`,
  }).from(connection).where(and(eq(connection.batchId, batch.id), eq(connection.selectedForEnrich, true)));
  const [t1Remaining] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.batchId, batch.id), eq(connection.tier, 1), ne(connection.enrichStatus, "done")));

  const seats = await db.select().from(channelAccount).where(eq(channelAccount.orgId, user.orgId));
  const seat = seats.find((s) => s.status === "operational") ?? seats.find((s) => s.status === "needs_reauth");

  const recentJobs = await db.select().from(job)
    .where(eq(job.orgId, user.orgId)).orderBy(desc(job.createdAt)).limit(4);
  type Ev = { at: Date; icon: string; text: string; tone?: string };
  const events: Ev[] = [
    ...recentJobs.map((j): Ev => ({
      at: j.updatedAt, icon: j.status === "failed" ? "✗" : j.status === "done" ? "✓" : "◌",
      tone: j.status === "failed" ? "text-[#B42318]" : "text-[#263BAA]",
      text: `${j.kind === "classify" ? "Matching" : j.kind === "deep_enrich" ? "Research" : j.kind === "activity_scan" ? "Post scan" : j.kind} · ${j.status} · ${j.progress}/${j.total}`,
    })),
    ...enriched.filter((p) => p.sentAt).slice(0, 4).map((p): Ev => ({
      at: p.sentAt!, icon: "✓", tone: "text-[#263BAA]", text: `${p.firstName} ${p.lastName} marked sent`,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 6);

  const stats: [n: number, label: string, href: string | null, tone?: string][] = [
    [readyCount, "ready to send", `/review?tab=ready&c=${batch.id}`],
    [flagCount, "needs decision", `/review?tab=decisions&c=${batch.id}`, flagCount > 0 ? "text-[#B54708]" : undefined],
    [sentCount, "sent", `/review?tab=ready&c=${batch.id}`],
    [activeWeek, "active this week", null, "text-[#263BAA]"],
    [selAgg?.failed ?? 0, "failed", (selAgg?.failed ?? 0) > 0 ? `/review?tab=ready&c=${batch.id}` : null, (selAgg?.failed ?? 0) > 0 ? "text-[#B42318]" : undefined],
  ];

  return (
    <Shell user={user} active="dashboard">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <CampaignSwitcher batches={batches} batch={batch} basePath="/dashboard" totalRows={totalRows} />
      </div>

      {/* NUMBERS — the work lives in Ready to send and Decisions */}
      <section className="bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] mt-4 rounded-[14px] p-5">
        <div className="flex flex-wrap items-center gap-x-9 gap-y-4">
          {stats.map(([n, label, href, tone]) => {
            const body = (
              <>
                <p className={`tnum text-[26px] leading-8 ${tone ?? "text-[#101828]"}`}>{n.toLocaleString()}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#98A2B3]">
                  {label}{href && <span className="ml-1 text-[#263BAA]/60">→</span>}
                </p>
              </>
            );
            return href
              ? <Link key={label} href={href} className="group rounded-[8px] px-1 transition hover:bg-[#F4F6FB]">{body}</Link>
              : <div key={label} className="px-1">{body}</div>;
          })}
          <div className="min-w-52"><UsageMeter used={usage.used} cap={usage.cap} resetsAt={usage.resetsAt} bar /></div>
          <div className="ml-auto text-right">
            <form action={runTodaysTranche.bind(null, batch.id)}>
              <button disabled={capReached}
                className={capReached
                  ? "cursor-not-allowed rounded-[10px] bg-[#F4F6FB] px-5 py-3 text-sm font-semibold text-[#98A2B3]"
                  : "rounded-[10px] bg-[#263BAA] px-5 py-3 text-sm font-semibold text-white hover:bg-[#1D2E86]"}>
                Research next 30
              </button>
            </form>
            <p className="tnum mt-1.5 text-[11px] text-[#98A2B3]">
              {capReached ? "today's run limit is spent — resumes at reset" : "researches the next 30 · within today's run limit"}
            </p>
          </div>
        </div>
      </section>

      {/* FUNNEL */}
      <section className="bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] mt-4 rounded-[14px] p-5">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          {([["Imported", totalRows], ["Matched", counts.pitchable], ["Researched", selAgg?.done ?? 0], ["Messaged", sentCount]] as const)
            .map(([label, n], i) => (
              <span key={label} className="flex items-baseline gap-2">
                {i > 0 && <span className="text-[#98A2B3]">→</span>}
                <span className="tnum text-xl">{n.toLocaleString()}</span>
                <span className="text-xs text-[#98A2B3]">{label}</span>
              </span>
            ))}
          <span className="flex items-baseline gap-2"><span className="text-[#98A2B3]">→</span>
            <Soon tip="Coming in a later release — replies are marked manually for now."><span className="tnum text-xl">—</span><span className="text-xs">Replied</span></Soon>
          </span>
          <span className="tnum ml-auto text-sm text-[#263BAA]">T1 remaining {t1Remaining?.n ?? 0}</span>
        </div>
        <LedgerStrip className="mt-4" counts={{
          topDone: selAgg?.done ?? 0, topPending: (selAgg?.total ?? 0) - (selAgg?.done ?? 0),
          pitchable: Math.max(0, counts.pitchable - (selAgg?.total ?? 0)),
          peers: counts.peer_competitor, offIcp: counts.off_icp, excluded: counts.excluded, unclassified: counts.unclassified,
        }} />
        <p className="mt-1.5 text-xs text-[#98A2B3]">one tick per person, rank order — indigo Top-N ignites as research completes</p>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* ACTIVITY FEED */}
        <section className="bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <ul className="divide-y divide-[#EEF1F8]">
            {events.map((e, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className={e.tone ?? "text-[#98A2B3]"}>{e.icon}</span>
                <span className="min-w-0 flex-1 truncate text-[#475467]">{e.text}</span>
                <span className="tnum shrink-0 text-xs text-[#98A2B3]">{ago(e.at)}</span>
              </li>
            ))}
            {events.length === 0 && <li className="px-4 py-3 text-sm text-[#98A2B3]">No activity yet.</li>}
          </ul>
        </section>

        <div className="space-y-4 self-start">
          {seat && (
            <div className="bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] flex items-center justify-between rounded-[14px] p-4 text-sm">
              <span className="tnum truncate">{seat.displayName ?? seat.unipileAccountId}</span>
              <span className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${seat.status === "operational" ? "bg-[#EEF1FC] text-[#263BAA]" : "bg-[#FDF6E7] text-[#B54708]"}`}>
                  {seat.status === "operational" ? "operational" : "needs re-auth"}
                </span>
                {seat.status !== "operational" && (
                  <form action={startConnect}><button className="rounded-[8px] border border-[#DDE2EE] px-2.5 py-1 text-xs">Reconnect</button></form>
                )}
              </span>
            </div>
          )}
          {capReached && (selAgg?.queued ?? 0) > 0 && (
            <div className="tnum bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 text-sm text-[#475467]">
              {selAgg.queued} queued — waiting for daily reset ({resetsIn(usage.resetsAt)})
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
