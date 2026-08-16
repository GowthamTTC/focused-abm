import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, connectionBatch, exportLog } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { StatCard } from "@/components/charts";

export default async function ExportsPage() {
  const user = await requirePage();
  const [history, batches] = await Promise.all([
    db.select().from(exportLog).where(eq(exportLog.orgId, user.orgId)).orderBy(desc(exportLog.createdAt)).limit(20),
    db.select().from(connectionBatch).where(eq(connectionBatch.orgId, user.orgId)).orderBy(desc(connectionBatch.createdAt)),
  ]);
  const totalRows = history.reduce((a, b) => a + b.rows, 0);

  return (
    <Shell user={user} active="exports">
      <h1 className="text-2xl font-semibold">Exports</h1>
      <p className="mt-1 text-sm text-[#46506E]/55">The workbook is the deliverable — five tabs: prospects, drafts, flags, methodology, ops log.</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Exports generated" value={String(history.length)} sub="since logging began" />
        <StatCard label="Rows exported" value={totalRows.toLocaleString()} />
        <StatCard label="Campaigns" value={String(batches.length)} sub="available to export" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl glass border-0 p-5">
          <h2 className="font-medium">Export history</h2>
          {history.length === 0 && <p className="mt-3 text-sm text-[#46506E]/45">No exports logged yet — generate one from the panel on the right; history begins now.</p>}
          <ul className="pane-scroll mt-3 max-h-[50vh] divide-y divide-[#EAECF5]">
            {history.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.label}</p>
                  <p className="tnum text-xs text-[#46506E]/45">{e.rows.toLocaleString()} rows · {e.createdAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                {e.batchId && (
                  <a href={`/api/export/${e.batchId}`} className="rounded-lg border border-[#D0D5E4] px-3 py-1.5 text-xs text-[#263BAA] hover:bg-[#263BAA]/5">
                    Regenerate
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="self-start rounded-2xl glass border-0 p-5">
          <h2 className="font-medium">Generate export</h2>
          <p className="mt-1 text-xs text-[#46506E]/45">Pick a campaign — the workbook downloads as .xlsx.</p>
          <ul className="mt-3 space-y-2">
            {batches.map((b) => (
              <li key={b.id}>
                <a href={`/api/export/${b.id}`}
                  className="block rounded-lg border border-[#D0D5E4] px-3 py-2.5 text-sm hover:bg-[#263BAA]/5">
                  <span className="font-medium">{b.label}</span>
                  <span className="tnum ml-2 text-xs text-[#46506E]/45">{b.createdAt.toISOString().slice(0, 10)}</span>
                </a>
              </li>
            ))}
            {batches.length === 0 && <p className="text-sm text-[#46506E]/45">No campaigns yet — <Link href="/connections" className="text-[#263BAA] underline">import or sync</Link> first.</p>}
          </ul>
        </div>
      </div>
    </Shell>
  );
}
