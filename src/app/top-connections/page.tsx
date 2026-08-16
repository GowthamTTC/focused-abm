import Link from "next/link";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { StatCard } from "@/components/charts";

export default async function TopConnectionsPage(props: {
  searchParams: Promise<{ q?: string; svc?: string; page?: string }>;
}) {
  const user = await requirePage();
  const { q = "", svc = "", page = "1" } = await props.searchParams;
  const PAGE = 15;
  const pg = Math.max(1, Number(page) || 1);

  const where = and(
    eq(connection.orgId, user.orgId), eq(connection.bucket, "pitchable"),
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
    "/top-connections?" + Object.entries({ q, svc, page: pg, ...over }).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

  return (
    <Shell user={user} active="top">
      <h1 className="text-2xl font-semibold">Top Connections</h1>
      <p className="mt-1 text-sm text-[#46506E]/55">Your most valuable relationships, ranked by the scoring system — deterministic and auditable per person.</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Tier-1 prospects" value={agg.t1.toLocaleString()} sub="score ≥ 70" />
        <StatCard label="Average score" value={String(agg.avgScore)} sub="across the pitchable pool" />
        <StatCard label="Researched" value={agg.enriched.toLocaleString()} sub="with drafted openers" />
      </div>

      <div className="mt-6 rounded-2xl glass border-0 p-5">
        <form className="flex flex-wrap items-center gap-3" action="/top-connections">
          <input name="q" defaultValue={q} placeholder="Search name or company…"
            className="w-64 rounded-lg glass-input px-3 py-2 text-sm" />
          <select name="svc" defaultValue={svc} className="rounded-lg glass-input px-3 py-2 text-sm">
            <option value="">All services</option>
            {services.map((x) => x.s && <option key={x.s} value={x.s}>{x.s}</option>)}
          </select>
          <button className="rounded-lg bg-[#263BAA] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D2E86]">Filter</button>
        </form>

        <div className="pane-scroll mt-4 max-h-[52vh]"><table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-[#46506E]/45">
            <tr>
              <th className="py-2 pr-3">Rank</th><th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Company</th><th className="py-2 pr-3">Service</th>
              <th className="py-2 pr-3">Score</th><th className="py-2 pr-3">Tier</th>
              <th className="py-2 pr-3">Last post</th><th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EAECF5]">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="tnum py-2.5 pr-3 text-[#46506E]/60">#{p.rank ?? "—"}</td>
                <td className="py-2.5 pr-3 font-medium">{p.firstName} {p.lastName}</td>
                <td className="max-w-[220px] truncate py-2.5 pr-3 text-[#46506E]/70">{p.companyRaw}</td>
                <td className="py-2.5 pr-3"><span className="rounded bg-[#263BAA]/10 px-1.5 py-0.5 text-[11px] text-[#263BAA]">{p.serviceConfirmed ?? p.serviceSlug ?? "—"}</span></td>
                <td className="tnum py-2.5 pr-3">{p.score ?? "—"}</td>
                <td className="py-2.5 pr-3">{p.tier ? <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${p.tier === 1 ? "bg-[#263BAA]/15 text-[#263BAA]" : "bg-[#263BAA]/8 text-[#46506E]/60"}`}>T{p.tier}</span> : "—"}</td>
                <td className="tnum py-2.5 pr-3 text-xs text-[#46506E]/55">{p.lastPostAt ? p.lastPostAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "unknown"}</td>
                <td className="py-2.5 text-right">
                  {p.batchId && <Link href={`/batches/${p.batchId}?view=${p.enrichStatus === "done" ? "enriched" : "pitchable"}&p=${p.id}`} className="text-xs text-[#263BAA] underline">open</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="mt-3 flex items-center justify-between text-sm text-[#46506E]/55">
          <span className="tnum">{totalN.toLocaleString()} people · page {pg}/{pages}</span>
          <span className="flex gap-2">
            {pg > 1 && <Link href={qs({ page: pg - 1 })} className="rounded-lg border border-[#D0D5E4] px-3 py-1.5 hover:bg-[#263BAA]/5">← Prev</Link>}
            {pg < pages && <Link href={qs({ page: pg + 1 })} className="rounded-lg border border-[#D0D5E4] px-3 py-1.5 hover:bg-[#263BAA]/5">Next →</Link>}
          </span>
        </div>
      </div>
    </Shell>
  );
}
