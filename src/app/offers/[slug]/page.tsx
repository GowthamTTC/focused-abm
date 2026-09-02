import { and, eq, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, connection, post, service } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { requireUser } from "@/auth/session";
import { IcpEditor } from "@/components/icp-editor";
import { enqueue } from "@/jobs/runner";
import { clearVerdicts, JUDGE_MAX_PER_RUN } from "@/modules/posts/judge";
import { liveJob, rereadTargets } from "@/modules/posts/feed";

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

/** Re-read every stored post against the ICPs as they stand now.
 *
 *  Relevance is judged against the services digest, so rewriting this ICP makes
 *  every stored verdict a judgement of wording that no longer exists — and
 *  nothing else in the product notices. This is the only thing that can fix
 *  that, and it is behind a confirm because it is the one control here that
 *  spends money: the verdicts go blank, the Today feed empties until the run
 *  finishes, and the workspace is re-billed about one model call per 25 posts.
 *
 *  Scoped to pitchable people, matching what judgePosts will select. Clearing a
 *  peer's verdict would leave it permanently unjudged and inflate the "unread
 *  posts" count on Today into a promise no press could keep. */
async function rereadPosts(slug: string, formData: FormData) {
  "use server";
  const user = await requireUser();
  if (String(formData.get("confirm")) !== "on") redirect(`/offers/${slug}?err=confirm-reread`);
  const [offer] = await db.select({ id: service.id }).from(service)
    .where(and(eq(service.orgId, user.orgId), eq(service.status, "active"))).limit(1);
  if (!offer) redirect(`/offers/${slug}?err=nooffers`);
  if (await liveJob(user.orgId)) redirect(`/offers/${slug}?err=busy`);
  const ids = await rereadTargets(user.orgId);
  if (ids.length === 0) redirect(`/offers/${slug}?reread=0`);
  await clearVerdicts(user.orgId, ids);
  await enqueue(user.orgId, "post_judge", {});
  redirect(`/offers/${slug}?reread=${ids.length}`);
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
  searchParams: Promise<{ saved?: string; err?: string; reread?: string }>;
}) {
  const user = await requirePage();
  const { slug } = await props.params;
  const { saved, err, reread } = await props.searchParams;
  const [s] = await db.select().from(service)
    .where(and(eq(service.orgId, user.orgId), eq(service.slug, slug)));
  if (!s) notFound();
  const [{ routed }] = await db.select({ routed: sql<number>`count(*)::int` }).from(connection)
    .where(and(eq(connection.orgId, user.orgId), eq(connection.serviceSlug, slug)));
  // How much of the workspace's post scoring rests on wording that is about to
  // change, or has just changed.
  const [judged] = await db.select({ n: sql<number>`count(*)::int` }).from(post)
    .innerJoin(connection, eq(connection.id, post.connectionId))
    .where(and(eq(post.orgId, user.orgId), eq(connection.bucket, "pitchable"),
      sql`${post.judgedAt} is not null`));
  const judgedN = judged?.n ?? 0;
  const rereadCalls = Math.ceil(Math.min(judgedN, JUDGE_MAX_PER_RUN) / 25);

  return (
    <Shell user={user} active="offers">
      <h1 className="text-2xl font-semibold">{s.name} <span className="text-[#98A2B3]">— ICP</span></h1>
      {saved && (
        <p className="mt-2 text-sm text-[#263BAA]">
          ICP saved — re-run matching to apply
          {judgedN > 0 && <>, and note that {judgedN.toLocaleString()} post verdicts were scored against the wording you just changed</>}.
        </p>
      )}
      {reread && reread !== "0" && (
        <p className="tnum mt-2 text-sm text-[#067647]">
          Re-reading {Number(reread).toLocaleString()} posts against the ICPs as they stand now — Today stays empty until the run finishes.
        </p>
      )}
      {reread === "0" && <p className="mt-2 text-sm text-[#B54708]">No post has been read yet, so there is nothing to re-read.</p>}
      {err === "confirm" && <p className="mt-2 text-sm text-[#B42318]">Tick the confirmation box to delete.</p>}
      {err === "confirm-reread" && <p className="mt-2 text-sm text-[#B42318]">Tick the confirmation box to re-read.</p>}
      {err === "busy" && <p className="mt-2 text-sm text-[#B54708]">A run is already going — the bar at the top has its progress. A re-read would only wait behind it.</p>}
      {err === "nooffers" && <p className="mt-2 text-sm text-[#B54708]">No active ICP to judge against — relevance would have no yardstick.</p>}
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
          {judgedN > 0 && (
            <details className="rounded-[14px] border border-[#E7CE96] bg-[#FEFBF3] p-5 text-sm">
              <summary className="cursor-pointer list-none font-medium text-[#B54708]">Re-read stored posts ▾</summary>
              <p className="tnum mt-3 text-[#475467]">
                Relevance is scored against your ICPs, so {judgedN.toLocaleString()} stored post
                verdict{judgedN === 1 ? "" : "s"} in this workspace judged the wording as it was at the time.
                Re-reading re-scores them against the ICPs as they stand now.
              </p>
              <p className="tnum mt-2 text-[11px] text-[#98A2B3]">
                No LinkedIn requests · about {rereadCalls} model call{rereadCalls === 1 ? "" : "s"} · the reasons on Today
                go blank until the run finishes · covers matched people only, which is all the reader ever reads
              </p>
              <form action={rereadPosts.bind(null, s.slug)} className="mt-3 space-y-3">
                <label className="flex items-start gap-2 text-xs text-[#475467]">
                  <input type="checkbox" name="confirm" className="mt-0.5" />
                  I understand this re-bills the reading pass and empties Today until it finishes.
                </label>
                <button className="rounded-[8px] border border-[#E7CE96] px-3 py-1.5 text-sm text-[#B54708] hover:bg-[#FDF6E7]">
                  Re-read {judgedN.toLocaleString()} post{judgedN === 1 ? "" : "s"}
                </button>
              </form>
            </details>
          )}

          <details className="rounded-[14px] border border-[#FDA29B] bg-[#FFFBFA] p-5 text-sm">
            <summary className="cursor-pointer list-none font-medium text-[#B42318]">Danger zone ▾</summary>
            <p className="mt-3 text-[#475467]">
              Delete this service permanently.
              {routed > 0 && <> <span className="text-[#B54708]">{routed.toLocaleString()} people are currently routed here</span> —
              their verdicts keep the label, and the next re-match will redistribute them across your remaining ICPs.</>}
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
