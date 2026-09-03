import Link from "next/link";
import { Shell, requirePage } from "@/app/shell";
import { ActivityBadge, ago } from "@/components/dash-bits";
import { RADAR_COUNTRIES, countryBySlug } from "@/modules/geo/countries";
import { loadRadar, type RadarPerson } from "@/modules/radar/query";
import { getDailyScanUsage } from "@/modules/posts/usage";
import { resetsIn } from "@/modules/enrich/usage";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, job } from "@/db";
import { startEventScan, markFloor, clearFloor } from "./actions";
import { CompanyPie } from "@/components/company-pie";
import { companyKey } from "@/modules/radar/score";

function evidenceLabel(p: RadarPerson): string {
  if (p.presence === "mentioned_active") {
    if (p.mentionKind === "event") {
      return p.networkDistance
        ? "Named the event in a recent post — you are not connected to them"
        : "Named the event in a recent post — not confirmed based here";
    }
    if (p.mentionKind === "travel") return "Travel language in a recent post — may be in town";
    return "Mentioned this metro in a post — weaker than a profile city";
  }
  if (p.metroEvidence === "profile") return p.location ? `Based in ${p.location}` : "Based here (profile)";
  if (p.metroEvidence === "headline") return "City taken from headline, not a full profile location";
  return "Based here";
}

function opener(p: RadarPerson): string {
  if (p.outreachMessage) return p.outreachMessage.split(/(?<=\.)\s/)[0] ?? p.outreachMessage.slice(0, 220);
  if (p.matchWhy) return p.matchWhy;
  return "No draft yet — research this person if you want a full opener.";
}

export default async function RadarPage({ searchParams }: {
  searchParams: Promise<{ metro?: string; days?: string; p?: string; tab?: string; scanning?: string; pool?: string; err?: string; country?: string; q?: string; page?: string; size?: string; event?: string; company?: string; exclude?: string }>;
}) {
  const user = await requirePage();
  const sp = await searchParams;
  const metro = "sf-bay-area";
  const days = [3, 7, 14].includes(Number(sp.days)) ? Number(sp.days) : 7;
  const pool = sp.pool === "extended" ? "extended" : "first";
  const country = countryBySlug(sp.country)?.slug ?? "united-states";
  const excludeCompanies = (sp.exclude ?? "").slice(0, 200);
  const query = (sp.q ?? "").trim();
  const eventName = (sp.event ?? query).trim();
  const size = [10, 25].includes(Number(sp.size)) ? Number(sp.size) : 10;
  const page = Math.max(1, Number(sp.page) || 1);
  const tab = (["mentioned", "met"].includes(sp.tab ?? "")
    ? sp.tab
    : "mentioned") as "mentioned" | "met";
  const view = await loadRadar(user.orgId, metro, days, pool, country, query || undefined);
  const [activeJob] = await db.select({ id: job.id, status: job.status }).from(job).where(and(
    eq(job.orgId, user.orgId),
    inArray(job.status, ["queued", "running", "stopping"]),
  )).limit(1);
  // The last finished search, only so the page can say whether the daily
  // post-scan cap cut it short. runEventScan stops rather than throwing, so
  // without this the run reads as a complete pass over a smaller world.
  // Only the 1st-degree pool spends this: it fetches each person's posts and
  // stamps last_scan_at, which is what getDailyScanUsage counts. The 2nd + 3rd
  // pool is a post SEARCH — it stores what it finds without touching anyone's
  // scan stamp, so it stays available when the budget is gone.
  const scan = await getDailyScanUsage(user.orgId);
  const firstDegreeBlocked = pool === "first" && scan.remaining === 0;

  const [lastSearch] = await db.select({ payloadJson: job.payloadJson }).from(job)
    .where(and(eq(job.orgId, user.orgId), eq(job.kind, "event_extended"), eq(job.status, "done")))
    .orderBy(desc(job.createdAt)).limit(1);
  const lastResult = (lastSearch?.payloadJson as {
    result?: { capped?: boolean; skippedHost?: number };
    excludeCompanies?: string;
  } | null);
  const searchCapped = Boolean(lastResult?.result?.capped);
  const searchSkippedHost = lastResult?.result?.skippedHost ?? 0;
  const scanning = Boolean(activeJob) || (sp.scanning === "1" && Boolean(activeJob));

  const lists = {
    active: view?.basedActive ?? [],
    mentioned: view?.mentioned ?? [],
    based: view?.basedQuiet ?? [],
    met: view?.met ?? [],
  };
  const companyFilter = (sp.company ?? "").trim();
  const rawList = lists[tab];
  // Pie always reflects the full tab (before company filter)
  const companySlices = (() => {
    const m = new Map<string, { key: string; name: string; count: number }>();
    for (const p of rawList) {
      const name = (p.companyRaw ?? "").trim();
      if (!name) continue;
      const key = companyKey(name);
      if (key === "_none") continue;
      const cur = m.get(key);
      if (cur) cur.count += 1;
      else m.set(key, { key, name, count: 1 });
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  })();
  const list = companyFilter
    ? rawList.filter((p) => companyKey(p.companyRaw) === companyFilter || (p.companyRaw ?? "").trim() === companyFilter)
    : rawList;
  const pages = Math.max(1, Math.ceil(list.length / size));
  const safePage = Math.min(page, pages);
  const paged = list.slice((safePage - 1) * size, safePage * size);
  const person = list.find((p) => p.id === sp.p) ?? paged[0] ?? null;
  const base = `/radar?metro=${metro}&days=${days}&pool=${pool}&country=${country}${query ? `&q=${encodeURIComponent(query)}` : ""}${eventName ? `&event=${encodeURIComponent(eventName)}` : ""}&size=${size}${companyFilter ? `&company=${encodeURIComponent(companyFilter)}` : ""}`;
  const baseForPie = `/radar?metro=${metro}&days=${days}&pool=${pool}&country=${country}${query ? `&q=${encodeURIComponent(query)}` : ""}${eventName ? `&event=${encodeURIComponent(eventName)}` : ""}&size=${size}&tab=${tab}`;

  return (
    <Shell user={user} active="radar">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Event radar</h1>
          <p className="mt-1 max-w-xl text-sm text-[#475467]">
            1st degree scans the recent posts of your own matched connections for
            the event name. 2nd + 3rd searches LinkedIn posts for it and imports
            up to 100 authors, grades each against your ICPs, and keeps every one
            of them out of the outreach pool — you are not connected to them, so
            nothing here is scanned, researched, drafted or exported.
          </p>
        </div>
        <form action={startEventScan} className="flex flex-wrap items-center gap-2 text-[13px]">
          <select name="pool" defaultValue={pool} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
            <option value="first">1st degree — event posts (max 100)</option>
            <option value="extended">2nd + 3rd — event search (max 100)</option>
          </select>
          <select name="country" defaultValue={country} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
            {RADAR_COUNTRIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
          </select>
          <select name="days" defaultValue={String(days)} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
            <option value="3">last 3 days</option>
            <option value="7">last 7 days</option>
            <option value="14">last 14 days</option>
          </select>
          <input name="event" defaultValue={eventName} placeholder="Event name (required)"
            className="w-44 rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5" />
          <input name="exclude" defaultValue={excludeCompanies}
            placeholder="Exclude companies (e.g. Salesforce)"
            title="Comma separated. Leaves out anyone whose headline says they WORK there — the event host, usually. Someone who merely mentions the company, or consults on it from another firm, is kept."
            className="w-56 rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5" />
          {/* NOT disabled on the cap. The pool select is a field in this same
              form, so switching it to "2nd + 3rd" does not re-render — a button
              disabled from the server-rendered pool stays dead after the user
              has chosen the pool the cap does not even apply to, which locks
              them out of the one search that still works. The warning above
              informs; startEventScan refuses and says so. */}
          <button
            title={firstDegreeBlocked
              ? `1st degree cannot run — today's post-scan budget is spent (${scan.used} of ${scan.cap}), resets in ${resetsIn(scan.resetsAt)}. Switch the first dropdown to 2nd + 3rd, which does not use it.`
              : undefined}
            className={`rounded-[8px] bg-[#263BAA] px-3 py-1.5 font-medium text-white hover:bg-[#1D2E86] ${activeJob ? "radar-banner-text" : ""}`}>
            {activeJob ? "Scanning" : "Scan"}
          </button>
        </form>
      </div>

      {sp.err === "event" && (
        <p className="mt-3 text-sm text-[#B42318]">Event name is required.</p>
      )}
      {sp.err === "cap" && (
        <p className="tnum mt-3 text-sm text-[#B54708]">
          Not started — today&apos;s post-scan budget is spent ({scan.used} of {scan.cap}), resets in{" "}
          {resetsIn(scan.resetsAt)}. Nothing was queued.
        </p>
      )}
      {/* Said before the press, not after it. Pressing Scan with the budget
          gone used to return "scanned 0" with no explanation anywhere — four
          silent no-ops in a row, on a screen that looked like it was working. */}
      {firstDegreeBlocked ? (
        <p className="tnum mt-3 text-sm text-[#B54708]">
          Today&apos;s post-scan budget is spent — {scan.used} of {scan.cap} people looked at across this
          workspace, resets in {resetsIn(scan.resetsAt)}. A 1st-degree scan reads each person&apos;s recent
          posts, so it cannot run.{" "}
          <span className="font-medium">Switch the first dropdown to “2nd + 3rd — event search” and press
          Scan</span>: it searches posts rather than people and spends none of this budget.
        </p>
      ) : pool === "first" ? (
        <p className="tnum mt-3 text-[12px] text-[#98A2B3]">
          {scan.used}/{scan.cap} people scanned today across this workspace, any scan including Today&apos;s —
          a 1st-degree run reads up to {Math.min(100, scan.remaining)} more, then stops at the cap.
        </p>
      ) : null}
      {activeJob && (
        <p className="radar-banner mt-3 text-sm text-[#067647]">
          <span className="radar-banner-text">
            {pool === "extended"
              ? "Working — searching posts, importing the authors, then grading each against your ICPs. They stay out of the outreach pool."
              : "Working — scanning your own matched connections for the event name (max 100, stops at the daily post-scan cap)."}
          </span>
          <span className="radar-dots" aria-hidden><span /><span /><span /></span>
        </p>
      )}
      {!activeJob && sp.scanning === "1" && (
        <p className="mt-3 text-sm text-[#475467]">
          Scan finished. Open <span className="font-medium">Named the event</span>.
          Empty means none of the scanned people posted that name in the window — try a shorter token (e.g. Dreamforce).
          {searchCapped && " Stopped at today's post-scan cap — the rest were not looked at."}
          {searchSkippedHost > 0 && ` ${searchSkippedHost} ${searchSkippedHost === 1 ? "author was" : "authors were"} left out as ${lastResult?.excludeCompanies ?? "an excluded company"} — the cap was filled with other people instead.`}
        </p>
      )}

      <div className="mt-4 flex gap-1 rounded-[10px] border border-[#DDE2EE] bg-white p-1 w-fit">
        <Link href={`/radar?metro=${metro}&days=${days}&pool=first&country=${country}`}
          className={`rounded-[8px] px-3 py-[7px] text-[13px] ${pool === "first" ? "bg-[#EEF1FC] font-medium text-[#263BAA]" : "text-[#475467]"}`}>
          1st degree
        </Link>
        <Link href={`/radar?metro=${metro}&days=${days}&pool=extended&country=${country}`}
          className={`rounded-[8px] px-3 py-[7px] text-[13px] ${pool === "extended" ? "bg-[#EEF1FC] font-medium text-[#263BAA]" : "text-[#475467]"}`}>
          2nd + 3rd
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
        <form action="/radar" method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="pool" value={pool} />
          <input type="hidden" name="country" value={country} />
          <input type="hidden" name="days" value={String(days)} />
          <input type="hidden" name="tab" value={tab} />
          <label className="text-[#98A2B3]">Query</label>
          <select name="q" defaultValue={query} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
            <option value="">All queries</option>
            {(view?.queries ?? []).map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
          <label className="text-[#98A2B3]">Show</label>
          <select name="size" defaultValue={String(size)} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
            <option value="10">10</option>
            <option value="25">25</option>
          </select>
          <button className="rounded-[8px] border border-[#DDE2EE] bg-white px-3 py-1.5">Apply</button>
        </form>
      </div>

      {(view?.mentioned.length ?? 0) + (view?.met.length ?? 0) > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a
            href={`/api/radar-export?pool=${pool}&country=${country}&days=${days}&tab=${tab}${query ? `&query=${encodeURIComponent(query)}` : ""}`}
            className="rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 text-[12px] text-[#475467] hover:bg-[#F4F6FB]">
            Export CSV
          </a>
          <span className="tnum text-[11px] text-[#98A2B3]">
            name, title, company, location, profile link, post link and the post itself —
            exactly the {tab === "met" ? view?.met.length ?? 0 : view?.mentioned.length ?? 0} people in this list
          </span>
        </div>
      )}

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          // "Based + active" and "Searched" are gone: loadRadar's `place`
          // clause requires mention_kind = 'event', so basedActive and
          // basedQuiet are structurally always empty. The "Searched" tile in
          // particular showed 0 for every import Radar has ever made, above a
          // tab reading "Nothing in this list yet."
          ["mentioned", "Named the event", view?.mentioned.length ?? 0],
          ["met", "Met on the floor", view?.met.length ?? 0],
        ] as const).map(([t, label, n]) => (
          <Link key={t} href={`${base}&tab=${t}`}
            className={`radar-stat rounded-[14px] border bg-white p-4 ${tab === t ? "border-[#263BAA]" : "border-[#DDE2EE]"}`}>
            <p className="tnum text-[26px] leading-8">{n}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#98A2B3]">{label}</p>
          </Link>
        ))}
      </section>

      {view && view.clusters.length > 0 && (
        <p className="mt-4 text-sm text-[#475467]">
          Companies with more than one person:{" "}
          {view.clusters.slice(0, 6).map((c, i) => (
            <span key={c.company}>{i > 0 ? " · " : ""}<span className="font-medium">{c.company}</span> ({c.count})</span>
          ))}
        </p>
      )}
      {view && view.unknownCity > 0 && (
        <p className="mt-2 text-xs text-[#98A2B3]">
          {view.unknownCity.toLocaleString()} pitchable people still have no city — Scan backfills the top-ranked ones first.
        </p>
      )}

      {companySlices.length > 0 && (
        <div className="mt-5">
          <CompanyPie
            slices={companySlices}
            hrefBase={baseForPie}
            activeKey={companyFilter || undefined}
          />
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-hidden rounded-[14px] border border-[#DDE2EE] bg-white">
          {paged.length === 0 && list.length === 0 ? (
            <p className="p-8 text-sm text-[#98A2B3]">
              {tab === "mentioned"
                ? "Nobody in this scan posted the event name. Try a shorter query or a wider day window."
                : "Nobody marked as met on the floor yet."}
            </p>
          ) : (
            <ul className="divide-y divide-[#EEF1F8]">
              {paged.map((p) => (
                <li key={p.id}>
                  <Link href={`${base}&tab=${tab}&page=${safePage}&p=${p.id}`}
                    className={`radar-row block px-4 py-3 hover:bg-[#F4F6FB] ${person?.id === p.id ? "bg-[#EEF1FC]" : ""}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">
                        {p.firstName} {p.lastName}
                        {p.eventQuery && (
                          <span className="ml-2 rounded-full bg-[#EEF1FC] px-2 py-[1px] text-[10px] font-medium text-[#263BAA]">{p.eventQuery}</span>
                        )}
                        {p.networkDistance && (
                          <span className="ml-2 rounded-full bg-[#FEF0C7] px-2 py-[1px] text-[10px] font-medium text-[#B54708]">
                            {p.networkDistance === "3" ? "3rd" : "2nd"} · not connected
                          </span>
                        )}
                      </span>
                      <span className="tnum text-[11px] text-[#98A2B3]">{p.radarScore}</span>
                    </div>
                    <p className="text-[13px] text-[#475467]">
                      {p.positionRaw ?? "—"}
                      {p.companyRaw ? ` · ${p.companyRaw}` : ""}
                      {p.country || p.location ? ` · ${p.country || p.location}` : ""}
                    </p>
                    <p className="mt-1 text-[12px] text-[#98A2B3]">
                      <ActivityBadge lastPostAt={p.lastPostAt} asOf={p.lastScanAt} />
                      {p.serviceSlug && <span> · {p.serviceSlug}</span>}
                      {p.sentAt && <span className="ml-2 text-[#B54708]">already sent</span>}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {list.length > 0 && (
            <div className="flex items-center justify-between border-t border-[#EEF1F8] px-4 py-2 text-[12px] text-[#475467]">
              <span>{list.length} people · page {safePage} of {pages}</span>
              <span className="flex gap-2">
                {safePage > 1 && <Link href={`${base}&tab=${tab}&page=${safePage - 1}`}>Prev</Link>}
                {safePage < pages && <Link href={`${base}&tab=${tab}&page=${safePage + 1}`}>Next</Link>}
              </span>
            </div>
          )}
        </div>

        <aside className="rounded-[14px] border border-[#DDE2EE] bg-white p-5">
          {!person ? (
            <p className="text-sm text-[#98A2B3]">Pick someone for a walk-up card.</p>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-wider text-[#98A2B3]">Walk-up</p>
              <h2 className="mt-1 text-lg font-semibold">
                {person.firstName} {person.lastName}
                {person.eventQuery && (
                  <span className="ml-2 align-middle text-[12px] font-medium text-[#263BAA]">· {person.eventQuery}</span>
                )}
                {person.networkDistance && (
                  <span className="ml-2 rounded-full bg-[#FEF0C7] px-2 py-[1px] align-middle text-[10px] font-medium text-[#B54708]">
                    {person.networkDistance === "3" ? "3rd" : "2nd"} · not connected
                  </span>
                )}
              </h2>
              <p className="text-sm text-[#475467]">
                {person.positionRaw ?? "—"}
                {person.companyRaw ? ` at ${person.companyRaw}` : ""}
                {person.country || person.location ? ` · ${person.country || person.location}` : ""}
              </p>
              {person.sameCompanyCount > 1 && (
                <p className="mt-1 text-[12px] text-[#263BAA]">
                  {person.sameCompanyCount} people from this company are on the radar.
                </p>
              )}
              <p className="mt-3 rounded-[8px] bg-[#F4F6FB] px-3 py-2 text-[12.5px] leading-5 text-[#475467]">
                {evidenceLabel(person)}
              </p>
              {person.sentAt && (
                <p className="mt-2 text-[12px] text-[#B54708]">Already sent — skip unless you want a walk-up anyway.</p>
              )}
              {person.serviceSlug && (
                <p className="mt-2 text-[12px] text-[#475467]">ICP · {person.serviceSlug}</p>
              )}
              {person.mentionSnippet && (
                <p className="mt-2 text-[12.5px] italic text-[#475467]">“{person.mentionSnippet}”</p>
              )}
              <p className="mt-3 text-[13px] leading-6">{opener(person)}</p>
              <p className="mt-2 text-[12px] text-[#98A2B3]">{person.why}</p>
              {person.lastScanAt && (
                <p className="mt-1 text-[11px] text-[#98A2B3]">Activity as of {ago(person.lastScanAt)}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {person.linkedinUrl && (
                  <a href={person.linkedinUrl} target="_blank" rel="noreferrer"
                    className="rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 text-[12px]">Open profile</a>
                )}
                {person.floorStatus !== "met" && (
                  <form action={markFloor.bind(null, person.id, "met", metro, days, pool, country)}>
                    <button className="rounded-[8px] bg-[#263BAA] px-3 py-1.5 text-[12px] text-white">Mark met</button>
                  </form>
                )}
                {person.floorStatus !== "skipped" && (
                  <form action={markFloor.bind(null, person.id, "skipped", metro, days, pool, country)}>
                    <button className="rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 text-[12px]">Skip</button>
                  </form>
                )}
                {person.floorStatus && (
                  <form action={clearFloor.bind(null, person.id, metro, days, pool, country)}>
                    <button className="text-[12px] text-[#475467] underline">Undo</button>
                  </form>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </Shell>
  );
}
