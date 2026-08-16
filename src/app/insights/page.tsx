import { Shell, requirePage } from "@/app/shell";
import { StatCard, Donut, HBars, LineChart } from "@/components/charts";
import { networkStats, serviceSplit, countrySplit, snapshotToday } from "@/modules/insights/stats";

export default async function InsightsPage() {
  const user = await requirePage();
  const [s, services, countries, snaps] = await Promise.all([
    networkStats(user.orgId), serviceSplit(user.orgId),
    countrySplit(user.orgId), snapshotToday(user.orgId),
  ]);
  const scanNote = s.scanned < s.total
    ? `activity known for ${s.scanned.toLocaleString()} of ${s.total.toLocaleString()} — run post scans to widen coverage` : undefined;

  return (
    <Shell user={user} active="insights">
      <h1 className="text-2xl font-semibold">Network Insights</h1>
      <p className="mt-1 text-sm text-[#46506E]/55">The structure and quality of your network — every number traces to observed data.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total connections" value={s.total.toLocaleString()} />
        <StatCard label="Pitchable" value={s.pitchable.toLocaleString()}
          sub={s.total > 0 ? `${Math.round((s.pitchable / s.total) * 100)}% of network` : undefined} />
        <StatCard label="Researched" value={s.enriched.toLocaleString()} sub="deep-enriched with drafts" />
        <StatCard label="Active ≤30d" value={s.active30.toLocaleString()} sub={scanNote ?? "posted in the last 30 days"} />
        <StatCard label="Contacted" value={s.sent.toLocaleString()} sub="marked sent" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[16px] border border-[#E4E7F2] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] p-6">
          <h2 className="font-medium">Network growth</h2>
          <p className="mt-0.5 text-xs text-[#46506E]/45">One observed point per day — history begins the day this page first loaded.</p>
          <div className="mt-4"><LineChart points={snaps.map((x) => ({ x: x.day.slice(5), y: x.total }))} /></div>
        </div>
        <div className="rounded-[16px] border border-[#E4E7F2] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] p-6">
          <h2 className="font-medium">Composition — how the machine graded everyone</h2>
          <div className="mt-4">
            <Donut total={s.total} items={[
              { label: "Pitchable", n: s.pitchable }, { label: "Off-ICP", n: s.offIcp },
              { label: "Peers", n: s.peers }, { label: "Excluded", n: s.excluded },
              { label: "Unclassified", n: s.unclassified },
            ]} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[16px] border border-[#E4E7F2] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] p-6">
          <h2 className="font-medium">Pitchable by service</h2>
          <p className="mt-0.5 text-xs text-[#46506E]/45">Which of your offers your network maps to.</p>
          <div className="mt-4"><HBars items={services.map((x) => ({ label: x.slug, n: x.n }))} /></div>
        </div>
        <div className="rounded-[16px] border border-[#E4E7F2] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] p-6">
          <h2 className="font-medium">Top locations</h2>
          <p className="mt-0.5 text-xs text-[#46506E]/45">From synced profile locations; CSV-imported rows have none.</p>
          <div className="mt-4">
            {countries.length > 0 ? <HBars items={countries.map((x) => ({ label: x.country, n: x.n }))} />
              : <p className="text-sm text-[#46506E]/45">No location data yet — locations arrive with LinkedIn sync.</p>}
          </div>
        </div>
      </div>
    </Shell>
  );
}
