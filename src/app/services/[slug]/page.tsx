import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, service } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { requireUser } from "@/auth/session";

async function save(slug: string, formData: FormData) {
  "use server";
  const user = await requireUser();
  const parsed = JSON.parse(String(formData.get("icp")));
  await db.update(service).set({ icpJson: parsed })
    .where(and(eq(service.orgId, user.orgId), eq(service.slug, slug)));
  redirect(`/services/${slug}?saved=1`);
}

export default async function ServiceDetail({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requirePage();
  const { slug } = await params;
  const [s] = await db.select().from(service)
    .where(and(eq(service.orgId, user.orgId), eq(service.slug, slug)));
  if (!s) notFound();

  return (
    <Shell user={user} active="services">
      <h1 className="text-xl font-semibold">{s.name}</h1>
      <p className="mt-1 text-sm text-white/55">ICP JSON — summary, fit signals, pains, persona title patterns, disqualifiers.</p>
      <form action={save.bind(null, s.slug)} className="mt-4">
        <textarea name="icp" rows={26} defaultValue={JSON.stringify(s.icpJson, null, 2)}
          className="w-full rounded border border-white/15 bg-[#1F2329] p-3 font-mono text-xs" />
        <button className="mt-3 rounded bg-[#B6FF2E] px-3 py-2 text-sm font-medium text-[#16191E] hover:bg-[#9FE51F]">Save ICP</button>
      </form>
    </Shell>
  );
}
