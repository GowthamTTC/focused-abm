import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell, requirePage } from "@/app/shell";
import { env } from "@/lib/env";
import { ago } from "@/components/dash-bits";
import { issuesFor, loadWorkspaceHealth, worstSeverity, type Severity } from "@/modules/admin/health";

const DOT: Record<Severity, string> = {
  ok: "bg-[#12B76A]",
  warn: "bg-[#F79009]",
  crit: "bg-[#F04438]",
};
const PILL: Record<Severity, string> = {
  ok: "bg-[#ECFDF3] text-[#067647]",
  warn: "bg-[#FDF6E7] text-[#B54708]",
  crit: "bg-[#FEF3F2] text-[#B42318]",
};

/** A number that only matters when it is not zero. */
function Count({ n, tone = "warn" }: { n: number; tone?: Severity }) {
  if (n === 0) return <span className="tnum text-[#98A2B3]">0</span>;
  return <span className={`tnum rounded-[4px] px-[5px] py-px text-[12px] font-medium ${PILL[tone]}`}>{n}</span>;
}

export default async function AdminHealthPage() {
  const user = await requirePage();
  if (user.email.toLowerCase() !== (env.ADMIN_EMAIL ?? "").toLowerCase()) notFound();

  const all = await loadWorkspaceHealth();
  const live = all.filter((w) => w.total > 0 || w.users.length > 0);
  const rows = live.map((w) => ({ w, issues: issuesFor(w) }))
    .map((r) => ({ ...r, sev: worstSeverity(r.issues) }));

  const crit = rows.filter((r) => r.sev === "crit").length;
  const warn = rows.filter((r) => r.sev === "warn").length;
  const clean = rows.filter((r) => r.sev === "ok").length;
  const totalBlank = rows.reduce((a, r) => a + r.w.pitchableNoService, 0);
  const totalUnmatched = rows.reduce((a, r) => a + r.w.unclassified, 0);
  const totalDrafts = rows.reduce((a, r) => a + r.w.draftsWaiting, 0);

  return (
    <Shell user={user} active="admin-health">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Workspace health</h1>
        <Link href="/admin" className="text-sm text-[#263BAA] underline-offset-2 hover:underline">
          Admin console
        </Link>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-[#98A2B3]">
        Workspaces are private, so nothing inside one is visible from outside it. This is the
        exception: enough to tell whether a client&apos;s pipeline is actually working, without
        opening their data.
      </p>

      {/* ── The four numbers worth acting on ── */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Need attention", value: crit + warn, sub: `${crit} urgent · ${clean} clean`, tone: crit ? "crit" : warn ? "warn" : "ok" },
          { label: "Pitchable, no offer", value: totalBlank, sub: "nobody can action these", tone: totalBlank ? "warn" : "ok" },
          { label: "Unmatched people", value: totalUnmatched, sub: "waiting on a matching run", tone: totalUnmatched ? "warn" : "ok" },
          { label: "Drafts waiting", value: totalDrafts, sub: "written, not sent", tone: "ok" },
        ].map((c) => (
          <div key={c.label} className="rounded-[14px] border border-[#DDE2EE] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#98A2B3]">{c.label}</p>
            <p className={`tnum mt-1 text-[26px] font-semibold leading-none ${c.tone === "crit" ? "text-[#B42318]" : c.tone === "warn" ? "text-[#B54708]" : "text-[#101828]"}`}>
              {c.value.toLocaleString()}
            </p>
            <p className="mt-1 text-[11px] text-[#98A2B3]">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Per workspace ── */}
      <section className="mt-6 overflow-hidden rounded-[14px] border border-[#DDE2EE] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-[#DDE2EE] text-[10px] uppercase tracking-[.08em] text-[#98A2B3]">
                <th className="px-4 py-3 text-left font-semibold">Workspace</th>
                <th className="px-3 py-3 text-right font-semibold">People</th>
                <th className="px-3 py-3 text-right font-semibold">Pitchable</th>
                <th className="px-3 py-3 text-right font-semibold">No offer</th>
                <th className="px-3 py-3 text-right font-semibold">Unmatched</th>
                <th className="px-3 py-3 text-right font-semibold">Researched</th>
                <th className="px-3 py-3 text-right font-semibold">Drafts</th>
                <th className="px-3 py-3 text-left font-semibold">Seat</th>
                <th className="px-3 py-3 text-left font-semibold">Last run</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ w, issues, sev }) => (
                <tr key={w.orgId} className="border-b border-[#EEF1F8] align-top last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <span className={`mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full ${DOT[sev]}`} />
                      <div className="min-w-0">
                        <p className="font-medium text-[#101828]">{w.workspace}</p>
                        <p className="truncate text-[11px] text-[#98A2B3]">
                          {w.users.length ? w.users.join(", ") : "no login"}
                          {w.services === 0 ? " · no offers" : ` · ${w.services} offers`}
                        </p>
                        {issues.length > 0 && (
                          <ul className="mt-1.5 flex flex-wrap gap-1">
                            {issues.map((i) => (
                              <li key={i.label} className={`rounded-[4px] px-[6px] py-px text-[11px] ${PILL[i.severity]}`}>
                                {i.label}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="tnum px-3 py-3 text-right text-[#475467]">{w.total.toLocaleString()}</td>
                  <td className="tnum px-3 py-3 text-right font-medium text-[#101828]">{w.pitchable.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right"><Count n={w.pitchableNoService} /></td>
                  <td className="px-3 py-3 text-right"><Count n={w.unclassified} /></td>
                  <td className="tnum px-3 py-3 text-right text-[#475467]">{w.enriched.toLocaleString()}</td>
                  <td className="tnum px-3 py-3 text-right text-[#475467]">{w.draftsWaiting.toLocaleString()}</td>
                  <td className="px-3 py-3">
                    {w.seatStatus
                      ? <span className={`rounded-[4px] px-[6px] py-px text-[11px] ${w.seatStatus === "operational" ? PILL.ok : PILL.crit}`}>
                          {w.seatStatus === "operational" ? "connected" : w.seatStatus}
                        </span>
                      : <span className="text-[11px] text-[#98A2B3]">none</span>}
                  </td>
                  <td className="px-3 py-3 text-[11px] text-[#475467]">
                    {w.lastJobAt
                      ? <>
                          <span className={w.lastJobStatus === "failed" ? "text-[#B42318]" : ""}>{w.lastJobKind}</span>
                          <span className="block text-[#98A2B3]">{ago(w.lastJobAt)}</span>
                        </>
                      : <span className="text-[#98A2B3]">never</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-[#98A2B3]">No workspaces yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-4 max-w-3xl text-xs text-[#98A2B3]">
        <strong className="text-[#475467]">No offer</strong> — matched as worth pitching but with no
        service assigned, so the row is not actionable. Usually means the workspace has no fallback
        offer set, or was matched before its catalog was configured.{" "}
        <strong className="text-[#475467]">Unmatched</strong> — imported or released but never run
        through matching. Neither is visible from inside the workspace as a problem, which is why
        they are here.
      </p>
    </Shell>
  );
}
