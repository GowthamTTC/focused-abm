import Link from "next/link";
import { Shell, requirePage } from "@/app/shell";
import { ActivityBadge, ago } from "@/components/dash-bits";
import { US_METROS } from "@/modules/geo/metros";
import { RADAR_COUNTRIES, countryBySlug } from "@/modules/geo/countries";
import { loadRadar, type RadarPerson } from "@/modules/radar/query";
import { startEventScan, markFloor, clearFloor } from "./actions";

function evidenceLabel(p: RadarPerson): string {
  if (p.presence === "mentioned_active") {
    if (p.mentionKind === "event") return "Named the event in a recent post — not confirmed based here";
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
  searchParams: Promise<{ metro?: string; days?: string; p?: string; tab?: string; scanning?: string; pool?: string; err?: string; country?: string }>;
}) {
  const user = await requirePage();
  const sp = await searchParams;
  const metro = US_METROS.some((m) => m.slug === sp.metro) ? sp.metro! : "sf-bay-area";
  const days = [3, 7, 14].includes(Number(sp.days)) ? Number(sp.days) : 7;
  const pool = sp.pool === "extended" ? "extended" : "first";
  const country = countryBySlug(sp.country)?.slug ?? "united-states";
  const tab = (["active", "mentioned", "based", "met"].includes(sp.tab ?? "") ? sp.tab : "active") as
    "active" | "mentioned" | "based" | "met";
  const view = await loadRadar(user.orgId, metro, days, pool, country);

  const lists = {
    active: view?.basedActive ?? [],
    mentioned: view?.mentioned ?? [],
    based: view?.basedQuiet ?? [],
    met: view?.met ?? [],
  };
  const list = lists[tab];
  const person = list.find((p) => p.id === sp.p) ?? list[0] ?? null;
  const base = `/radar?metro=${metro}&days=${days}&pool=${pool}&country=${country}`;

  return (
    <Shell user={user} active="radar">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Event radar</h1>
          <p className="mt-1 max-w-xl text-sm text-[#475467]">
            1st degree uses a US metro. 2nd + 3rd searches by country
            (US or India) and only keeps people who named the event in a post.
          </p>
        </div>
        <form action={startEventScan} className="flex flex-wrap items-center gap-2 text-[13px]">
          <select name="pool" defaultValue={pool} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
            <option value="first">1st degree — entire pool</option>
            <option value="extended">2nd + 3rd — event search (max 100)</option>
          </select>
          {pool === "extended" ? (
            <select name="country" defaultValue={country} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
              {RADAR_COUNTRIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>
          ) : (
            <select name="metro" defaultValue={metro} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
              {US_METROS.map((m) => <option key={m.slug} value={m.slug}>{m.label}</option>)}
            </select>
          )}
          <select name="days" defaultValue={String(days)} className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5">
            <option value="3">last 3 days</option>
            <option value="7">last 7 days</option>
            <option value="14">last 14 days</option>
          </select>
          <input name="event" placeholder={pool === "extended" ? "Event name (required)" : "Event name (optional)"}
            className="w-44 rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5" />
          <button className="rounded-[8px] bg-[#263BAA] px-3 py-1.5 font-medium text-white hover:bg-[#1D2E86]">
            Scan
          </button>
        </form>
      </div>

      {sp.err === "event" && (
        <p className="mt-3 text-sm text-[#B42318]">2nd + 3rd degree search needs an event name.</p>
      )}
      {sp.scanning === "1" && (
        <p className="mt-3 text-sm text-[#067647]">
          {pool === "extended"
            ? "Queued — search, then keep only people whose posts name the event."
            : "Scan queued — every 1st-degree matchable contact."}
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

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ["active", "Based + active", view?.basedActive.length ?? 0],
          ["mentioned", pool === "extended" ? "Named the event" : "Mentioned travel", view?.mentioned.length ?? 0],
          ["based", "Based, quiet", view?.basedQuiet.length ?? 0],
          ["met", "Met on the floor", view?.met.length ?? 0],
        ] as const).map(([t, label, n]) => (
          <Link key={t} href={`${base}&tab=${t}`}
            className={`rounded-[14px] border bg-white p-4 ${tab === t ? "border-[#263BAA]" : "border-[#DDE2EE]"}`}>
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

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-hidden rounded-[14px] border border-[#DDE2EE] bg-white">
          {list.length === 0 ? (
            <p className="p-8 text-sm text-[#98A2B3]">
              {tab === "mentioned" && pool === "extended"
                ? "Nobody in this window posted the event name. Scan again after the event, or try a shorter name (e.g. Unbound)."
                : tab === "active"
                ? "Nobody based here with a post in this window. Scan to refresh activity, or check Mentioned travel."
                : "Nothing in this list yet."}
            </p>
          ) : (
            <ul className="divide-y divide-[#EEF1F8]">
              {list.map((p) => (
                <li key={p.id}>
                  <Link href={`${base}&tab=${tab}&p=${p.id}`}
                    className={`block px-4 py-3 hover:bg-[#F4F6FB] ${person?.id === p.id ? "bg-[#EEF1FC]" : ""}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{p.firstName} {p.lastName}</span>
                      <span className="tnum text-[11px] text-[#98A2B3]">{p.radarScore}</span>
                    </div>
                    <p className="text-[13px] text-[#475467]">
                      {p.positionRaw ?? "—"}{p.companyRaw ? ` · ${p.companyRaw}` : ""}
                    </p>
                    <p className="mt-1 text-[12px] text-[#98A2B3]">
                      <ActivityBadge lastPostAt={p.lastPostAt} asOf={p.lastScanAt} />
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="rounded-[14px] border border-[#DDE2EE] bg-white p-5">
          {!person ? (
            <p className="text-sm text-[#98A2B3]">Pick someone for a walk-up card.</p>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-wider text-[#98A2B3]">Walk-up</p>
              <h2 className="mt-1 text-lg font-semibold">{person.firstName} {person.lastName}</h2>
              <p className="text-sm text-[#475467]">
                {person.positionRaw ?? "—"}{person.companyRaw ? ` at ${person.companyRaw}` : ""}
              </p>
              {person.sameCompanyCount > 1 && (
                <p className="mt-1 text-[12px] text-[#263BAA]">
                  {person.sameCompanyCount} people from this company are on the radar.
                </p>
              )}
              <p className="mt-3 rounded-[8px] bg-[#F4F6FB] px-3 py-2 text-[12.5px] leading-5 text-[#475467]">
                {evidenceLabel(person)}
              </p>
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
