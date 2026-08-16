import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, connection } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { CampaignSwitcher, NoCampaign, resolveBatch } from "@/components/dash-bits";
import { flagVerdict } from "@/app/dashboard/actions";

export default async function FlagInboxPage({ searchParams }: {
  searchParams: Promise<{ c?: string; fp?: string }>;
}) {
  const user = await requirePage();
  const { c, fp = "1" } = await searchParams;
  const { batch, batches } = await resolveBatch(user.orgId, c);
  if (!batch) return <Shell user={user} active="flags"><NoCampaign /></Shell>;

  const enriched = await db.select().from(connection)
    .where(and(eq(connection.batchId, batch.id), eq(connection.enrichStatus, "done")));
  const flagInbox = enriched.filter((p) => p.flag && !p.flagVerdict);
  const PAGE = 10;
  const fPage = Math.max(1, Number(fp) || 1), fPages = Math.max(1, Math.ceil(flagInbox.length / PAGE));
  const flagSlice = flagInbox.slice((fPage - 1) * PAGE, fPage * PAGE);
  const qs = (p: number) => `/flag-inbox?c=${batch.id}&fp=${p}`;

  return (
    <Shell user={user} active="flags">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Flag Inbox <span className="tnum ml-2 text-[#B54708]">{flagInbox.length}</span></h1>
          <p className="mt-1 text-sm text-[#46506E]/55">Every flagged person needs a verdict before they can enter the send queue — this is the 27% trap-catch as a workflow.</p>
        </div>
        <CampaignSwitcher batches={batches} batch={batch} basePath="/flag-inbox" />
      </div>

      {flagInbox.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-[#E4E7F2] p-12 text-center text-sm text-[#46506E]/45">
          Nothing waiting on a decision — the queue is fully vetted.
        </div>
      )}
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {flagSlice.map((p) => (
          <div key={p.id} className="glass rounded-2xl border-0 p-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{p.firstName} {p.lastName}</span>
              <span className="text-[#46506E]/45">{p.companyRaw}</span>
              <span className="ml-auto rounded border border-red-500/40 px-1.5 text-[10px] text-red-600">⚑ flag</span>
            </div>
            <p className="mt-2 text-sm text-[#46506E]/70">{p.flag}</p>
            {p.batchId && (
              <Link href={`/batches/${p.batchId}?view=enriched&p=${p.id}`} className="mt-2 inline-block text-xs text-[#263BAA] underline">
                view full record
              </Link>
            )}
            <div className="mt-3 flex gap-2">
              {(["dropped", "verify", "variant"] as const).map((v) => (
                <form key={v} action={flagVerdict.bind(null, batch.id, p.id, v)}>
                  <button className={`rounded-lg border px-3 py-1.5 text-xs ${v === "variant"
                    ? "border-[#263BAA]/40 text-[#263BAA] hover:bg-[#263BAA]/10"
                    : "border-[#D0D5E4] text-[#46506E]/70 hover:bg-[#263BAA]/5"}`}>
                    {v === "dropped" ? "Drop" : v === "verify" ? "Verify" : "Send variant"}
                  </button>
                </form>
              ))}
            </div>
          </div>
        ))}
      </div>
      {fPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          {fPage > 1 && <Link href={qs(fPage - 1)} className="rounded-lg border border-[#D0D5E4] px-3 py-1.5 text-[#46506E]/70 hover:bg-[#263BAA]/5">← Prev</Link>}
          <span className="tnum text-[#46506E]/40">page {fPage} / {fPages}</span>
          {fPage < fPages && <Link href={qs(fPage + 1)} className="rounded-lg border border-[#D0D5E4] px-3 py-1.5 text-[#46506E]/70 hover:bg-[#263BAA]/5">Next →</Link>}
        </div>
      )}
    </Shell>
  );
}
