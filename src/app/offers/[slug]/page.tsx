import { and, eq, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, connection, service } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { requireUser } from "@/auth/session";
import { IcpEditor } from "@/components/icp-editor";

async function deleteService(slug: string, formData: FormData) {
  "use server";
  const user = await requireUser();
  if (String(formData.get("confirm")) !== "on") redirect(`/offers/${slug}?err=confirm`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(service)
    .where(eq(service.orgId, user.orgId));
  if (n <= 1) redirect(`/offers/${slug}?err=last`);
  await db.delete(service).where(and(eq(service.orgId, user.orgId), eq(service.slug, slug)));
  redirect("/offers?deleted=1");
}

async function save(slug: string, formData: FormData) {
  "use server";
  const user = await requireUser();
  const parsed = JSON.parse(String(formData.get("icp")));
  await db.update(service).set({ icpJson: parsed })
    .where(and(eq(service.orgId, user.orgId), eq(service.slug, slug)));
  redirect(`/offers/${slug}?saved=1`);
}

export default async function ServiceDetail(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ saved?: string; err?: string }>;
}) {
  const user = await requirePage();
  const { slug } = await props.params;
  const { saved, err } = await props.searchParams;
  const [s] = await db.select().from(service)
    .where(and(eq(service.orgId, user.orgId), eq(service.slug, slug)));
  if (!s) notFound();
  const [{ routed }] = await db.select({ routed: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.orgId, user.orgId), eq(connection.serviceSlug, slug)));

  return (
    <Shell user={user} active="offers">
      <h1 className="text-2xl font-semibold">{s.name} <span className="text-[#98A2B3]">— ICP</span></h1>
      {saved && <p className="mt-2 text-sm text-[#263BAA]">ICP saved — re-run matching to apply.</p>}
      {err === "confirm" && <p className="mt-2 text-sm text-[#B42318]">Tick the confirmation box to delete.</p>}
      {err === "last" && <p className="mt-2 text-sm text-[#B42318]">Cannot delete your only service — the classifier needs at least one offer to route to.</p>}
      <div className="mt-5 flex flex-col gap-5 lg:flex-row">
        <div className="min-w-0 flex-1 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
          <IcpEditor key={s.slug} initialJson={JSON.stringify(s.icpJson)} action={save.bind(null, s.slug)} />
        </div>
        <aside className="w-full shrink-0 space-y-4 self-start lg:w-72">
          <div className="bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5 text-sm text-[#475467]">
            These patterns drive the free rule pass — every pattern you add removes people
            from the paid model pass.
          </div>
          <details className="rounded-[14px] border border-[#FDA29B] bg-[#FFFBFA] p-5 text-sm">
            <summary className="cursor-pointer list-none font-medium text-[#B42318]">Danger zone ▾</summary>
            <p className="mt-3 text-[#475467]">
              Delete this service permanently.
              {routed > 0 && <> <span className="text-[#B54708]">{routed.toLocaleString()} people are currently routed here</span> —
              their verdicts keep the label, and the next re-match will redistribute them across your remaining offers.</>}
            </p>
            <form action={deleteService.bind(null, s.slug)} className="mt-3 space-y-3">
              <label className="flex items-start gap-2 text-xs text-[#475467]">
                <input type="checkbox" name="confirm" className="mt-0.5" />
                I understand this cannot be undone.
              </label>
              <button className="rounded-[8px] border border-[#FDA29B] px-3 py-1.5 text-sm text-[#B42318] hover:bg-[#FFFBFA]">
                Delete “{s.name}”
              </button>
            </form>
          </details>
        </aside>
      </div>
    </Shell>
  );
}
