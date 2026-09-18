import { and, eq } from "drizzle-orm";
import { db, service } from "@/db";
import { DRAFT_ERROR_MESSAGE, type DraftErrorCode } from "@/modules/services/draft-from-site";
import { isIcpReady } from "@/modules/services/icp-ready";
import { draftFromUrl, startFromBlank } from "./actions";
import { UrlForm } from "./url-form";

export interface StepQuery {
  err?: string; drafted?: string; pages?: string;
  s?: string; saved?: string; renamed?: string; dropped?: string;
  connected?: string; connect_failed?: string; link_err?: string;
  ok?: string; voicesaved?: string;
}

export async function StepServices({ orgId, sp }: { orgId: string; sp: StepQuery }) {
  const rows = await db.select().from(service)
    .where(and(eq(service.orgId, orgId), eq(service.status, "active")))
    .orderBy(service.createdAt);
  const drafted = Number(sp.drafted ?? 0);
  const errMessage = sp.err && sp.err in DRAFT_ERROR_MESSAGE
    ? DRAFT_ERROR_MESSAGE[sp.err as DraftErrorCode]
    : null;

  return (
    <div className="space-y-6">
      <div className="rounded-[10px] border border-[#DDE2EE] bg-[#F6F7FB] p-6">
        <p className="text-sm text-[#475467]">
          Give us the address of your website and we will read your home page plus any
          services or solutions pages behind it, then draft what you sell — each offer with a
          first pass at who buys it. You review and correct all of it on the next step.
        </p>
        <div className="mt-4">
          <UrlForm action={draftFromUrl} />
        </div>
        {errMessage && (
          <p className="mt-3 rounded-[8px] border border-[#FDA29B] bg-[#FFFBFA] px-3 py-2 text-sm text-[#B42318]">
            {errMessage}
          </p>
        )}
        {drafted > 0 && !errMessage && (
          <p className="tnum mt-3 rounded-[8px] border border-[#A6E9C2] bg-[#F2FBF6] px-3 py-2 text-sm text-[#067647]">
            Drafted {drafted} offer{drafted === 1 ? "" : "s"} from {sp.pages ?? 1} page
            {sp.pages === "1" ? "" : "s"} of your site. Press Next to review and sharpen them.
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-[#98A2B3]">
            In your workspace ({rows.length})
          </p>
          <ul className="mt-2 space-y-2">
            {rows.map((s) => (
              <li key={s.slug}
                className="rounded-[10px] border border-[#DDE2EE] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-[#101828]">{s.name}</p>
                  <span className={`shrink-0 text-xs ${isIcpReady(s.icpJson) ? "text-[#067647]" : "text-[#B54708]"}`}>
                    {isIcpReady(s.icpJson) ? "ICP ready" : "needs your input"}
                  </span>
                </div>
                {s.icpJson.summary && (
                  <p className="mt-1.5 line-clamp-2 text-sm text-[#475467]">{s.icpJson.summary}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={startFromBlank}>
        <button className="text-sm text-[#263BAA] underline decoration-[#263BAA]/40 hover:text-[#1D2E86]">
          {rows.length > 0 ? "Skip the crawl — I'll define these by hand" : "No website handy — let me define one by hand"}
        </button>
      </form>
    </div>
  );
}
