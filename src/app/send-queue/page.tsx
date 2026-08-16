import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, connection, channelAccount } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { CopyButton } from "@/components/copy-button";
import { ActivityBadge, Soon, CampaignSwitcher, NoCampaign, resolveBatch } from "@/components/dash-bits";
import { checkQueuePosts, markSent, undoSent } from "@/app/dashboard/actions";
import { retryPerson } from "@/app/batches/[id]/actions";

export default async function SendQueuePage({ searchParams }: {
  searchParams: Promise<{ c?: string; sort?: string; qf?: string; qp?: string }>;
}) {
  const user = await requirePage();
  const { c, sort = "activity", qf = "all", qp = "1" } = await searchParams;
  const { batch, batches } = await resolveBatch(user.orgId, c);
  if (!batch) return <Shell user={user} active="queue"><NoCampaign /></Shell>;

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
  const sentList = enriched.filter((p) => p.sentAt).sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime());
  const failedRows = await db.select().from(connection)
    .where(and(eq(connection.batchId, batch.id), eq(connection.enrichStatus, "failed"))).limit(4);
  const seats = await db.select().from(channelAccount).where(eq(channelAccount.orgId, user.orgId));
  const seat = seats.find((s) => s.status === "operational") ?? seats.find((s) => s.status === "needs_reauth");
  void seat;
  const PAGE = 10;
  const qPage = Math.max(1, Number(qp) || 1), qPages = Math.max(1, Math.ceil(readyQueue.length / PAGE));
  const queueSlice = readyQueue.slice((qPage - 1) * PAGE, qPage * PAGE);
  const qs = (over: Record<string, string | number>) => {
    const base: Record<string, string | number> = { c: batch.id, sort, qf, qp: qPage, ...over };
    return "/send-queue?" + Object.entries(base).map(([k, v]) => `${k}=${v}`).join("&");
  };

  return (
    <Shell user={user} active="queue">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Send Queue <span className="tnum ml-2 text-[#263BAA]">{readyQueue.length}</span></h1>
        <CampaignSwitcher batches={batches} batch={batch} basePath="/send-queue" />
      </div>
      <div className="mt-4 flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-medium">Send queue</h2>
            <div className="flex rounded-lg glass border-0 p-0.5 text-xs">
              {(["activity", "rank"] as const).map((s) => (
                <Link key={s} href={qs({ sort: s, qp: 1 })}
                  className={`rounded-md px-2.5 py-1 capitalize ${sort === s ? "bg-[#263BAA]/10 text-[#14204A]" : "text-[#46506E]/45"}`}>{s}</Link>
              ))}
            </div>
            <div className="flex rounded-lg glass border-0 p-0.5 text-xs">
              {([["all", "All"], ["recent", "Posted ≤7d"], ["older", "Older"]] as const).map(([v, label]) => (
                <Link key={v} href={qs({ qf: v, qp: 1 })}
                  className={`rounded-md px-2.5 py-1 ${qf === v ? "bg-[#263BAA]/10 text-[#14204A]" : "text-[#46506E]/45"}`}>{label}</Link>
              ))}
            </div>
            <form action={checkQueuePosts.bind(null, batch.id)} className="ml-auto">
              <button className="rounded-lg border border-[#D0D5E4] px-3 py-1.5 text-xs text-[#46506E]/70 hover:bg-[#263BAA]/5"
                title="Lightweight scan: posts only, no AI — refreshes the activity badges for everyone in the queue.">
                Check for new posts now
              </button>
            </form>
          </div>
          <div className="mt-3 space-y-3">
            {readyQueue.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#E4E7F2] p-10 text-center text-sm text-[#46506E]/45">
                Queue clear — run today's tranche or raise N.
              </div>
            )}
            {queueSlice.map((p) => (
              <div key={p.id} className="rounded-2xl glass border-0 p-4">
                <div className="flex flex-wrap items-center gap-2.5 text-sm">
                  <span className="font-medium">{p.firstName} {p.lastName}</span>
                  <span className="text-[#46506E]/45">{p.companyRaw}</span>
                  {(p.serviceConfirmed ?? p.serviceSlug) && (
                    <span className="rounded bg-[#263BAA]/10 px-1.5 py-0.5 text-[11px] text-[#46506E]/70">{p.serviceConfirmed ?? p.serviceSlug}</span>
                  )}
                  {p.tier && <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${p.tier === 1 ? "bg-[#263BAA]/20 text-[#263BAA]" : "bg-[#263BAA]/10 text-[#46506E]/60"}`}>T{p.tier}</span>}
                  {p.flagVerdict === "variant" && <span className="rounded border border-red-500/40 px-1.5 py-0.5 text-[10px] text-red-600">⚑ variant</span>}
                  <span className="ml-auto text-xs"><ActivityBadge lastPostAt={p.lastPostAt} asOf={p.enrichedAt} /></span>
                </div>
                <details className="group mt-2">
                  <summary className="cursor-pointer list-none text-sm leading-relaxed text-[#46506E]/75">
                    <span className="line-clamp-2 group-open:hidden">{p.outreachMessage}</span>
                    <span className="hidden text-xs text-[#46506E]/35 group-open:inline">collapse ▴</span>
                  </summary>
                  <div className="mt-2 max-w-xl rounded-xl glass border-0 p-4 text-[15px] leading-relaxed">
                    {p.outreachMessage}
                  </div>
                </details>
                {p.lastPostAt && p.enrichedAt && p.lastPostAt > p.enrichedAt && (
                  <div className="mt-2 flex items-center justify-between rounded-lg border border-[#B54708]/30 bg-[#B54708]/10 px-3 py-1.5 text-xs text-[#B54708]">
                    new activity since draft — re-run this person
                    <form action={retryPerson.bind(null, batch.id, p.id)}><button className="underline">Re-run</button></form>
                  </div>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <CopyButton text={p.outreachMessage ?? ""} />
                  {p.linkedinUrl && <a href={p.linkedinUrl} target="_blank" className="text-sm text-[#263BAA] underline decoration-[#263BAA]/40">Open profile</a>}
                  <Link href={`/batches/${batch.id}?view=enriched&p=${p.id}`}
                    className="rounded-lg border border-[#D0D5E4] px-3 py-1.5 text-sm text-[#46506E]/70 hover:bg-[#263BAA]/5"
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
                {qPage > 1 && <Link href={qs({ qp: qPage - 1 })} className="rounded-lg border border-[#D0D5E4] px-3 py-1.5 text-[#46506E]/70 hover:bg-[#263BAA]/5">← Prev</Link>}
                <span className="tnum text-[#46506E]/40">page {qPage} / {qPages}</span>
                {qPage < qPages && <Link href={qs({ qp: qPage + 1 })} className="rounded-lg border border-[#D0D5E4] px-3 py-1.5 text-[#46506E]/70 hover:bg-[#263BAA]/5">Next →</Link>}
              </div>
            )}
            {readyQueue.length > 0 && (
              <div className="pt-1 text-center"><Soon tip="We deliberately never auto-send — a human pressing send protects the seat and the relationship.">Sequence / auto-send</Soon></div>
            )}
          </div>
        </div>

        <div className="w-full shrink-0 space-y-4 lg:w-80">
          <div className="rounded-2xl glass border-0 p-4">
            <h3 className="text-sm font-medium">Sent <span className="tnum ml-1 text-[#263BAA]">{sentList.length}</span></h3>
            {sentList.length === 0 && <p className="mt-2 text-sm text-[#46506E]/40">Nothing marked sent yet.</p>}
            <ul className="pane-scroll mt-2 max-h-[46vh] divide-y divide-[#EAECF5]">
              {sentList.slice(0, 10).map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.firstName} {p.lastName}</p>
                    <p className="truncate text-xs text-[#46506E]/40">{p.companyRaw} · {p.sentAt!.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
                  </div>
                  <form action={undoSent.bind(null, batch.id, p.id)}>
                    <button className="rounded-lg border border-[#D0D5E4] px-2.5 py-1 text-xs text-[#46506E]/70 hover:bg-[#263BAA]/5"
                      title="Back to the send queue">Undo</button>
                  </form>
                </li>
              ))}
            </ul>
            {sentList.length > 10 && <p className="mt-2 text-xs text-[#46506E]/35">Showing latest 10 of {sentList.length}.</p>}
          </div>
          {failedRows.length > 0 && (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/5 p-4 text-sm">
              <h3 className="font-medium text-red-600">Failed <span className="tnum ml-1">{failedRows.length}</span></h3>
              {failedRows.map((p) => (
                <p key={p.id} className="mt-2 text-xs text-[#46506E]/60">
                  {p.firstName} {p.lastName} — {p.enrichError?.slice(0, 44)}…{" "}
                  <form action={retryPerson.bind(null, batch.id, p.id)} className="inline"><button className="text-red-600 underline">Retry</button></form>
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
