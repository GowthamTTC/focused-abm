import Link from "next/link";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { StatCard, Donut, HBars, LineChart } from "@/components/charts";
import { topicCloud } from "@/modules/insights/topics";
import { TopicCloud } from "@/components/topic-cloud";
import { networkStats, serviceSplit, countrySplit, snapshotToday, weekdayActivity } from "@/modules/insights/stats";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type View = "composition" | "activity" | "recency";

export default async function NetworkPage({ searchParams }: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requirePage();
  const cloud = await topicCloud(user.orgId);
  const sp = await searchParams;
  const view = (["composition", "activity", "recency"].includes(sp.view ?? "") ? sp.view : "composition") as View;
  const [s, services, countries, snaps, dows, recentPosters] = await Promise.all([
    networkStats(user.orgId), serviceSplit(user.orgId), countrySplit(user.orgId),
    snapshotToday(user.orgId), weekdayActivity(user.orgId),
    db.select().from(connection)
      .where(and(eq(connection.orgId, user.orgId), gte(connection.lastPostAt, sql`now() - interval '7 days'`)))
      .orderBy(desc(connection.lastPostAt)).limit(8),
  ]);
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const attention = view === "recency" ? await db.select().from(connection)
    .where(and(eq(connection.orgId, user.orgId), eq(connection.bucket, "pitchable"),
      sql`tier in (1, 2)`, isNull(connection.sentAt),
      or(isNull(connection.lastPostAt), lt(connection.lastPostAt, cutoff))))
    .orderBy(sql`rank asc nulls last`).limit(10) : [];
  const unknown = s.total - s.scanned;
  const fresh7 = s.active7, fresh30 = Math.max(0, s.active30 - s.active7),
    cooling = Math.max(0, s.active90 - s.active30), dormant = Math.max(0, s.scanned - s.active90);

  const Card = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
    <div className="rounded-[14px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
      <h2 className="font-medium">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-[#98A2B3]">{sub}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );

  return (
    <Shell user={user} active="network">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Network</h1>
        <div className="flex gap-1 rounded-[10px] border border-[#DDE2EE] bg-white p-1">
          {(["composition", "activity", "recency"] as const).map((v) => (
            <Link key={v} href={`/network?view=${v}`}
              className={`rounded-[8px] px-3 py-[7px] text-[13px] capitalize transition-colors duration-[130ms] ${view === v
                ? "bg-[#EEF1FC] font-medium text-[#263BAA]" : "text-[#475467] hover:bg-[#F4F6FB]"}`}>{v}</Link>
          ))}
        </div>
      </div>

      {view === "composition" && (<>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Total connections" value={s.total.toLocaleString()} />
          <StatCard label="Matched" value={s.pitchable.toLocaleString()}
            sub={s.total > 0 ? `${Math.round((s.pitchable / s.total) * 100)}% of network` : undefined} />
          <StatCard label="Researched" value={s.enriched.toLocaleString()} sub="with drafted openers" />
          <StatCard label="Active ≤30d" value={s.active30.toLocaleString()} />
          <StatCard label="Contacted" value={s.sent.toLocaleString()} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Network growth" sub="One observed point per day — history begins the day this page first loaded.">
            <LineChart points={snaps.map((x) => ({ x: x.day.slice(5), y: x.total }))} />
          </Card>
          <Card title="Composition — how the machine graded everyone">
            <Donut total={s.total} items={[
              { label: "Matched", n: s.pitchable }, { label: "Off-target", n: s.offIcp },
              { label: "Peers", n: s.peers }, { label: "Excluded", n: s.excluded },
              { label: "Unmatched", n: s.unclassified },
            ]} />
          </Card>
          <Card title="Matched, by ICP" sub="Which of your offers your network maps to.">
            <HBars items={services.map((x) => ({ label: x.slug, n: x.n }))} />
          </Card>
          <Card title="Top locations" sub="From synced profile locations; CSV-imported rows have none.">
            {countries.length > 0 ? <HBars items={countries.map((x) => ({ label: x.country, n: x.n }))} />
              : <p className="text-sm text-[#98A2B3]">No location data yet — locations arrive with LinkedIn sync.</p>}
          </Card>
        </div>
      </>)}

      {view === "activity" && (<>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Posted ≤7 days" value={s.active7.toLocaleString()} sub="hottest reply window" />
          <StatCard label="Posted ≤30 days" value={s.active30.toLocaleString()} />
          <StatCard label="Posted ≤90 days" value={s.active90.toLocaleString()} />
          <StatCard label="Activity unknown" value={unknown.toLocaleString()} sub="not yet scanned" />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Freshness of known activity">
            <Donut total={s.scanned} items={[
              { label: "≤7 days", n: fresh7 }, { label: "8–30 days", n: fresh30 },
              { label: "31–90 days", n: cooling }, { label: "Quiet >90d", n: dormant },
            ]} />
          </Card>
          <Card title="Most recent post, by weekday" sub="Last-90-day observations.">
            <HBars items={dows.map((d) => ({ label: DOW[d.dow] ?? String(d.dow), n: d.n }))} />
          </Card>
        </div>
        <div className="mt-4">
          <Card title="Active this week">
            <ul className="divide-y divide-[#EEF1F8]">
              {recentPosters.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium">{p.firstName} {p.lastName}</span>
                    <span className="ml-2 text-[#98A2B3]">{p.companyRaw}</span></span>
                  <span className="tnum text-xs text-[#98A2B3]">posted {p.lastPostAt?.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                </li>
              ))}
              {recentPosters.length === 0 && <p className="py-3 text-sm text-[#98A2B3]">No observed activity in the last 7 days — run a post scan.</p>}
            </ul>
          </Card>
        </div>
      </>)}

      {view === "recency" && (<>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active ≤7d" value={fresh7.toLocaleString()} sub="reply-hot" />
          <StatCard label="Warm 8–30d" value={fresh30.toLocaleString()} />
          <StatCard label="Cooling 31–90d" value={cooling.toLocaleString()} />
          <StatCard label="Dormant / quiet" value={dormant.toLocaleString()} sub="among scanned people" />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Freshness distribution" sub={`Of the ${s.scanned.toLocaleString()} people with observed activity.`}>
            <Donut total={s.scanned} items={[
              { label: "Active ≤7d", n: fresh7 }, { label: "Warm 8–30d", n: fresh30 },
              { label: "Cooling 31–90d", n: cooling }, { label: "Dormant", n: dormant },
            ]} />
          </Card>
          <Card title="Needs attention" sub="Tier-1/2, never contacted, quiet 30+ days or unscanned.">
            <ul className="divide-y divide-[#EEF1F8]">
              {attention.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className={`tnum rounded-[4px] px-1.5 py-0.5 text-[11px] font-semibold ${p.tier === 1 ? "bg-[#EEF1FC] text-[#263BAA]" : "bg-[#F4F6FB] text-[#475467]"}`}>T{p.tier}</span>
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium">{p.firstName} {p.lastName}</span>
                    <span className="ml-2 text-xs text-[#98A2B3]">{p.companyRaw}</span></span>
                  <Link href={`/review?tab=ready&c=${p.batchId}&p=${p.id}`} className="text-xs text-[#263BAA] underline">review</Link>
                </li>
              ))}
              {attention.length === 0 && <p className="py-3 text-sm text-[#98A2B3]">Nothing slipping — every high-tier prospect is fresh or contacted.</p>}
            </ul>
          </Card>
        </div>
      </>)}
      {view === "composition" && (
        <div className="mt-4 rounded-[14px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <h2 className="font-medium">What your researched prospects struggle with</h2>
          <div className="mt-3"><TopicCloud terms={cloud.terms} people={cloud.people} /></div>
        </div>
      )}
    </Shell>
  );
}
