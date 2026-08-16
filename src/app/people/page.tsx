import Link from "next/link";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { Shell, requirePage } from "@/app/shell";

export default async function PeoplePage(props: {
  searchParams: Promise<{ q?: string; svc?: string; page?: string; view?: string; loc?: string }>;
}) {
  const user = await requirePage();
  const { q = "", svc = "", page = "1", view = "", loc = "" } = await props.searchParams;
  const PAGE = 15;
  const pg = Math.max(1, Number(page) || 1);

  const monthAgo = new Date(Date.now() - 30 * 86400000);
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const where = and(
    eq(connection.orgId, user.orgId), eq(connection.bucket, "pitchable"),
    ...(view === "t1" ? [eq(connection.tier, 1)] : []),
    ...(view === "quiet" ? [sql`(last_post_at < ${monthAgo} or last_post_at is null)`] : []),
    ...(view === "week" ? [sql`last_post_at >= ${weekAgo}`] : []),
    ...(view === "sent" ? [sql`sent_at is not null`] : []),
    ...(loc ? [sql`location ilike ${"%" + loc + "%"}`] : []),
    ...(q ? [or(ilike(connection.firstName, `%${q}%`), ilike(connection.lastName, `%${q}%`), ilike(connection.companyRaw, `%${q}%`))] : []),
    ...(svc ? [eq(connection.serviceSlug, svc)] : []),
  );
  const rows = await db.select().from(connection).where(where)
    .orderBy(sql`rank asc nulls last`).limit(PAGE).offset((pg - 1) * PAGE);
  const [{ n: totalN }] = await db.select({ n: sql<number>`count(*)::int` }).from(connection).where(where);
  const services = await db.selectDistinct({ s: connection.serviceSlug }).from(connection)
    .where(and(eq(connection.orgId, user.orgId), eq(connection.bucket, "pitchable")));
  const [agg] = await db.select({
    t1: sql<number>`count(*) filter (where tier = 1)::int`,
    enriched: sql<number>`count(*) filter (where enrich_status = 'done')::int`,
    avgScore: sql<number>`coalesce(round(avg(score)), 0)::int`,
  }).from(connection).where(and(eq(connection.orgId, user.orgId), eq(connection.bucket, "pitchable")));
  const pages = Math.max(1, Math.ceil(totalN / PAGE));
  const qs = (over: Record<string, string | number>) =>
    "/people?" + Object.entries({ q, svc, view, loc, page: pg, ...over }).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

  return (
    <Shell user={user} active="people">
      <h1 className="text-2xl font-semibold">People</h1>
      <p className="mt-1 text-sm text-[#98A2B3]">Everyone the machine matched, ranked. Saved views are live filters; every state is a shareable URL.</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {([["", "All"], ["t1", "Tier 1"], ["quiet", "Going quiet"], ["week", "Posted this week"], ["sent", "Sent"]] as const).map(([v, label]) => (
          <Link key={v} href={qs({ view: v, page: 1 })}
            className={`rounded-[8px] border px-3 py-1.5 text-[12.5px] transition-colors duration-[130ms] ${view === v
              ? "border-[#263BAA] bg-[#EEF1FC] text-[#263BAA]" : "border-[#DDE2EE] text-[#475467] hover:bg-[#F4F6FB]"}`}>{label}</Link>
        ))}
      </div>

      <div className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <form className="flex flex-wrap items-center gap-3" action="/people">
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={q} placeholder="Search name or company…"
            className="w-64 rounded-[8px] bg-white border border-[#DDE2EE] rounded-[10px] px-3 py-2 text-sm" />
          <input name="loc" defaultValue={loc} placeholder="Location…"
            className="w-36 rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2 text-sm" />
          <select name="svc" defaultValue={svc} className="rounded-[8px] bg-white border border-[#DDE2EE] rounded-[10px] px-3 py-2 text-sm">
            <option value="">All services</option>
            {services.map((x) => x.s && <option key={x.s} value={x.s}>{x.s}</option>)}
          </select>
          <button className="rounded-[8px] bg-[#263BAA] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D2E86]">Filter</button>
        </form>

        <div className="pane-scroll mt-4 max-h-[52vh]"><table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-[#98A2B3]">
            <tr>
              <th className="py-2 pr-3">Rank</th><th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Company</th><th className="py-2 pr-3">Service</th>
              <th className="py-2 pr-3">Score</th><th className="py-2 pr-3">Tier</th>
              <th className="py-2 pr-3">Last post</th><th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF1F8]">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="tnum py-2.5 pr-3 text-[#475467]">#{p.rank ?? "—"}</td>
                <td className="py-2.5 pr-3 font-medium">{p.firstName} {p.lastName}</td>
                <td className="max-w-[220px] truncate py-2.5 pr-3 text-[#475467]">{p.companyRaw}</td>
                <td className="py-2.5 pr-3"><span className="rounded bg-[#EEF1FC] px-1.5 py-0.5 text-[11px] text-[#263BAA]">{p.serviceConfirmed ?? p.serviceSlug ?? "—"}</span></td>
                <td className="tnum py-2.5 pr-3">{p.score ?? "—"}</td>
                <td className="py-2.5 pr-3">{p.tier ? <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${p.tier === 1 ? "bg-[#EEF1FC] text-[#263BAA]" : "bg-[#F4F6FB] text-[#475467]"}`}>T{p.tier}</span> : "—"}</td>
                <td className="tnum py-2.5 pr-3 text-xs text-[#98A2B3]">{p.lastPostAt ? p.lastPostAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "unknown"}</td>
                <td className="py-2.5 text-right">
                  {p.batchId && <Link href={`/batches/${p.batchId}?view=${p.enrichStatus === "done" ? "enriched" : "pitchable"}&p=${p.id}`} className="text-xs text-[#263BAA] underline">open</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="mt-3 flex items-center justify-between text-sm text-[#98A2B3]">
          <span className="tnum">{totalN.toLocaleString()} people · page {pg}/{pages}</span>
          <span className="flex gap-2">
            {pg > 1 && <Link href={qs({ page: pg - 1 })} className="rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 hover:bg-[#F4F6FB]">← Prev</Link>}
            {pg < pages && <Link href={qs({ page: pg + 1 })} className="rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 hover:bg-[#F4F6FB]">Next →</Link>}
          </span>
        </div>
      </div>
    </Shell>
  );
}
