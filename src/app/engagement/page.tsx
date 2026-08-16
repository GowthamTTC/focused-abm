import Link from "next/link";
import { Shell, requirePage } from "@/app/shell";
import { StatCard, Donut, HBars } from "@/components/charts";
import { networkStats, weekdayActivity } from "@/modules/insights/stats";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, connection } from "@/db";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function EngagementPage() {
  const user = await requirePage();
  const [s, dows, recentPosters] = await Promise.all([
    networkStats(user.orgId), weekdayActivity(user.orgId),
    db.select().from(connection)
      .where(and(eq(connection.orgId, user.orgId), gte(connection.lastPostAt, sql`now() - interval '7 days'`)))
      .orderBy(desc(connection.lastPostAt)).limit(8),
  ]);
  const unknown = s.total - s.scanned;

  return (
    <Shell user={user} active="engagement">
      <h1 className="text-2xl font-semibold">Engagement</h1>
      <p className="mt-1 text-sm text-[#2B3355]/55">
        Posting activity across your network, from enrichment reads and post scans. We show only what was observed —
        LinkedIn does not expose likes on your posts or profile views to any tool.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Posted ≤7 days" value={s.active7.toLocaleString()} sub="hottest reply window" />
        <StatCard label="Posted ≤30 days" value={s.active30.toLocaleString()} />
        <StatCard label="Posted ≤90 days" value={s.active90.toLocaleString()} />
        <StatCard label="Activity unknown" value={unknown.toLocaleString()} sub="not yet scanned — run a post scan" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[16px] border border-[#263BAA]/12 bg-white p-6">
          <h2 className="font-medium">Freshness of known activity</h2>
          <div className="mt-4">
            <Donut total={s.scanned} items={[
              { label: "≤7 days", n: s.active7 },
              { label: "8–30 days", n: Math.max(0, s.active30 - s.active7) },
              { label: "31–90 days", n: Math.max(0, s.active90 - s.active30) },
              { label: "Quiet >90d / no posts", n: Math.max(0, s.scanned - s.active90) },
            ]} />
          </div>
        </div>
        <div className="rounded-[16px] border border-[#263BAA]/12 bg-white p-6">
          <h2 className="font-medium">Most recent post, by weekday</h2>
          <p className="mt-0.5 text-xs text-[#2B3355]/45">Last-90-day observations — a rough guide to when your network is on LinkedIn.</p>
          <div className="mt-4"><HBars items={dows.map((d) => ({ label: DOW[d.dow] ?? String(d.dow), n: d.n }))} /></div>
        </div>
      </div>

      <div className="mt-4 rounded-[16px] border border-[#263BAA]/12 bg-white p-6">
        <h2 className="font-medium">Active this week</h2>
        <ul className="mt-3 divide-y divide-[#263BAA]/8">
          {recentPosters.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{p.firstName} {p.lastName}</span>
                <span className="ml-2 text-[#2B3355]/50">{p.companyRaw}</span>
              </div>
              <span className="tnum text-xs text-[#2B3355]/45">
                posted {p.lastPostAt?.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </span>
              {p.linkedinUrl && <a href={p.linkedinUrl} target="_blank" className="text-xs text-[#263BAA] underline">profile</a>}
            </li>
          ))}
          {recentPosters.length === 0 && <p className="py-3 text-sm text-[#2B3355]/45">No observed activity in the last 7 days — run a post scan to refresh.</p>}
        </ul>
        <p className="mt-3 text-xs text-[#2B3355]/40">
          Reply capture (measuring who answered your messages) ships in a later release — <Link href="/dashboard" className="text-[#263BAA] underline">the queue</Link> tracks sends today.
        </p>
      </div>
    </Shell>
  );
}
