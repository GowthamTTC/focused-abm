import { desc, eq, inArray } from "drizzle-orm";
import { db, connection, connectionBatch, job } from "@/db";

const KIND_LABEL: Record<string, string> = {
  classify: "Matching", deep_enrich: "Research", sync: "Sync", activity_scan: "Post scan", import: "Import",
};

function ago(d: Date): string {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function dur(a: Date, b: Date): string {
  const m = Math.round((b.getTime() - a.getTime()) / 60000);
  return m < 1 ? "<1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Recent runs — the machine's visible memory (matching + enrichment history). */
export async function RecentRuns({ orgId }: { orgId: string }) {
  const jobs = await db.select().from(job)
    .where(eq(job.orgId, orgId))
    .orderBy(desc(job.createdAt)).limit(8);
  if (jobs.length === 0) return null;

  // Resolve batch labels: classify carries batchId; enrich resolves via first person.
  const batchIds = new Set<string>();
  const firstConnIds: string[] = [];
  for (const j of jobs) {
    if (typeof j.payloadJson.batchId === "string") batchIds.add(j.payloadJson.batchId);
    const ids = j.payloadJson.connectionIds;
    if (Array.isArray(ids) && typeof ids[0] === "string") firstConnIds.push(ids[0]);
  }
  const connRows = firstConnIds.length
    ? await db.select({ id: connection.id, batchId: connection.batchId }).from(connection)
        .where(inArray(connection.id, firstConnIds))
    : [];
  for (const c of connRows) batchIds.add(c.batchId);
  const batchRows = batchIds.size
    ? await db.select({ id: connectionBatch.id, label: connectionBatch.label }).from(connectionBatch)
        .where(inArray(connectionBatch.id, [...batchIds]))
    : [];
  const labelOf = new Map(batchRows.map((b) => [b.id, b.label]));
  const connBatch = new Map(connRows.map((c) => [c.id, c.batchId]));

  return (
    <>
      <h2 className="mt-10 text-lg font-medium">Recent runs</h2>
      <ul className="mt-3 divide-y divide-[#EEF1F8] bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        {jobs.map((j) => {
          const ids = j.payloadJson.connectionIds;
          const batchId = typeof j.payloadJson.batchId === "string"
            ? j.payloadJson.batchId
            : Array.isArray(ids) && typeof ids[0] === "string" ? connBatch.get(ids[0]) : undefined;
          const target = batchId ? labelOf.get(batchId) : undefined;
          return (
            <li key={j.id} className="flex items-center gap-4 p-3.5 text-sm">
              <span className="w-24 shrink-0 font-medium">{KIND_LABEL[j.kind] ?? j.kind}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${
                j.status === "done" ? "bg-[#EEF1FC] text-[#263BAA]"
                : j.status === "running" ? "bg-[#FDF6E7] text-[#B54708]"
                : j.status === "failed" ? "bg-red-500/15 text-[#B42318]"
                : "bg-[#EEF1FC] text-[#475467]"}`}>{j.status}</span>
              <span className="min-w-0 flex-1 truncate text-[#98A2B3]">
                {target ?? ""}{j.status === "failed" && j.error ? ` — ${j.error}` : ""}
              </span>
              <span className="tnum shrink-0 text-[#98A2B3]">{j.progress}/{j.total}</span>
              <span className="tnum w-20 shrink-0 text-right text-[#98A2B3]">{ago(j.createdAt)}</span>
              <span className="tnum w-16 shrink-0 text-right text-[#98A2B3]">
                {j.status === "done" || j.status === "failed" ? dur(j.createdAt, j.updatedAt) : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
