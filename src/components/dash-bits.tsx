import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, connectionBatch } from "@/db";

export function ago(d: Date): string {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function ActivityBadge({ lastPostAt, asOf }: { lastPostAt: Date | null; asOf: Date | null }) {
  const asOfTxt = asOf ? ` as of ${asOf.toISOString().slice(5, 10)}` : "";
  if (!lastPostAt) {
    return <span className="tnum text-[#46506E]/35">○ {asOf ? "quiet" : "not captured yet"}<span className="text-[#46506E]/25">{asOfTxt}</span></span>;
  }
  const days = Math.round((Date.now() - lastPostAt.getTime()) / 86400000);
  if (days <= 7) return <span className="tnum text-[#263BAA]">● posted {Math.max(1, days)}d ago<span className="text-[#46506E]/25">{asOfTxt}</span></span>;
  if (days <= 30) return <span className="tnum text-[#B54708]">● posted {Math.round(days / 7)}w ago<span className="text-[#46506E]/25">{asOfTxt}</span></span>;
  return <span className="tnum text-[#46506E]/35">○ quiet<span className="text-[#46506E]/25">{asOfTxt}</span></span>;
}

export const Soon = ({ children, tip }: { children: React.ReactNode; tip?: string }) => (
  <span title={tip ?? "Coming in a later release."} className="relative inline-flex cursor-default items-center gap-1.5 opacity-35">
    {children}
    <span className="rounded bg-[#263BAA]/10 px-1 py-px text-[9px] uppercase tracking-wide text-[#46506E]/40">soon</span>
  </span>
);

export async function resolveBatch(orgId: string, c?: string) {
  const batches = await db.select().from(connectionBatch)
    .where(eq(connectionBatch.orgId, orgId)).orderBy(desc(connectionBatch.createdAt));
  const batch = batches.find((b) => b.id === c) ?? batches[0];
  return { batch, batches };
}

export function CampaignSwitcher({ batches, batch, basePath, totalRows }: {
  batches: { id: string; label: string }[]; batch: { id: string; label: string };
  basePath: string; totalRows?: number;
}) {
  return (
    <details className="relative inline-block">
      <summary className="glass flex cursor-pointer list-none items-center gap-3 rounded-xl border-0 px-4 py-2">
        <span className="font-medium">{batch.label}</span>
        {totalRows !== undefined && <span className="tnum text-xs text-[#46506E]/40">{totalRows.toLocaleString()} rows</span>}
        <span className="text-[#46506E]/30">▾</span>
        <span className="text-xs text-[#46506E]/30">campaign</span>
      </summary>
      <div className="glass absolute z-30 mt-1 w-72 rounded-xl border-0 p-1 shadow-2xl">
        {batches.map((b) => (
          <Link key={b.id} href={`${basePath}?c=${b.id}`}
            className={`block rounded-lg px-3 py-2 text-sm hover:bg-[#263BAA]/5 ${b.id === batch.id ? "text-[#263BAA]" : ""}`}>
            {b.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

export function NoCampaign() {
  return (
    <div className="rounded-2xl border border-dashed border-[#E4E7F2] p-12 text-center text-sm text-[#46506E]/55">
      No campaign yet — import or sync a network on the <Link href="/connections" className="text-[#263BAA] underline">Data</Link> page.
    </div>
  );
}
