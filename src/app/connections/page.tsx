import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, channelAccount, connectionBatch } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { LedgerStrip } from "@/components/ledger";
import { bucketCounts } from "@/modules/matching/service-fit";
import { syncRelations, uploadCsv } from "./actions";

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
    <Shell user={user} active="connections">
      <h1 className="text-2xl font-semibold">Connections</h1>
      {err && <p className="mt-2 text-sm text-red-400">{err}</p>}

      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
        <form action={syncRelations} className="rounded-[18px] border border-white/10 bg-[#1F2329] p-6">
          <h2 className="text-lg font-medium">Sync from LinkedIn</h2>
          <p className="mt-1 text-sm text-white/55">Pull all 1st-degree connections through the connected account.</p>
          <button disabled={!seat}
            className="mt-4 rounded-lg bg-[#B6FF2E] px-4 py-2 text-sm font-semibold text-[#16191E] shadow-[0_0_18px_rgba(182,255,46,.2)] hover:bg-[#9FE51F] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35 disabled:shadow-none">
            Sync connections
          </button>
          {!seat && (
            <p className="mt-3 text-xs text-white/45">
              Connect a LinkedIn account in <Link href="/settings" className="text-[#B6FF2E] underline decoration-[#B6FF2E]/40">Settings</Link> first.
            </p>
          )}
        </form>

        <form action={uploadCsv} className="rounded-[18px] border border-white/10 bg-[#1F2329] p-6">
          <h2 className="text-lg font-medium">Upload Connections.csv</h2>
          <p className="mt-1 text-sm text-white/55">LinkedIn → Settings → Data privacy → Get a copy of your data → Connections.</p>
          <div className="mt-4 flex items-center gap-3">
            <label className="flex h-16 flex-1 cursor-pointer items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/25 px-3 text-sm text-white/40 transition hover:border-white/30 hover:text-white/60">
              <input name="file" type="file" accept=".csv" required
                className="w-full text-sm text-white/60 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:text-[#E8EAF0]" />
            </label>
            <button className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15">Upload</button>
          </div>
        </form>
      </div>

      <h2 className="mt-10 text-lg font-medium">Batches</h2>
      <ul className="mt-3 divide-y divide-white/5 rounded-[18px] border border-white/10 bg-[#1F2329]">
        {batches.length === 0 && (
          <li className="border border-dashed border-white/10 p-8 text-center text-sm text-white/45">
            No batches yet — sync or upload above.
          </li>
        )}
        {withCounts.map(({ b, c }) => {
          const total = Object.values(c).reduce((a, n) => a + n, 0);
          return (
            <li key={b.id}>
              <Link href={`/batches/${b.id}`} className="flex items-center gap-4 p-4 text-sm hover:bg-white/5">
                <span className="w-44 shrink-0 truncate font-medium">{b.label}</span>
                <span className="rounded border border-white/15 px-1.5 py-0.5 text-[11px] text-white/55">{b.source}</span>
                <span className="tnum w-20 shrink-0 text-white/40">{b.createdAt.toISOString().slice(5, 10)}</span>
                <LedgerStrip className="hidden flex-1 sm:flex" counts={{
                  pitchable: c.pitchable, peers: c.peer_competitor,
                  offIcp: c.off_icp, excluded: c.excluded, unclassified: c.unclassified,
                }} />
                <span className="tnum shrink-0 text-white/55">
                  {total === 0 ? "importing…"
                    : c.pitchable > 0
                      ? `${c.pitchable.toLocaleString()} pitchable · ${c.off_icp} off-ICP · ${c.peer_competitor} peers`
                      : `${total.toLocaleString()} rows · unmatched`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}
