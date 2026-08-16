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
    return <span className="tnum text-[#98A2B3]">○ {asOf ? "quiet" : "not captured yet"}<span className="text-[#98A2B3]">{asOfTxt}</span></span>;
  }
  const days = Math.round((Date.now() - lastPostAt.getTime()) / 86400000);
  if (days <= 7) return <span className="tnum text-[#263BAA]">● posted {Math.max(1, days)}d ago<span className="text-[#98A2B3]">{asOfTxt}</span></span>;
  if (days <= 30) return <span className="tnum text-[#B54708]">● posted {Math.round(days / 7)}w ago<span className="text-[#98A2B3]">{asOfTxt}</span></span>;
  return <span className="tnum text-[#98A2B3]">○ quiet<span className="text-[#98A2B3]">{asOfTxt}</span></span>;
}

export const Soon = ({ children, tip }: { children: React.ReactNode; tip?: string }) => (
  <span title={tip ?? "Coming in a later release."} className="relative inline-flex cursor-default items-center gap-1.5 opacity-35">
    {children}
    <span className="rounded bg-[#EEF1FC] px-1 py-px text-[9px] uppercase tracking-wide text-[#98A2B3]">soon</span>
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
      <summary className="bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] flex cursor-pointer list-none items-center gap-3 rounded-[10px] px-4 py-2">
        <span className="font-medium">{batch.label}</span>
        {totalRows !== undefined && <span className="tnum text-xs text-[#98A2B3]">{totalRows.toLocaleString()} rows</span>}
        <span className="text-[#98A2B3]">▾</span>
        <span className="text-xs text-[#98A2B3]">campaign</span>
      </summary>
      <div className="bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] absolute z-30 mt-1 w-72 rounded-[10px] p-1 shadow-[0_12px_32px_rgba(16,24,40,.14)]">
        {batches.map((b) => (
          <Link key={b.id} href={`${basePath}?c=${b.id}`}
            className={`block rounded-[8px] px-3 py-2 text-sm hover:bg-[#F4F6FB] ${b.id === batch.id ? "text-[#263BAA]" : ""}`}>
            {b.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

export function NoCampaign() {
  return (
    <div className="rounded-[14px] border border-dashed border-[#DDE2EE] p-12 text-center text-sm text-[#98A2B3]">
      No campaign yet — import or sync a network on the <Link href="/sources" className="text-[#263BAA] underline">Data</Link> page.
    </div>
  );
}
