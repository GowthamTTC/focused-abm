import { and, eq } from "drizzle-orm";
import { db, service } from "@/db";
import { IcpEditor } from "@/components/icp-editor";
import { icpGaps, isIcpReady } from "@/modules/services/icp-ready";
import { dropService, renameService, saveIcp, startFromBlank } from "./actions";
import type { StepQuery } from "./step-services";

export async function StepIcp({ orgId, sp }: { orgId: string; sp: StepQuery }) {
  const rows = await db.select().from(service)
    .where(and(eq(service.orgId, orgId), eq(service.status, "active")))
    .orderBy(service.createdAt);

  if (rows.length === 0) {
    return (
      <div className="rounded-[10px] border border-[#DDE2EE] bg-[#F6F7FB] p-6">
        <p className="text-sm text-[#475467]">
          Nothing to define yet — go back a step to read it off your website, or start from an
          empty offer and write it yourself.
        </p>
        <form action={startFromBlank} className="mt-4">
          <button className="rounded-[10px] bg-[#263BAA] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
            Start from an empty offer
          </button>
        </form>
      </div>
    );
  }

  const selected = rows.find((r) => r.slug === sp.s)
    ?? rows.find((r) => !isIcpReady(r.icpJson))
    ?? rows[0];
  const gaps = icpGaps(selected.icpJson);
  const readyCount = rows.filter((r) => isIcpReady(r.icpJson)).length;

  return (
    <div className="space-y-5">
      {sp.err === "incomplete" && (
        <p className="rounded-[8px] border border-[#FDA29B] bg-[#FFFBFA] px-3 py-2 text-sm text-[#B42318]">
          Setup cannot continue past this step yet. At least one offer needs a saved ICP —
          everything after this matches your network against these words.
        </p>
      )}
      {sp.err === "last" && (
        <p className="rounded-[8px] border border-[#FDA29B] bg-[#FFFBFA] px-3 py-2 text-sm text-[#B42318]">
          That is your only offer — define it instead of removing it.
        </p>
      )}
      {sp.err === "badjson" && (
        <p className="rounded-[8px] border border-[#FDA29B] bg-[#FFFBFA] px-3 py-2 text-sm text-[#B42318]">
          That ICP was not valid JSON, so nothing was saved. Switch back to the form view and try again.
        </p>
      )}
      {sp.err === "noname" && (
        <p className="rounded-[8px] border border-[#FDA29B] bg-[#FFFBFA] px-3 py-2 text-sm text-[#B42318]">
          Give the offer a name.
        </p>
      )}
      {sp.dropped && (
        <p className="rounded-[8px] border border-[#DDE2EE] bg-[#F6F7FB] px-3 py-2 text-sm text-[#475467]">
          Removed “{decodeURIComponent(sp.dropped)}”.
        </p>
      )}

      {rows.length > 1 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-[#98A2B3]">
            {rows.length} offers drafted · {readyCount} ready
          </p>
          <ol className="mt-2 flex flex-wrap gap-2">
            {rows.map((r) => {
              const ready = isIcpReady(r.icpJson);
              const tone = r.slug === selected.slug
                ? "border-[#263BAA] bg-[#263BAA] text-white"
                : ready
                  ? "border-[#A6E9C2] bg-[#F2FBF6] text-[#067647]"
                  : "border-[#DDE2EE] bg-white text-[#475467]";
              return (
                <li key={r.slug}>
                  <a href={`/onboarding/3?s=${r.slug}`}
                    className={`block rounded-[10px] border px-3 py-1.5 text-xs font-medium hover:opacity-80 ${tone}`}>
                    {r.name}
                    <span className="ml-2 opacity-70">{ready ? "✓" : "•"}</span>
                  </a>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs text-[#98A2B3]">
            Pick one to edit. Keep only the offers you actually sell — the rest you can remove below,
            and you can add more later in Offers.
          </p>
        </div>
      )}

      <div className="rounded-[10px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form action={renameService.bind(null, selected.slug)} className="flex items-center gap-2">
            <input name="name" defaultValue={selected.name} required
              aria-label="Offer name"
              className="rounded-[8px] border border-[#DDE2EE] bg-white px-3 py-1.5 text-sm font-medium text-[#101828]" />
            <button className="text-xs text-[#263BAA] underline decoration-[#263BAA]/40 hover:text-[#1D2E86]">
              Rename
            </button>
          </form>
          {rows.length > 1 && (
            <form action={dropService.bind(null, selected.slug)}>
              <button className="text-xs text-[#98A2B3] hover:text-[#B42318]">
                Remove this offer
              </button>
            </form>
          )}
        </div>

        {gaps.length > 0 ? (
          <div className="mt-4 rounded-[8px] border border-[#E7CE96] bg-[#FEFBF3] px-3 py-2 text-sm text-[#B54708]">
            Before setup continues, this offer still needs {gaps.join(" and ")}. Fill it in and press Save.
          </div>
        ) : (
          <div className="mt-4 rounded-[8px] border border-[#A6E9C2] bg-[#F2FBF6] px-3 py-2 text-sm text-[#067647]">
            {sp.saved ? "Saved. " : ""}This ICP is usable — the title patterns below are what resolve
            people for free, before anything paid runs.
          </div>
        )}

        <div className="mt-5">
          <IcpEditor key={selected.slug} initialJson={JSON.stringify(selected.icpJson)}
            action={saveIcp.bind(null, selected.slug)} />
        </div>
      </div>
    </div>
  );
}
