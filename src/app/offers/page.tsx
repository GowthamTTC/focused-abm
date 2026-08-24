import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, service } from "@/db";
import { Shell, requirePage } from "@/app/shell";

export default async function ServicesPage(props: { searchParams: Promise<{ deleted?: string }> }) {
  await props.searchParams;
  const user = await requirePage();
  const services = await db.select().from(service).where(eq(service.orgId, user.orgId));

  return (
    <Shell user={user} active="offers">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">ICPs</h1>
          <p className="mt-1 max-w-xl text-sm text-[#475467]">
            Who you sell to. Matching scores people against these profiles.
            Keep each one short — name and a clear “who we sell to” is enough to start.
          </p>
        </div>
        <Link href="/offers/new"
          className="rounded-[8px] bg-[#263BAA] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1D2E86]">
          + Add ICP
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {services.length === 0 && (
          <p className="text-sm text-[#98A2B3]">No ICPs yet — seed the workspace or add one.</p>
        )}
        {services.map((s) => (
          <Link key={s.id} href={`/offers/${s.slug}`}
            className="rounded-[14px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)] transition hover:border-[#263BAA]/30">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium text-[#101828]">{s.name}</h2>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                s.status === "active" ? "bg-[#ECFDF3] text-[#067647]" : "bg-[#F4F6FB] text-[#98A2B3]"
              }`}>{s.status === "active" ? "Active" : s.status}</span>
            </div>
            <p className="mt-3 text-[11px] uppercase tracking-wider text-[#98A2B3]">Who we sell to</p>
            <p className="mt-1 line-clamp-3 text-sm leading-5 text-[#475467]">
              {s.icpJson?.summary ?? "No summary yet — open to define."}
            </p>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
