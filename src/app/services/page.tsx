import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, service } from "@/db";
import { Shell, requirePage } from "@/app/shell";

export default async function ServicesPage(props: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await props.searchParams;
  const user = await requirePage();
  const services = await db.select().from(service).where(eq(service.orgId, user.orgId));

  return (
    <Shell user={user} active="services">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Services</h1>
        <p className="text-sm text-[#46506E]/55">These ICPs drive Stage-A matching. Edit freely; re-run matching after.</p>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {services.length === 0 && (
          <p className="text-sm text-[#46506E]/55">No services yet — run <code>npm run seed</code> to load the six TTC solutions.</p>
        )}
        {services.map((s) => (
          <Link key={s.id} href={`/services/${s.slug}`}
            className="rounded-[18px] border border-[#E4E7F2] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5 transition hover:border-[#263BAA]/30">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-[#263BAA]">{s.name}</h2>
              <span className="text-xs text-[#46506E]/40">{s.status}</span>
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-[#46506E]/55">{s.icpJson?.summary ?? "No ICP yet — open to define."}</p>
            <p className="tnum mt-3 text-xs text-[#46506E]/40">
              {(s.icpJson?.personas ?? []).length} personas · {(s.icpJson?.pain_points ?? []).length} pains
            </p>
          </Link>
        ))}
        <Link href="/services/new"
          className="flex min-h-[140px] items-center justify-center rounded-[18px] border border-dashed border-[#D0D5E4] text-sm text-[#46506E]/45 hover:border-[#263BAA]/40 hover:text-[#263BAA]">
          + Add another offer
        </Link>
      </div>
    </Shell>
  );
}
