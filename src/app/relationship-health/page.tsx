import Link from "next/link";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { StatCard, Donut } from "@/components/charts";
import { networkStats } from "@/modules/insights/stats";

export default async function HealthPage() {
  const user = await requirePage();
  const s = await networkStats(user.orgId);
  const fresh7 = s.active7, fresh30 = Math.max(0, s.active30 - s.active7),
    cooling = Math.max(0, s.active90 - s.active30), dormant = Math.max(0, s.scanned - s.active90);
  // Attention list: high-value people going quiet — T1/T2, activity old or unknown, never contacted.
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const attention = await db.select().from(connection)
    .where(and(
      eq(connection.orgId, user.orgId), eq(connection.bucket, "pitchable"),
      sql`tier in (1, 2)`, isNull(connection.sentAt),
      or(isNull(connection.lastPostAt), lt(connection.lastPostAt, cutoff)),
    ))
    .orderBy(sql`rank asc nulls last`).limit(10);

  return (
    <Shell user={user} active="health">
      <h1 className="text-2xl font-semibold">Relationship Health</h1>
      <p className="mt-1 text-sm text-[#46506E]/55">
        Health here means one honest thing: <span className="font-medium">recency</span> — how recently each person
        was visibly active, and which high-value relationships are going quiet before you have spoken.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active ≤7d" value={fresh7.toLocaleString()} sub="reply-hot" />
        <StatCard label="Warm 8–30d" value={fresh30.toLocaleString()} />
        <StatCard label="Cooling 31–90d" value={cooling.toLocaleString()} />
        <StatCard label="Dormant / quiet" value={dormant.toLocaleString()} sub="among scanned people" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[16px] border border-[#E4E7F2] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] p-6">
          <h2 className="font-medium">Freshness distribution</h2>
          <p className="mt-0.5 text-xs text-[#46506E]/45">Of the {s.scanned.toLocaleString()} people with observed activity.</p>
          <div className="mt-4">
            <Donut total={s.scanned} items={[
              { label: "Active ≤7d", n: fresh7 }, { label: "Warm 8–30d", n: fresh30 },
              { label: "Cooling 31–90d", n: cooling }, { label: "Dormant", n: dormant },
            ]} />
          </div>
        </div>
        <div className="rounded-[16px] border border-[#E4E7F2] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] p-6">
          <h2 className="font-medium">Needs attention</h2>
          <p className="mt-0.5 text-xs text-[#46506E]/45">Tier-1/2 prospects, never contacted, quiet 30+ days or unscanned.</p>
          <ul className="mt-3 divide-y divide-[#EAECF5]">
            {attention.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${p.tier === 1 ? "bg-[#263BAA]/15 text-[#263BAA]" : "bg-[#263BAA]/8 text-[#46506E]/60"}`}>T{p.tier}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.firstName} {p.lastName}</p>
                  <p className="truncate text-xs text-[#46506E]/50">{p.companyRaw} · {p.lastPostAt ? `last post ${p.lastPostAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "activity unknown"}</p>
                </div>
                {p.batchId && <Link href={`/batches/${p.batchId}?view=pitchable&p=${p.id}`} className="text-xs text-[#263BAA] underline">open</Link>}
              </li>
            ))}
            {attention.length === 0 && <p className="py-3 text-sm text-[#46506E]/45">Nothing slipping — every high-tier prospect is either fresh or already contacted.</p>}
          </ul>
        </div>
      </div>
    </Shell>
  );
}
