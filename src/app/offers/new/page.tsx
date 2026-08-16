import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, service } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { requireUser } from "@/auth/session";

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

async function createService(formData: FormData) {
  "use server";
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  if (!name) redirect("/offers/new?err=Give the offer a name.");
  let slug = slugify(name) || "service";
  const [clash] = await db.select().from(service)
    .where(and(eq(service.orgId, user.orgId), eq(service.slug, slug)));
  if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  await db.insert(service).values({
    orgId: user.orgId, slug, name,
    icpJson: {
      summary: summary || `Who buys ${name}, in one or two sentences.`,
      fit_signals: [], pain_points: [], disqualifiers: [],
      personas: [{
        slug: "primary-buyer", name: "Primary buyer",
        title_include: [], title_exclude: [],
        seniority: ["founder", "cxo", "vp", "head", "director"], function_tags: [],
      }],
    },
  });
  redirect(`/offers/${slug}?saved=1`);
}

export default async function NewServicePage({ searchParams }: {
  searchParams: Promise<{ err?: string }>;
}) {
  const user = await requirePage();
  const { err } = await searchParams;
  return (
    <Shell user={user} active="offers">
      <h1 className="text-2xl font-semibold">Add a service</h1>
      <p className="mt-1 max-w-2xl text-sm text-[#98A2B3]">
        One per offering you sell. Name it the way you say it on a sales call — every connection
        will be routed to the offer they are most likely to buy, so the names appear on your
        workbook and in every drafted message.
      </p>
      {err && <p className="mt-3 text-sm text-[#B42318]">{err}</p>}

      <form action={createService} className="mt-6 max-w-2xl bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <label className="block text-sm text-[#475467]">Offer name
          <input name="name" required placeholder="e.g. Fractional CMO, ERP Implementation, Brand Sprint"
            className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3 text-sm" />
        </label>
        <label className="mt-4 block text-sm text-[#475467]">Who buys it (one or two sentences)
          <textarea name="summary" rows={3}
            placeholder="e.g. B2B SaaS companies, 50-500 people, whose founder still runs marketing and needs pipeline this quarter."
            className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3 text-sm" />
        </label>
        <p className="mt-3 text-xs text-[#98A2B3]">
          You will add the buyer titles, pains and disqualifiers on the next screen — those patterns
          are what let the free rule pass resolve people without spending on the model.
        </p>
        <button className="mt-5 rounded-[8px] bg-[#263BAA] px-5 py-2.5 text-sm font-semibold text-[#101828] hover:bg-[#1D2E86]">
          Create and define the ICP
        </button>
      </form>
    </Shell>
  );
}
