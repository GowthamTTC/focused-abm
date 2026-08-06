import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, service } from "@/db";
import { Shell, requirePage } from "@/app/shell";

export default async function ServicesPage() {
  const user = await requirePage();
  const services = await db.select().from(service).where(eq(service.orgId, user.orgId));

  return (
    <Shell user={user} active="services">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Services</h1>
        <p className="text-sm text-[#16191E]/55">These ICPs drive Stage-A matching. Edit freely; re-run matching after.</p>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {services.length === 0 && (
          <p className="text-sm text-[#16191E]/55">No services yet — run <code>npm run seed</code> to load the six TTC solutions.</p>
        )}
        {services.map((s) => (
          <Link key={s.id} href={`/services/${s.slug}`}
            className="rounded-[18px] border border-white/10 bg-[#1F2329] p-4 hover:border-white/30">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{s.name}</h2>
              <span className="text-xs text-[#16191E]/40">{s.status}</span>
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-[#16191E]/55">{s.icpJson.summary}</p>
            <p className="mt-2 text-xs text-[#16191E]/40">
              {s.icpJson.personas.length} persona(s) · {s.icpJson.pain_points.length} pains
            </p>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
