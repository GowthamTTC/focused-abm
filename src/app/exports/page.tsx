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
      <p className="mt-1 text-sm text-[#98A2B3]">The workbook is the deliverable — five tabs: prospects, drafts, flags, methodology, ops log.</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Exports generated" value={String(history.length)} sub="since logging began" />
        <StatCard label="Rows exported" value={totalRows.toLocaleString()} />
        <StatCard label="Campaigns" value={String(batches.length)} sub="available to export" />
      </div>

      <div className="mt-4 rounded-[14px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <h2 className="font-medium">What is inside</h2>
        <table className="mt-3 w-full text-left text-sm">
          <thead><tr className="text-xs uppercase tracking-wide text-[#98A2B3]">
            <th className="py-1.5 pr-4">Tab</th><th className="py-1.5">Contents</th></tr></thead>
          <tbody className="divide-y divide-[#EEF1F8] text-[#475467]">
            {([["Instructions","How to read the workbook and what each verdict means"],
               ["Top N — Batch","Researched prospects: opener draft, pain points, routed offer, evidence"],
               ["Target Pool (ranked)","Every matched person in rank order with score math"],
               ["Review — off-target","People the machine ruled out, with the rule that fired"],
               ["Peers & Competitors","Held out of outreach; the retention watchlist starts here"],
               ["Ops (internal)","Run log — who was researched when, within which run limit"]] as const).map(([t, d]) => (
              <tr key={t}><td className="py-2 pr-4 font-medium text-[#101828]">{t}</td><td className="py-2">{d}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
          <h2 className="font-medium">Export history</h2>
          {history.length === 0 && <p className="mt-3 text-sm text-[#98A2B3]">No exports logged yet — generate one from the panel on the right; history begins now.</p>}
          <ul className="pane-scroll mt-3 max-h-[50vh] divide-y divide-[#EEF1F8]">
            {history.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.label}</p>
                  <p className="tnum text-xs text-[#98A2B3]">{e.rows.toLocaleString()} rows · {e.createdAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                {e.batchId && (
                  <a href={`/api/export/${e.batchId}`} className="rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 text-xs text-[#263BAA] hover:bg-[#F4F6FB]">
                    Regenerate
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="self-start bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
          <h2 className="font-medium">Generate export</h2>
          <p className="mt-1 text-xs text-[#98A2B3]">Pick a campaign — the workbook downloads as .xlsx.</p>
          <ul className="mt-3 space-y-2">
            {batches.map((b) => (
              <li key={b.id}>
                <a href={`/api/export/${b.id}`}
                  className="block rounded-[8px] border border-[#DDE2EE] px-3 py-2.5 text-sm hover:bg-[#F4F6FB]">
                  <span className="font-medium">{b.label}</span>
                  <span className="tnum ml-2 text-xs text-[#98A2B3]">{b.createdAt.toISOString().slice(0, 10)}</span>
                </a>
              </li>
            ))}
            {batches.length === 0 && <p className="text-sm text-[#98A2B3]">No campaigns yet — <Link href="/sources" className="text-[#263BAA] underline">import or sync</Link> first.</p>}
          </ul>
        </div>
      </div>
    </Shell>
  );
}
