import Link from "next/link";
import { Shell, requirePage } from "@/app/shell";
import { ActivityBadge, ago } from "@/components/dash-bits";
import { accountServices, loadAccounts } from "@/modules/accounts/query";

export default async function AccountsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; svc?: string; min?: string; a?: string; page?: string; size?: string }>;
}) {
  const user = await requirePage();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const svc = (sp.svc ?? "").trim();
  const min = [1, 2, 3].includes(Number(sp.min)) ? Number(sp.min) : 1;
  const size = [10, 25].includes(Number(sp.size)) ? Number(sp.size) : 10;
  const page = Math.max(1, Number(sp.page) || 1);

  const [accounts, services] = await Promise.all([
    loadAccounts(user.orgId, { q: q || undefined, service: svc || undefined, minPeople: min }),
    accountServices(user.orgId),
  ]);

  const pages = Math.max(1, Math.ceil(accounts.length / size));
  const safePage = Math.min(page, pages);
  const paged = accounts.slice((safePage - 1) * size, safePage * size);
  const selected = accounts.find((a) => a.key === sp.a) ?? paged[0] ?? null;

  const base = `/accounts?${new URLSearchParams({
    ...(q ? { q } : {}),
    ...(svc ? { svc } : {}),
    min: String(min),
    size: String(size),
  }).toString()}`;

  return (
    <Shell user={user} active="accounts">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Accounts</h1>
          <p className="mt-1 max-w-xl text-sm text-[#475467]">
            Warm-network ABM list — companies where you already have pitchable
            people, ranked by coverage. Built from Stage A only.
          </p>
        </div>
        <form action="/accounts" method="get" className="flex flex-wrap items-center gap-2 text-[13px]">
          <input name="q" defaultValue={q} placeholder="Company or person"
            className="w-44 rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5" />
          <select name="svc" defaultValue={svc} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
            <option value="">All ICPs</option>
            {services.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="min" defaultValue={String(min)} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
            <option value="1">1+ people</option>
            <option value="2">2+ people</option>
            <option value="3">3+ people</option>
          </select>
          <select name="size" defaultValue={String(size)} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
            <option value="10">10</option>
            <option value="25">25</option>
          </select>
          <button className="rounded-[8px] border border-[#DDE2EE] bg-white px-3 py-1.5">Filter</button>
        </form>
      </div>

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="radar-stat rounded-[14px] border border-[#DDE2EE] bg-white p-4">
          <p className="tnum text-[26px] leading-8">{accounts.length}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#98A2B3]">Accounts</p>
        </div>
        <div className="radar-stat rounded-[14px] border border-[#DDE2EE] bg-white p-4">
          <p className="tnum text-[26px] leading-8">{accounts.reduce((n, a) => n + a.peopleCount, 0)}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#98A2B3]">Pitchable people</p>
        </div>
        <div className="radar-stat rounded-[14px] border border-[#DDE2EE] bg-white p-4">
          <p className="tnum text-[26px] leading-8">{accounts.filter((a) => a.peopleCount >= 2).length}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#98A2B3]">Multi-contact</p>
        </div>
        <div className="radar-stat rounded-[14px] border border-[#DDE2EE] bg-white p-4">
          <p className="tnum text-[26px] leading-8">{accounts.reduce((n, a) => n + a.tier1Count, 0)}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#98A2B3]">Tier 1 seats</p>
        </div>
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="overflow-hidden rounded-[14px] border border-[#DDE2EE] bg-white">
          {paged.length === 0 ? (
            <p className="p-8 text-sm text-[#98A2B3]">
              No accounts yet. Run matching on a batch so people land in pitchable with a company.
            </p>
          ) : (
            <ul className="divide-y divide-[#EEF1F8]">
              {paged.map((a) => (
                <li key={a.key}>
                  <Link href={`${base}&a=${encodeURIComponent(a.key)}&page=${safePage}`}
                    className={`radar-row block px-4 py-3 hover:bg-[#F4F6FB] ${selected?.key === a.key ? "bg-[#EEF1FC]" : ""}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{a.name}</span>
                      <span className="tnum text-[12px] text-[#98A2B3]">{a.peopleCount} people</span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-[#475467]">
                      {a.tier1Count > 0 ? `${a.tier1Count} tier 1 · ` : ""}
                      {a.services.length ? a.services.slice(0, 3).join(", ") : "no ICP yet"}
                      {a.sentCount > 0 ? ` · ${a.sentCount} sent` : ""}
                    </p>
                    {a.lastActivity && (
                      <p className="mt-1 text-[12px] text-[#98A2B3]">
                        <ActivityBadge lastPostAt={a.lastActivity} asOf={a.lastActivity} />
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {accounts.length > 0 && (
            <div className="flex items-center justify-between border-t border-[#EEF1F8] px-4 py-2 text-[12px] text-[#475467]">
              <span>{accounts.length} accounts · page {safePage} of {pages}</span>
              <span className="flex gap-2">
                {safePage > 1 && <Link href={`${base}&page=${safePage - 1}${selected ? `&a=${encodeURIComponent(selected.key)}` : ""}`}>Prev</Link>}
                {safePage < pages && <Link href={`${base}&page=${safePage + 1}${selected ? `&a=${encodeURIComponent(selected.key)}` : ""}`}>Next</Link>}
              </span>
            </div>
          )}
        </div>

        <aside className="rounded-[14px] border border-[#DDE2EE] bg-white p-5">
          {!selected ? (
            <p className="text-sm text-[#98A2B3]">Pick an account to see the warm committee.</p>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-wider text-[#98A2B3]">Account</p>
              <h2 className="mt-1 text-lg font-semibold">{selected.name}</h2>
              <p className="mt-1 text-sm text-[#475467]">
                {selected.peopleCount} pitchable
                {selected.tier1Count ? ` · ${selected.tier1Count} tier 1` : ""}
                {selected.avgScore != null ? ` · avg score ${selected.avgScore}` : ""}
              </p>
              {selected.services.length > 0 && (
                <p className="mt-2 text-[12px] text-[#263BAA]">{selected.services.join(" · ")}</p>
              )}
              {selected.lastActivity && (
                <p className="mt-1 text-[11px] text-[#98A2B3]">Latest activity {ago(selected.lastActivity)}</p>
              )}
              <ul className="mt-4 divide-y divide-[#EEF1F8]">
                {selected.people.map((p) => (
                  <li key={p.id} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={`/people?q=${encodeURIComponent(p.firstName + " " + p.lastName)}`}
                        className="font-medium text-[#101828] hover:text-[#263BAA]">
                        {p.firstName} {p.lastName}
                      </Link>
                      {p.rank != null && <span className="tnum text-[11px] text-[#98A2B3]">#{p.rank}</span>}
                    </div>
                    <p className="text-[13px] text-[#475467]">{p.positionRaw ?? "—"}</p>
                    <p className="mt-0.5 text-[12px] text-[#98A2B3]">
                      {p.serviceSlug ?? "unclassified"}
                      {p.tier ? ` · T${p.tier}` : ""}
                      {p.sentAt ? " · already sent" : ""}
                    </p>
                    {p.matchWhy && (
                      <p className="mt-1 text-[12px] leading-5 text-[#475467]">{p.matchWhy}</p>
                    )}
                    {p.linkedinUrl && (
                      <a href={p.linkedinUrl} target="_blank" rel="noreferrer"
                        className="mt-1 inline-block text-[12px] text-[#263BAA]">Open profile</a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </Shell>
  );
}
