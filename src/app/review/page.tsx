import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { CopyButton } from "@/components/copy-button";
import { ActivityBadge, CampaignSwitcher, NoCampaign, resolveBatch } from "@/components/dash-bits";
import { ReviewKeys } from "@/components/review-keys";
import { checkQueuePosts, flagVerdict, markSent, undoSent } from "@/app/dashboard/actions";
import { retryPerson } from "@/app/batches/[id]/actions";

type Tab = "decisions" | "ready" | "sent";

export default async function ReviewPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; c?: string; p?: string; sort?: string }>;
}) {
  const user = await requirePage();
  const sp = await searchParams;
  const tab = (["decisions", "ready", "sent"].includes(sp.tab ?? "") ? sp.tab : "ready") as Tab;
  const sort = sp.sort === "rank" ? "rank" : "activity";
  const { batch, batches } = await resolveBatch(user.orgId, sp.c);
  if (!batch) return <Shell user={user} active="review"><NoCampaign /></Shell>;

  const enriched = await db.select().from(connection)
    .where(and(eq(connection.batchId, batch.id), eq(connection.enrichStatus, "done")));
  const [{ pendingN }] = await db.select({
    pendingN: sql<number>`count(*) filter (where enrich_status is distinct from 'done' and bucket = 'pitchable')::int`,
  }).from(connection).where(eq(connection.batchId, batch.id));

  const decisions = enriched.filter((p) => p.flag && !p.flagVerdict);
  const ready = enriched
    .filter((p) => p.outreachMessage && !p.outreachStatus &&
      (!p.flag || p.flagVerdict === "variant") && p.flagVerdict !== "dropped" && p.flagVerdict !== "verify")
    .sort((a, b) => sort === "rank"
      ? (a.rank ?? 9e9) - (b.rank ?? 9e9)
      : (a.tier ?? 9) - (b.tier ?? 9)
        || (b.lastPostAt?.getTime() ?? 0) - (a.lastPostAt?.getTime() ?? 0)
        || (a.rank ?? 9e9) - (b.rank ?? 9e9));
  const sent = enriched.filter((p) => p.sentAt).sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime());
  const list = tab === "decisions" ? decisions : tab === "ready" ? ready : sent;
  const person = list.find((p) => p.id === sp.p) ?? list[0] ?? null;
  const base = `/review?tab=${tab}&c=${batch.id}${sort === "rank" ? "&sort=rank" : ""}`;

  const TabLink = ({ t, label, n, owed }: { t: Tab; label: string; n: number; owed?: boolean }) => (
    <Link href={`/review?tab=${t}&c=${batch.id}`}
      className={`flex items-center gap-2 rounded-[8px] px-3 py-[7px] text-[13px] transition-colors duration-[130ms] ${tab === t
        ? "bg-[#EEF1FC] font-medium text-[#263BAA]" : "text-[#475467] hover:bg-[#F4F6FB]"}`}>
      {label}
      <span className={`tnum rounded-[4px] px-[5px] py-px text-[10px] ${owed && n > 0 ? "bg-[#FDF6E7] text-[#B54708]" : "bg-[#F4F6FB] text-[#475467]"}`}>{n}</span>
    </Link>
  );

  return (
    <Shell user={user} active="review">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[19px] font-semibold">Review</h1>
        <div className="flex gap-1 rounded-[10px] border border-[#DDE2EE] bg-white p-1">
          <TabLink t="decisions" label="Decisions" n={decisions.length} owed />
          <TabLink t="ready" label="Ready to send" n={ready.length} />
          <TabLink t="sent" label="Sent" n={sent.length} />
        </div>
        {tab === "ready" && (
          <>
            <div className="flex rounded-[8px] border border-[#DDE2EE] bg-white p-0.5 text-[12px]">
              {(["activity", "rank"] as const).map((s) => (
                <Link key={s} href={`/review?tab=ready&c=${batch.id}${s === "rank" ? "&sort=rank" : ""}`}
                  className={`rounded-[6px] px-2.5 py-1 capitalize ${sort === s ? "bg-[#EEF1FC] text-[#263BAA]" : "text-[#98A2B3]"}`}>{s}</Link>
              ))}
            </div>
            <form action={checkQueuePosts.bind(null, batch.id)}>
              <button className="rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 text-[12px] text-[#475467] hover:bg-[#F4F6FB]"
                title="Reads their recent posts, then reads them against your ICPs — refreshes activity badges and can produce new reasons to reach out.">
                Check for new posts
              </button>
            </form>
          </>
        )}
        <span className="ml-auto"><CampaignSwitcher batches={batches} batch={batch} basePath={`/review?tab=${tab}`} /></span>
      </div>

      <ReviewKeys ids={list.map((p) => p.id)} current={person?.id ?? null} base={base}
        copyText={person?.outreachMessage ?? undefined}
        recordHref={person?.batchId ? `/batches/${person.batchId}?view=enriched&p=${person.id}` : undefined} />

      {list.length === 0 ? (
        <div className="mt-5 rounded-[14px] border border-dashed border-[#DDE2EE] p-12 text-center text-[13px] text-[#98A2B3]">
          {tab === "decisions" ? "Nothing waiting on a decision — the queue is fully vetted."
            : tab === "ready" ? "Queue clear — research the next 30 from Today."
            : "Nothing sent yet."}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[340px_1fr]">
          {/* ── List pane ── */}
          <div className="pane-scroll max-h-[calc(100vh-190px)] overflow-hidden rounded-[14px] border border-[#DDE2EE] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]">
            <ul className="divide-y divide-[#EEF1F8]">
              {list.map((p) => (
                <li key={p.id}>
                  <Link href={`${base}&p=${p.id}`}
                    className={`block px-4 py-3 transition-colors duration-[130ms] ${person?.id === p.id ? "bg-[#EEF1FC]" : "hover:bg-[#F4F6FB]"}`}>
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="truncate font-medium">{p.firstName} {p.lastName}</span>
                      {p.tier && <span className={`tnum rounded-[4px] px-1 text-[10px] ${p.tier === 1 ? "bg-[#EEF1FC] text-[#263BAA]" : "bg-[#F4F6FB] text-[#475467]"}`}>T{p.tier}</span>}
                      {tab === "decisions" && <span className="ml-auto text-[#B42318]">⚑</span>}
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-[#98A2B3]">{p.companyRaw}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Record pane ── */}
          {person && (
            <div className="rounded-[14px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-[16px] font-semibold">{person.firstName} {person.lastName}</h2>
                <span className="text-[13px] text-[#475467]">{person.headlineRaw ?? person.companyRaw}</span>
                <span className="ml-auto text-[12px]"><ActivityBadge lastPostAt={person.lastPostAt} asOf={person.enrichedAt} /></span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[#98A2B3]">
                <span>{person.companyRaw}</span>
                {(person.serviceConfirmed ?? person.serviceSlug) && (
                  <span className="rounded-[4px] bg-[#EEF1FC] px-1.5 py-0.5 text-[11px] text-[#263BAA]">{person.serviceConfirmed ?? person.serviceSlug}</span>
                )}
                <span className="tnum">score {person.score ?? "—"} · rank #{person.rank ?? "—"}</span>
              </div>

              {/* Evidence — grey observed, amber inferred */}
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-[10px] border border-[#DDE2EE] bg-[#FAFBFE] p-3.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#98A2B3]">Match — observed</p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#475467]">{person.matchWhy ?? "Rule-pass match on title pattern."}</p>
                  {person.aboutSummary && <p className="mt-2 text-[12px] text-[#475467]">{person.aboutSummary}</p>}
                </div>
                <div className="rounded-[10px] border border-[#E7CE96] bg-[#FEFBF3] p-3.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#B54708]">Research — inferred</p>
                  {person.painPoints && <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#475467]">{person.painPoints}</p>}
                  {person.postsSummary && <p className="mt-2 text-[12px] text-[#475467]">{person.postsSummary}</p>}
                  {!person.painPoints && !person.postsSummary && <p className="mt-1.5 text-[12px] text-[#98A2B3]">No research stored for this person.</p>}
                </div>
              </div>

              {person.flag && (
                <div className="mt-3 rounded-[10px] border border-[#FDA29B] bg-[#FFFBFA] p-3.5 text-[12.5px] text-[#B42318]">
                  <span className="font-semibold">⚑ </span>{person.flag}
                </div>
              )}

              {person.outreachMessage && (
                <div className="mt-4 rounded-[10px] border border-[#DDE2EE] bg-[#F4F6FB] p-4 text-[14px] leading-relaxed text-[#101828]">
                  {person.outreachMessage}
                </div>
              )}
              {person.lastPostAt && person.enrichedAt && person.lastPostAt > person.enrichedAt && !person.sentAt && (
                <div className="mt-2 flex items-center justify-between rounded-[8px] border border-[#E7CE96] bg-[#FDF6E7] px-3 py-1.5 text-[12px] text-[#B54708]">
                  New activity since this draft — re-run before sending.
                  <form action={retryPerson.bind(null, batch.id, person.id)}><button className="underline">Re-run</button></form>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                {tab === "decisions" && (["dropped", "verify", "variant"] as const).map((v) => (
                  <form key={v} action={flagVerdict.bind(null, batch.id, person.id, v)}>
                    <button className={`rounded-[10px] border px-3.5 py-2 text-[13px] transition-colors duration-[130ms] ${v === "variant"
                      ? "border-[#263BAA] bg-[#263BAA] text-white hover:bg-[#1D2E86]"
                      : "border-[#DDE2EE] text-[#475467] hover:bg-[#F4F6FB]"}`}>
                      {v === "dropped" ? "Drop" : v === "verify" ? "Verify first" : "Send a variant"}
                    </button>
                  </form>
                ))}
                {tab === "ready" && (
                  <>
                    <CopyButton text={person.outreachMessage ?? ""} />
                    {person.linkedinUrl && <a href={person.linkedinUrl} target="_blank" className="text-[13px] text-[#263BAA] underline underline-offset-2">Open profile</a>}
                    <form action={markSent.bind(null, batch.id, person.id)}>
                      <button className="rounded-[10px] bg-[#263BAA] px-3.5 py-2 text-[13px] font-medium text-white hover:bg-[#1D2E86]">Mark sent</button>
                    </form>
                  </>
                )}
                {tab === "sent" && (
                  <form action={undoSent.bind(null, batch.id, person.id)}>
                    <button className="rounded-[10px] border border-[#DDE2EE] px-3.5 py-2 text-[13px] text-[#475467] hover:bg-[#F4F6FB]">Undo — back to Ready</button>
                  </form>
                )}
                <Link href={`/batches/${batch.id}?view=enriched&p=${person.id}`}
                  className="rounded-[10px] border border-[#DDE2EE] px-3.5 py-2 text-[13px] text-[#475467] hover:bg-[#F4F6FB]">Full record</Link>
                <span className="tnum ml-auto text-[11px] text-[#98A2B3]">J / K move · C copy · E record</span>
              </div>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
