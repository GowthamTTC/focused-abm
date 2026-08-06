import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, connectionBatch } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { syncRelations, uploadCsv } from "./actions";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const user = await requirePage();
  const { err } = await searchParams;
  const batches = await db.select().from(connectionBatch)
    .where(eq(connectionBatch.orgId, user.orgId))
    .orderBy(desc(connectionBatch.createdAt));

  return (
    <Shell user={user} active="connections">
      <h1 className="text-xl font-semibold">Connections</h1>
      {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <form action={syncRelations} className="rounded-[18px] border border-white/10 bg-[#1F2329] p-5">
          <h2 className="font-medium">Sync from LinkedIn</h2>
          <p className="mt-1 text-sm text-[#16191E]/55">Pull all 1st-degree connections through the connected account. One pass, low risk.</p>
          <button className="mt-3 rounded bg-[#B6FF2E] px-3 py-2 text-sm font-medium text-[#16191E] hover:bg-[#9FE51F]">Sync connections</button>
        </form>
        <form action={uploadCsv} className="rounded-[18px] border border-white/10 bg-[#1F2329] p-5">
          <h2 className="font-medium">Upload Connections.csv</h2>
          <p className="mt-1 text-sm text-[#16191E]/55">LinkedIn → Settings → Data privacy → Get a copy of your data → Connections.</p>
          <input name="file" type="file" accept=".csv" required className="mt-3 block text-sm" />
          <button className="mt-3 rounded border border-white/15 px-3 py-2 text-sm font-medium hover:bg-[#1F2329]/5">Upload</button>
        </form>
      </div>

      <h2 className="mt-10 font-medium">Batches</h2>
      <ul className="mt-3 divide-y divide-white/5 rounded-[18px] border border-white/10 bg-[#1F2329]">
        {batches.length === 0 && <li className="p-4 text-sm text-[#16191E]/55">No batches yet — sync or upload above.</li>}
        {batches.map((b) => (
          <li key={b.id}>
            <Link href={`/batches/${b.id}`} className="flex items-center justify-between p-4 text-sm hover:bg-[#1F2329]/5">
              <span className="font-medium">{b.label}</span>
              <span className="text-[#16191E]/40">{b.source} · {b.createdAt.toISOString().slice(0, 10)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
