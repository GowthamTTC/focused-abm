import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, channelAccount, connectionBatch } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { LedgerStrip } from "@/components/ledger";
import { bucketCounts } from "@/modules/matching/service-fit";
import { syncRelations, uploadCsv } from "./actions";
import { RecentRuns } from "@/components/recent-runs";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const user = await requirePage();
  const { err } = await searchParams;
  const batches = await db.select().from(connectionBatch)
    .where(eq(connectionBatch.orgId, user.orgId))
    .orderBy(desc(connectionBatch.createdAt));
  const [seat] = await db.select().from(channelAccount)
    .where(and(eq(channelAccount.orgId, user.orgId), eq(channelAccount.status, "operational"))).limit(1);
  const withCounts = await Promise.all(batches.map(async (b) => ({ b, c: await bucketCounts(b.id) })));

  return (
    <Shell user={user} active="sources">
      <h1 className="text-2xl font-semibold">Connections</h1>
      {err && <p className="mt-2 text-sm text-[#B42318]">{err}</p>}

      <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
        <form action={syncRelations} className="bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
          <h2 className="text-lg font-medium">Sync from LinkedIn</h2>
          <p className="mt-1 text-sm text-[#98A2B3]">Pull all 1st-degree connections through the connected account.</p>
          <button disabled={!seat}
            className="mt-4 rounded-[8px] bg-[#263BAA] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D2E86] disabled:cursor-not-allowed disabled:bg-[#EEF1FC] disabled:text-[#98A2B3] disabled:shadow-none">
            Sync connections
          </button>
          {!seat && (
            <p className="mt-3 text-xs text-[#98A2B3]">
              Connect a LinkedIn account in <Link href="/settings" className="text-[#263BAA] underline decoration-[#263BAA]/40">Settings</Link> first.
            </p>
          )}
        </form>

        <form action={uploadCsv} className="bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
          <h2 className="text-lg font-medium">Upload Connections.csv</h2>
          <p className="mt-1 text-sm text-[#98A2B3]">LinkedIn → Settings → Data privacy → Get a copy of your data → Connections.</p>
          <div className="mt-4 flex items-center gap-3">
            <label className="flex h-16 flex-1 cursor-pointer items-center justify-center rounded-[10px] border border-dashed border-[#DDE2EE] bg-white px-3 text-sm text-[#98A2B3] transition hover:border-[#263BAA]/40 hover:text-[#475467]">
              <input name="file" type="file" accept=".csv" required
                className="w-full text-sm text-[#475467] file:mr-3 file:rounded-[8px] file:file:bg-[#EEF1FC] file:px-3 file:py-1.5 file:text-sm file:text-[#101828]" />
            </label>
            <button className="rounded-[8px] border border-[#DDE2EE] bg-[#EEF1FC] px-4 py-2 text-sm font-medium hover:bg-[#EEF1FC]">Upload</button>
          </div>
        </form>
      </div>

      <h2 className="mt-10 text-lg font-medium">Batches</h2>
      <ul className="mt-3 divide-y divide-[#EEF1F8] bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        {batches.length === 0 && (
          <li className="border border-dashed border-[#DDE2EE] p-8 text-center text-sm text-[#98A2B3]">
            No batches yet — sync or upload above.
          </li>
        )}
        {withCounts.map(({ b, c }) => {
          const total = Object.values(c).reduce((a, n) => a + n, 0);
          return (
            <li key={b.id}>
              <Link href={`/batches/${b.id}`} className="flex items-center gap-4 p-4 text-sm hover:bg-[#F4F6FB]">
                <span className="w-44 shrink-0 truncate font-medium">{b.label}</span>
                <span className="rounded border border-[#DDE2EE] px-1.5 py-0.5 text-[11px] text-[#98A2B3]">{b.source}</span>
                <span className="tnum w-20 shrink-0 text-[#98A2B3]">{b.createdAt.toISOString().slice(5, 10)}</span>
                <LedgerStrip className="hidden flex-1 sm:flex" counts={{
                  pitchable: c.pitchable, peers: c.peer_competitor,
                  offIcp: c.off_icp, excluded: c.excluded, unclassified: c.unclassified,
                }} />
                <span className="tnum shrink-0 text-[#98A2B3]">
                  {total === 0 ? "importing…"
                    : c.pitchable > 0
                      ? `${c.pitchable.toLocaleString()} pitchable · ${c.off_icp} off-target · ${c.peer_competitor} peers`
                      : `${total.toLocaleString()} rows · unmatched`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <RecentRuns orgId={user.orgId} />
    </Shell>
  );
}
