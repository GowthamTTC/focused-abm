import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, service } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { requireUser } from "@/auth/session";
import { IcpEditor } from "@/components/icp-editor";

async function save(slug: string, formData: FormData) {
  "use server";
  const user = await requireUser();
  const parsed = JSON.parse(String(formData.get("icp")));
  await db.update(service).set({ icpJson: parsed })
    .where(and(eq(service.orgId, user.orgId), eq(service.slug, slug)));
  redirect(`/services/${slug}?saved=1`);
}

export default async function ServiceDetail(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requirePage();
  const { slug } = await props.params;
  const { saved } = await props.searchParams;
  const [s] = await db.select().from(service)
    .where(and(eq(service.orgId, user.orgId), eq(service.slug, slug)));
  if (!s) notFound();

  return (
    <Shell user={user} active="services">
      <h1 className="text-2xl font-semibold">{s.name} <span className="text-white/30">— ICP</span></h1>
      {saved && <p className="mt-2 text-sm text-[#B6FF2E]">ICP saved — re-run matching to apply.</p>}
      <div className="mt-5 flex flex-col gap-5 lg:flex-row">
        <div className="min-w-0 flex-1 rounded-[18px] border border-white/10 bg-[#1F2329] p-6">
          <IcpEditor key={s.slug} initialJson={JSON.stringify(s.icpJson)} action={save.bind(null, s.slug)} />
        </div>
        <aside className="w-full shrink-0 self-start rounded-[18px] border border-white/10 bg-[#1F2329] p-5 text-sm text-white/70 lg:w-72">
          These patterns drive the free rule pass — every pattern you add removes people
          from the paid model pass.
        </aside>
      </div>
    </Shell>
  );
}
