import Link from "next/link";
import { and, desc, eq, gte, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db, connection, connectionBatch, channelAccount, job } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { LedgerStrip } from "@/components/ledger";
import { CopyButton } from "@/components/copy-button";
import { UsageMeter } from "@/components/usage-meter";
import { getDailyEnrichUsage, resetsIn } from "@/modules/enrich/usage";
import { bucketCounts } from "@/modules/matching/service-fit";
import { flagVerdict, markSent, runTodaysTranche } from "./actions";
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
    return <span className="tnum text-white/35">○ {asOf ? "quiet" : "not captured yet"}<span className="text-white/25">{asOfTxt}</span></span>;
  }
  const days = Math.round((Date.now() - lastPostAt.getTime()) / 86400000);
  if (days <= 7) return <span className="tnum text-[#B6FF2E]">● posted {Math.max(1, days)}d ago<span className="text-white/25">{asOfTxt}</span></span>;
  if (days <= 30) return <span className="tnum text-[#E7B75F]">● posted {Math.round(days / 7)}w ago<span className="text-white/25">{asOfTxt}</span></span>;
  return <span className="tnum text-white/35">○ quiet<span className="text-white/25">{asOfTxt}</span></span>;
}

const Soon = ({ children, tip }: { children: React.ReactNode; tip?: string }) => (
  <span title={tip ?? "Coming in a later release."} className="relative inline-flex cursor-default items-center gap-1.5 opacity-35">
    {children}
    <span className="rounded bg-white/10 px-1 py-px text-[9px] uppercase tracking-wide text-white/40">soon</span>
  </span>
);

export default async function DashboardPage({ searchParams }: {
  searchParams: Promise<{ c?: string; sort?: string }>;
}) {
  const user = await requirePage();
  const { c, sort = "activity" } = await searchParams;

  const batches = await db.select().from(connectionBatch)
    .where(eq(connectionBatch.orgId, user.orgId)).orderBy(desc(connectionBatch.createdAt));
  const batch = batches.find((b) => b.id === c) ?? batches[0];

  if (!batch) {
    return (
      <Shell user={user} active="dashboard">
        <div className="rounded-[18px] border border-dashed border-white/10 p-12 text-center text-sm text-white/55">
          No campaign yet — import or sync a network on the <Link href="/connections" className="text-[#B6FF2E] underline">Data</Link> page.
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
  const readyQueue = enriched
    .filter((p) => p.outreachMessage && !p.outreachStatus &&
      (!p.flag || p.flagVerdict === "variant") && p.flagVerdict !== "dropped" && p.flagVerdict !== "verify")
    .sort((a, b) => sort === "rank"
      ? (a.rank ?? 9e9) - (b.rank ?? 9e9)
      : (a.tier ?? 9) - (b.tier ?? 9)
        || (b.lastPostAt?.getTime() ?? 0) - (a.lastPostAt?.getTime() ?? 0)
        || (a.rank ?? 9e9) - (b.rank ?? 9e9));
  const flagInbox = enriched.filter((p) => p.flag && !p.flagVerdict);
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
      tone: j.status === "failed" ? "text-red-300" : "text-[#B6FF2E]",
      text: `${j.kind === "classify" ? "Matching" : j.kind === "deep_enrich" ? "Enrichment" : j.kind} · ${j.status} · ${j.progress}/${j.total}`,
    })),
    ...enriched.filter((p) => p.flag).slice(0, 3).map((p): Ev => ({
      at: p.enrichedAt ?? new Date(0), icon: "⚑", tone: "text-red-300",
      text: `${p.firstName} ${p.lastName} flagged — ${p.flag}`,
    })),
    ...enriched.filter((p) => p.sentAt).slice(0, 4).map((p): Ev => ({
      at: p.sentAt!, icon: "✓", tone: "text-[#B6FF2E]", text: `${p.firstName} ${p.lastName} marked sent`,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 7);

  return (
    <Shell user={user} active="dashboard">
      {/* Campaign switcher */}
      <details className="relative inline-block">
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-white/10 bg-[#1F2329] px-4 py-2">
          <span className="font-medium">{batch.label}</span>
          <span className="tnum text-xs text-white/40">{totalRows.toLocaleString()} rows</span>
          <span className="text-white/30">▾</span>
          <span className="text-xs text-white/30">campaign</span>
        </summary>
        <div className="absolute z-30 mt-1 w-72 rounded-xl border border-white/10 bg-[#1F2329]/95 p-1 shadow-2xl backdrop-blur">
          {batches.map((b) => (
            <Link key={b.id} href={`/dashboard?c=${b.id}`}
              className={`block rounded-lg px-3 py-2 text-sm hover:bg-white/5 ${b.id === batch.id ? "text-[#B6FF2E]" : ""}`}>
              {b.label}
            </Link>
          ))}
        </div>
      </details>

      {/* ① TODAY BAR */}
      <section className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-[18px] border border-white/10 bg-[#1F2329] p-5">
        {([[readyQueue.length, "ready to send", ""], [flagInbox.length, "needs decision", flagInbox.length > 0 ? "text-[#E7B75F]" : ""], [activeWeek, "active this week", "text-[#B6FF2E]"]] as const)
          .map(([n, label, tone]) => (
            <div key={label}>
              <p className={`tnum text-2xl ${tone || "text-[#E8EAF0]"}`}>{n}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wider text-white/40">{label}</p>
            </div>
          ))}
        <div className="min-w-52"><UsageMeter used={usage.used} cap={usage.cap} resetsAt={usage.resetsAt} bar /></div>
        <div className="ml-auto text-right">
          <form action={runTodaysTranche.bind(null, batch.id)}>
            <button disabled={capReached}
              className={capReached
                ? "cursor-not-allowed rounded-xl bg-white/5 px-5 py-3 text-sm font-semibold text-white/30"
                : "rounded-xl bg-[#B6FF2E] px-5 py-3 text-sm font-semibold text-[#16191E] shadow-[0_0_28px_rgba(182,255,46,.35)] hover:bg-[#9FE51F]"}>
              Run today's tranche
            </button>
          </form>
          <p className="tnum mt-1.5 text-[11px] text-white/35">
            {capReached ? "daily budget spent — resumes at reset" : "selects next 30 · enriches within today's budget"}
          </p>
        </div>
      </section>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        {/* ② SEND QUEUE */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-medium">Send queue</h2>
            <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5 text-xs">
              {(["activity", "rank"] as const).map((s) => (
                <Link key={s} href={`/dashboard?c=${batch.id}&sort=${s}`}
                  className={`rounded-md px-2.5 py-1 capitalize ${sort === s ? "bg-white/10 text-[#E8EAF0]" : "text-white/45"}`}>{s}</Link>
              ))}
            </div>
            <span className="ml-auto"><Soon tip="Live activity refresh comes in a later release — badges show the enrichment-time snapshot.">Check for new posts now</Soon></span>
          </div>
          <div className="mt-3 space-y-3">
            {readyQueue.length === 0 && (
              <div className="rounded-[18px] border border-dashed border-white/10 p-10 text-center text-sm text-white/45">
                Queue clear — run today's tranche or raise N.
              </div>
            )}
            {readyQueue.slice(0, 25).map((p) => (
              <div key={p.id} className="rounded-[18px] border border-white/10 bg-[#1F2329] p-4">
                <div className="flex flex-wrap items-center gap-2.5 text-sm">
                  <span className="font-medium">{p.firstName} {p.lastName}</span>
                  <span className="text-white/45">{p.companyRaw}</span>
                  {(p.serviceConfirmed ?? p.serviceSlug) && (
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">{p.serviceConfirmed ?? p.serviceSlug}</span>
                  )}
                  {p.tier && <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${p.tier === 1 ? "bg-[#B6FF2E]/20 text-[#B6FF2E]" : "bg-white/10 text-white/60"}`}>T{p.tier}</span>}
                  {p.flagVerdict === "variant" && <span className="rounded border border-red-400/40 px-1.5 py-0.5 text-[10px] text-red-300">⚑ variant</span>}
                  <span className="ml-auto text-xs"><ActivityBadge lastPostAt={p.lastPostAt} asOf={p.enrichedAt} /></span>
                </div>
                <details className="group mt-2">
                  <summary className="cursor-pointer list-none text-sm leading-relaxed text-white/75">
                    <span className="line-clamp-2 group-open:hidden">{p.outreachMessage}</span>
                    <span className="hidden text-xs text-white/35 group-open:inline">collapse ▴</span>
                  </summary>
                  <div className="mt-2 max-w-xl rounded-xl border border-white/10 bg-black/30 p-4 text-[15px] leading-relaxed">
                    {p.outreachMessage}
                  </div>
                </details>
                {p.lastPostAt && p.enrichedAt && p.lastPostAt > p.enrichedAt && (
                  <div className="mt-2 flex items-center justify-between rounded-lg border border-[#E7B75F]/30 bg-[#E7B75F]/10 px-3 py-1.5 text-xs text-[#E7B75F]">
                    new activity since draft — re-run this person
                    <form action={retryPerson.bind(null, batch.id, p.id)}><button className="underline">Re-run</button></form>
                  </div>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <CopyButton text={p.outreachMessage ?? ""} />
                  {p.linkedinUrl && <a href={p.linkedinUrl} target="_blank" className="text-sm text-[#B6FF2E] underline decoration-[#B6FF2E]/40">Open profile</a>}
                  <Link href={`/batches/${batch.id}?view=enriched&p=${p.id}`}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5"
                    title="Full record — activities, pain points, Stage A/B analysis">
                    View record
                  </Link>
                  <form action={markSent.bind(null, batch.id, p.id)}>
                    <button className="rounded-lg border border-[#B6FF2E]/40 px-3 py-1.5 text-sm text-[#D9FF8A] hover:bg-[#B6FF2E]/10">Mark sent</button>
                  </form>
                </div>
              </div>
            ))}
            {readyQueue.length > 0 && (
              <div className="pt-1 text-center"><Soon tip="We deliberately never auto-send — a human pressing send protects the seat and the relationship.">Sequence / auto-send</Soon></div>
            )}
          </div>
        </div>

        {/* ③ ATTENTION */}
        <div className="w-full shrink-0 space-y-4 lg:w-80">
          <div className="rounded-[18px] border border-white/10 bg-[#1F2329] p-4">
            <h3 className="text-sm font-medium">Flag inbox <span className="tnum ml-1 text-[#E7B75F]">{flagInbox.length}</span></h3>
            {flagInbox.length === 0 && <p className="mt-2 text-sm text-white/40">Nothing waiting on a decision.</p>}
            <ul className="mt-2 divide-y divide-white/5">
              {flagInbox.map((p) => (
                <li key={p.id} className="py-3 text-sm">
                  <p className="font-medium">{p.firstName} {p.lastName} <span className="ml-1 rounded border border-red-400/40 px-1 text-[10px] text-red-300">⚑</span></p>
                  <p className="mt-0.5 text-xs text-white/55">{p.flag}</p>
                  <div className="mt-2 flex gap-1.5">
                    {(["dropped", "verify", "variant"] as const).map((v) => (
                      <form key={v} action={flagVerdict.bind(null, batch.id, p.id, v)}>
                        <button className={`rounded-lg border px-2.5 py-1 text-xs ${v === "variant"
                          ? "border-[#B6FF2E]/40 text-[#D9FF8A] hover:bg-[#B6FF2E]/10"
                          : "border-white/15 text-white/70 hover:bg-white/5"}`}>
                          {v === "dropped" ? "Drop" : v === "verify" ? "Verify" : "Send variant"}
                        </button>
                      </form>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {failedRows.length > 0 && (
            <div className="rounded-[18px] border border-red-500/25 bg-red-500/5 p-4 text-sm">
              <h3 className="font-medium text-red-300">Failed <span className="tnum ml-1">{selAgg?.failed ?? failedRows.length}</span></h3>
              {failedRows.map((p) => (
                <p key={p.id} className="mt-2 text-xs text-white/60">
                  {p.firstName} {p.lastName} — {p.enrichError?.slice(0, 44)}…{" "}
                  <form action={retryPerson.bind(null, batch.id, p.id)} className="inline"><button className="text-red-300 underline">Retry</button></form>
                </p>
              ))}
            </div>
          )}
          {seat && (
            <div className="flex items-center justify-between rounded-[18px] border border-white/10 bg-[#1F2329] p-4 text-sm">
              <span className="tnum truncate">{seat.displayName ?? seat.unipileAccountId}</span>
              <span className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${seat.status === "operational" ? "bg-[#B6FF2E]/15 text-[#B6FF2E]" : "bg-[#E7B75F]/15 text-[#E7B75F]"}`}>
                  {seat.status === "operational" ? "operational" : "needs re-auth"}
                </span>
                {seat.status !== "operational" && (
                  <form action={startConnect}><button className="rounded-lg border border-white/15 px-2.5 py-1 text-xs">Reconnect</button></form>
                )}
              </span>
            </div>
          )}
          {capReached && (selAgg?.queued ?? 0) > 0 && (
            <div className="tnum rounded-[18px] border border-white/10 bg-[#1F2329] p-4 text-sm text-white/60">
              {selAgg.queued} queued — waiting for daily reset ({resetsIn(usage.resetsAt)})
            </div>
          )}
          <div className="flex items-center justify-between rounded-[18px] border border-white/10 bg-[#1F2329] p-4 text-sm">
            <Soon tip="Reading replies needs inbox access through the seat — a later release.">Auto-detect replies</Soon>
            <span className="h-4 w-8 rounded-full bg-white/10 opacity-35" />
          </div>
        </div>
      </div>

      {/* ④ FUNNEL */}
      <section className="mt-6 rounded-[18px] border border-white/10 bg-[#1F2329] p-5">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          {([["Imported", totalRows], ["Pitchable", counts.pitchable], ["Enriched", selAgg?.done ?? 0], ["Messaged", sentCount]] as const)
            .map(([label, n], i) => (
              <span key={label} className="flex items-baseline gap-2">
                {i > 0 && <span className="text-white/20">→</span>}
                <span className="tnum text-xl">{n.toLocaleString()}</span>
                <span className="text-xs text-white/45">{label}</span>
              </span>
            ))}
          <span className="flex items-baseline gap-2"><span className="text-white/20">→</span>
            <Soon tip="Coming in a later release — replies are marked manually for now."><span className="tnum text-xl">—</span><span className="text-xs">Replied</span></Soon>
          </span>
          <span className="tnum ml-auto text-sm text-[#B6FF2E]">T1 remaining {t1Remaining?.n ?? 0}</span>
        </div>
        <LedgerStrip className="mt-4" counts={{
          topDone: selAgg?.done ?? 0, topPending: (selAgg?.total ?? 0) - (selAgg?.done ?? 0),
          pitchable: Math.max(0, counts.pitchable - (selAgg?.total ?? 0)),
          peers: counts.peer_competitor, offIcp: counts.off_icp, excluded: counts.excluded, unclassified: counts.unclassified,
        }} />
        <p className="mt-1.5 text-xs text-white/30">one tick per person, rank order — lime Top-N ignites as enrichment completes</p>
      </section>

      {/* ⑤ ACTIVITY FEED */}
      {events.length > 0 && (
        <section className="mt-6 rounded-[18px] border border-white/10 bg-[#1F2329]">
          <ul className="divide-y divide-white/5">
            {events.map((e, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className={e.tone ?? "text-white/40"}>{e.icon}</span>
                <span className="min-w-0 flex-1 truncate text-white/75">{e.text}</span>
                <span className="tnum shrink-0 text-xs text-white/30">{ago(e.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}
