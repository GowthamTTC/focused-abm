import Link from "next/link";
import { Shell, requirePage } from "@/app/shell";
import { ActivityBadge, ago } from "@/components/dash-bits";
import { accountServices, loadAccounts } from "@/modules/accounts/query";
import { listShortlistedKeys, shortlistCount } from "@/modules/accounts/shortlist";
import { setAccountShortlist, startEnrichShortlist } from "./actions";

export default async function AccountsPage({ searchParams }: {
  searchParams: Promise<{
    q?: string; svc?: string; min?: string; a?: string; page?: string; size?: string;
    view?: string; enriched?: string;
  }>;
}) {
  const user = await requirePage();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const svc = (sp.svc ?? "").trim();
  const min = [1, 2, 3].includes(Number(sp.min)) ? Number(sp.min) : 1;
  const size = [10, 25].includes(Number(sp.size)) ? Number(sp.size) : 10;
  const page = Math.max(1, Number(sp.page) || 1);
  const view = sp.view === "shortlist" ? "shortlist" : "all";

  const [allAccounts, services, shortKeys, nShort] = await Promise.all([
    loadAccounts(user.orgId, { q: q || undefined, service: svc || undefined, minPeople: min }),
    accountServices(user.orgId),
    listShortlistedKeys(user.orgId),
    shortlistCount(user.orgId),
  ]);

  const accounts = view === "shortlist"
    ? allAccounts.filter((a) => shortKeys.has(a.key))
    : allAccounts;

  const pages = Math.max(1, Math.ceil(accounts.length / size));
  const safePage = Math.min(page, pages);
  const paged = accounts.slice((safePage - 1) * size, safePage * size);
  const selected = accounts.find((a) => a.key === sp.a) ?? paged[0] ?? null;

  const baseParams: Record<string, string> = {
    min: String(min),
    size: String(size),
  };
  if (q) baseParams.q = q;
  if (svc) baseParams.svc = svc;
  if (view === "shortlist") baseParams.view = "shortlist";
  const base = `/accounts?${new URLSearchParams(baseParams).toString()}`;

  return (
    <Shell user={user} active="accounts">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Accounts</h1>
          <p className="mt-1 max-w-xl text-sm text-[#475467]">
            Stage A builds the list. Shortlist the companies you care about,
            then enrich only those — top 3 seats per account — to save credits.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <form action="/accounts" method="get" className="flex flex-wrap items-center gap-2">
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
            {view === "shortlist" && <input type="hidden" name="view" value="shortlist" />}
            <button className="rounded-[8px] border border-[#DDE2EE] bg-white px-3 py-1.5">Filter</button>
          </form>
          {nShort > 0 && (
            <form action={startEnrichShortlist}>
              <button className="rounded-[8px] bg-[#263BAA] px-3 py-1.5 font-medium text-white hover:bg-[#1D2E86]">
                Enrich shortlist ({nShort})
              </button>
            </form>
          )}
        </div>
      </div>

      {sp.enriched && (
        <p className="mt-3 text-sm text-[#067647]">
          Queued research for {sp.enriched} people on your shortlist. Watch the top bar.
        </p>
      )}

      <div className="mt-4 flex gap-1 rounded-[10px] border border-[#DDE2EE] bg-white p-1 w-fit">
        <Link href={`/accounts?${new URLSearchParams({ ...(q ? { q } : {}), ...(svc ? { svc } : {}), min: String(min), size: String(size) }).toString()}`}
          className={`rounded-[8px] px-3 py-[7px] text-[13px] ${view === "all" ? "bg-[#EEF1FC] font-medium text-[#263BAA]" : "text-[#475467]"}`}>
          All accounts
        </Link>
        <Link href={`/accounts?view=shortlist&min=${min}&size=${size}`}
          className={`rounded-[8px] px-3 py-[7px] text-[13px] ${view === "shortlist" ? "bg-[#EEF1FC] font-medium text-[#263BAA]" : "text-[#475467]"}`}>
          Shortlist ({nShort})
        </Link>
      </div>

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="radar-stat rounded-[14px] border border-[#DDE2EE] bg-white p-4">
          <p className="tnum text-[26px] leading-8">{accounts.length}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#98A2B3]">
            {view === "shortlist" ? "Shortlisted" : "Accounts"}
          </p>
        </div>
        <div className="radar-stat rounded-[14px] border border-[#DDE2EE] bg-white p-4">
          <p className="tnum text-[26px] leading-8">{accounts.reduce((n, a) => n + a.peopleCount, 0)}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#98A2B3]">Pitchable people</p>
        </div>
        <div className="radar-stat rounded-[14px] border border-[#DDE2EE] bg-white p-4">
          <p className="tnum text-[26px] leading-8">{nShort}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#98A2B3]">On shortlist</p>
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
              {view === "shortlist"
                ? "Shortlist is empty. Open All accounts and star the companies you want to research."
                : "No accounts yet. Run matching so people land in pitchable with a company."}
            </p>
          ) : (
            <ul className="divide-y divide-[#EEF1F8]">
              {paged.map((a) => {
                const starred = shortKeys.has(a.key);
                return (
                  <li key={a.key} className="flex items-stretch">
                    <form action={setAccountShortlist} className="flex items-center border-r border-[#EEF1F8] px-2">
                      <input type="hidden" name="key" value={a.key} />
                      <input type="hidden" name="name" value={a.name} />
                      <input type="hidden" name="on" value={starred ? "0" : "1"} />
                      <input type="hidden" name="view" value={view} />
                      <button
                        title={starred ? "Remove from shortlist" : "Add to shortlist"}
                        className={`rounded px-2 py-1 text-[16px] leading-none ${starred ? "text-[#263BAA]" : "text-[#D0D5DD] hover:text-[#263BAA]"}`}
                      >
                        {starred ? "★" : "☆"}
                      </button>
                    </form>
                    <Link href={`${base}&a=${encodeURIComponent(a.key)}&page=${safePage}`}
                      className={`radar-row min-w-0 flex-1 block px-4 py-3 hover:bg-[#F4F6FB] ${selected?.key === a.key ? "bg-[#EEF1FC]" : ""}`}>
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
                );
              })}
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
              <form action={setAccountShortlist} className="mt-3">
                <input type="hidden" name="key" value={selected.key} />
                <input type="hidden" name="name" value={selected.name} />
                <input type="hidden" name="on" value={shortKeys.has(selected.key) ? "0" : "1"} />
                <input type="hidden" name="view" value={view} />
                <button className={`rounded-[8px] px-3 py-1.5 text-[12px] ${
                  shortKeys.has(selected.key)
                    ? "border border-[#DDE2EE] text-[#475467]"
                    : "bg-[#263BAA] text-white"
                }`}>
                  {shortKeys.has(selected.key) ? "Remove from shortlist" : "Add to shortlist"}
                </button>
              </form>
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
