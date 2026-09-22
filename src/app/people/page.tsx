import Link from "next/link";
import { and, eq, gte, ilike, or, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { isLikelyCountry, resolveCountry } from "@/lib/geo-parse";
import { SelectRows } from "@/components/select-rows";
import { EnrichRowButton } from "@/components/enrich-button";
import { EnrichStatusChip } from "@/components/enrich-status-chip";
import { enrichStateOf, isEnrichable } from "@/modules/enrich/status";
import { resetsIn } from "@/modules/enrich/usage";
import { enrichAllowance } from "@/modules/enrich/queue";
import { UsageMeter } from "@/components/usage-meter";
import { enrichPerson, enrichSelectedPeople } from "./actions";

export default async function PeoplePage(props: {
  searchParams: Promise<{
    q?: string; svc?: string; page?: string; view?: string;
    country?: string; minScore?: string; fit?: string;
    run?: string; held?: string; kept?: string;
  }>;
}) {
  const user = await requirePage();
  const sp = await props.searchParams;
  const q = sp.q ?? "";
  const svc = sp.svc ?? "";
  const view = sp.view ?? "";
  const country = sp.country ?? "";
  const minScore = sp.minScore && Number(sp.minScore) > 0 ? Number(sp.minScore) : 0;
  const fit = sp.fit ?? "";
  const PAGE = 15;
  const pg = Math.max(1, Number(sp.page) || 1);

  const monthAgo = new Date(Date.now() - 30 * 86400000);
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const bucketFilter = fit === "fit"
    ? [eq(connection.bucket, "pitchable")]
    : fit === "not"
      ? [sql`bucket is distinct from 'pitchable'`]
      : [];
  const baseBucket = fit ? bucketFilter : [eq(connection.bucket, "pitchable")];

  const where = and(
    eq(connection.orgId, user.orgId),
    ...baseBucket,
    ...(view === "t1" ? [eq(connection.tier, 1)] : []),
    ...(view === "quiet" ? [sql`(last_post_at < ${monthAgo} or last_post_at is null)`] : []),
    ...(view === "week" ? [sql`last_post_at >= ${weekAgo}`] : []),
    ...(view === "sent" ? [sql`sent_at is not null`] : []),
    ...(country
      ? [or(
          eq(connection.country, country),
          sql`location ilike ${"%," + country}`,
          sql`location = ${country}`,
        )]
      : []),
    ...(minScore > 0 ? [gte(connection.score, minScore)] : []),
    ...(q ? [or(ilike(connection.firstName, `%${q}%`), ilike(connection.lastName, `%${q}%`), ilike(connection.companyRaw, `%${q}%`))] : []),
    ...(svc ? [eq(connection.serviceSlug, svc)] : []),
  );

  const rows = await db.select().from(connection).where(where)
    .orderBy(sql`rank asc nulls last`).limit(PAGE).offset((pg - 1) * PAGE);
  const [{ n: totalN }] = await db.select({ n: sql<number>`count(*)::int` }).from(connection).where(where);

  // Country options only from pitchable contacts you have (cleaned)
  const geoRows = await db.select({
    country: connection.country,
    location: connection.location,
  }).from(connection).where(and(
    eq(connection.orgId, user.orgId),
    eq(connection.bucket, "pitchable"),
  ));
  const countrySet = new Set<string>();
  for (const r of geoRows) {
    const c = resolveCountry(r.country, r.location);
    if (c && isLikelyCountry(c)) countrySet.add(c);
  }
  const countries = [...countrySet].sort((a, b) => a.localeCompare(b));

  const services = await db.selectDistinct({ s: connection.serviceSlug }).from(connection)
    .where(and(eq(connection.orgId, user.orgId), eq(connection.bucket, "pitchable"), sql`service_slug is not null`));

  const [agg] = await db.select({
    t1: sql<number>`count(*) filter (where tier = 1)::int`,
    enriched: sql<number>`count(*) filter (where enrich_status = 'done')::int`,
    avgScore: sql<number>`coalesce(round(avg(score)), 0)::int`,
  }).from(connection).where(and(eq(connection.orgId, user.orgId), eq(connection.bucket, "pitchable")));
  const pages = Math.max(1, Math.ceil(totalN / PAGE));
  const params = (over: Record<string, string | number> = {}) =>
    Object.entries({
      q, svc, view, country, minScore: minScore || "", fit, page: pg, ...over,
    }).filter(([, v]) => v !== "" && v !== 0).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  const qs = (over: Record<string, string | number>) => "/people?" + params(over);
  // Where a row action returns to: these filters, this page, no stale run notice.
  const back = params();

  // One number for the ticking limit and the server clamp — see enrichAllowance.
  const { allowance, room, ...usage } = await enrichAllowance(user.orgId);
  const selectable = allowance > 0;
  const queued = Number(sp.run ?? 0) || 0;
  const held = Number(sp.held ?? 0) || 0;
  const kept = Number(sp.kept ?? 0) || 0;

  return (
    <Shell user={user} active="people">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">People</h1>
        <UsageMeter used={usage.used} cap={usage.cap} resetsAt={usage.resetsAt} bar />
      </div>
      <p className="mt-1 text-sm text-[#98A2B3]">
        Everyone your ICPs matched. Tick the people you want researched and run them together, or open a
        name for their full profile — pain points, and a draft you can copy into LinkedIn.
      </p>

      {(queued > 0 || held > 0 || kept > 0 || sp.run === "0") && (
        <div className={`mt-4 rounded-[10px] border p-3 text-sm ${held > 0 || queued === 0
          ? "border-[#E7CE96] bg-[#FEFBF3] text-[#B54708]"
          : "border-[#DDE2EE] bg-[#F6F7FB] text-[#475467]"}`}>
          {queued > 0 && (
            <p>
              Researching {queued} {queued === 1 ? "person" : "people"} now — watch the top bar. Each row
              flips to <span className="font-medium">enriched</span> as it lands.
            </p>
          )}
          {held > 0 && (
            <p className={queued > 0 ? "mt-1" : ""}>
              {held} {held === 1 ? "person was" : "people were"} not queued — that would pass today&apos;s
              ceiling of {usage.cap}. Tick them again after the reset.
            </p>
          )}
          {kept > 0 && (
            <p className={queued > 0 || held > 0 ? "mt-1" : ""}>
              {kept} already researched or in flight, so {kept === 1 ? "it was" : "they were"} left alone —
              nothing was spent twice.
            </p>
          )}
          {queued === 0 && held === 0 && kept === 0 && <p>Nobody was queued — those rows are already researched or in flight.</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {([["", "All fit"], ["t1", "Tier 1"], ["quiet", "Going quiet"], ["week", "Posted this week"], ["sent", "Sent"]] as const).map(([v, label]) => (
          <Link key={v} href={qs({ view: v, fit: "", page: 1 })}
            className={`rounded-[8px] border px-3 py-1.5 text-[12.5px] ${view === v && !fit
              ? "border-[#263BAA] bg-[#EEF1FC] text-[#263BAA]" : "border-[#DDE2EE] text-[#475467] hover:bg-[#F4F6FB]"}`}>{label}</Link>
        ))}
        {([["fit", "Fit"], ["not", "Not fit"]] as const).map(([v, label]) => (
          <Link key={v} href={qs({ fit: v, view: "", page: 1 })}
            className={`rounded-[8px] border px-3 py-1.5 text-[12.5px] ${fit === v
              ? "border-[#263BAA] bg-[#EEF1FC] text-[#263BAA]" : "border-[#DDE2EE] text-[#475467] hover:bg-[#F4F6FB]"}`}>{label}</Link>
        ))}
        {([["70", "Score 70+"], ["50", "Score 50+"]] as const).map(([v, label]) => (
          <Link key={v} href={qs({ minScore: v, page: 1 })}
            className={`rounded-[8px] border px-3 py-1.5 text-[12.5px] ${String(minScore) === v
              ? "border-[#263BAA] bg-[#EEF1FC] text-[#263BAA]" : "border-[#DDE2EE] text-[#475467] hover:bg-[#F4F6FB]"}`}>{label}</Link>
        ))}
      </div>

      <div className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <form className="flex flex-wrap items-center gap-3" action="/people">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="fit" value={fit} />
          <input name="q" defaultValue={q} placeholder="Search name or company…"
            className="w-56 rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2 text-sm" />
          <select name="country" defaultValue={country} className="max-w-[180px] rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2 text-sm">
            <option value="">All countries</option>
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select name="svc" defaultValue={svc} className="rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2 text-sm">
            <option value="">All ICPs</option>
            {services.map((x) => x.s && <option key={x.s} value={x.s}>{x.s}</option>)}
          </select>
          <select name="minScore" defaultValue={minScore ? String(minScore) : ""} className="rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2 text-sm">
            <option value="">Any score</option>
            <option value="50">50+</option>
            <option value="70">70+</option>
            <option value="85">85+</option>
          </select>
          <button className="rounded-[8px] bg-[#263BAA] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D2E86]">Filter</button>
        </form>

        <p className="mt-3 text-[12px] text-[#98A2B3]">
          {agg?.t1 ?? 0} tier 1 · {agg?.enriched ?? 0} researched · avg score {agg?.avgScore ?? 0}
          {" · "}<span className="tnum">{totalN.toLocaleString()}</span> in this filter
        </p>

        {room === 0 && (
          <p className="mt-3 rounded-[10px] border border-[#E7CE96] bg-[#FEFBF3] p-3 text-[12.5px] text-[#B54708]">
            Today&apos;s {usage.cap} researched — the ceiling resets in {resetsIn(usage.resetsAt)}. Everyone
            already researched still opens below.
          </p>
        )}

        <SelectRows enabled={selectable} max={allowance} action={enrichSelectedPeople.bind(null, back)}>
        <div className="pane-scroll mt-4 max-h-[52vh]"><table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-[#98A2B3]">
            <tr>
              {selectable && <th className="w-9 py-2 pr-3"><span className="sr-only">Select</span></th>}
              <th className="py-2 pr-3">Rank</th>
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Company</th>
              <th className="py-2 pr-3">Title</th>
              <th className="py-2 pr-3">Country</th>
              <th className="py-2 pr-3">Fit</th>
              <th className="py-2 pr-3">Score</th>
              <th className="py-2 pr-3">Tier</th>
              <th className="py-2 pr-3">Last post</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF1F8]">
            {rows.map((p) => {
              const rowCountry = resolveCountry(p.country, p.location);
              const state = enrichStateOf(p);
              const enrichable = isEnrichable(state);
              const href = `/batches/${p.batchId}?view=${state === "enriched" ? "enriched" : "pitchable"}&p=${p.id}`;
              return (
                <tr key={p.id} className="hover:bg-[#F4F6FB]">
                  {selectable && (
                    <td className="py-2.5 pr-3">
                      <input type="checkbox" name="ids" value={p.id} disabled={!enrichable}
                        title={enrichable ? "Include in the next research run" : `Already ${state === "researching" ? "in flight" : "researched"}`}
                        className="h-3.5 w-3.5 accent-[#263BAA] disabled:opacity-30" />
                    </td>
                  )}
                  <td className="tnum py-2.5 pr-3 text-[#475467]">#{p.rank ?? "—"}</td>
                  <td className="py-2.5 pr-3 font-medium">
                    {p.batchId ? (
                      <Link href={href} className="text-[#101828] hover:text-[#263BAA]">
                        {p.firstName} {p.lastName}
                      </Link>
                    ) : (
                      <span>{p.firstName} {p.lastName}</span>
                    )}
                  </td>
                  <td className="max-w-[180px] truncate py-2.5 pr-3 text-[#475467]">{p.companyRaw ?? "—"}</td>
                  <td className="max-w-[170px] truncate py-2.5 pr-3 text-[#475467]" title={p.positionRaw ?? undefined}>
                    {p.positionRaw ?? "—"}
                  </td>
                  <td className="max-w-[120px] truncate py-2.5 pr-3 text-[#475467]">{rowCountry ?? "—"}</td>
                  <td className="py-2.5 pr-3">
                    <span title={p.matchWhy ?? undefined}
                      className={`rounded px-1.5 py-0.5 text-[11px] ${
                      p.bucket === "pitchable" ? "bg-[#ECFDF3] text-[#067647]" : "bg-[#F4F6FB] text-[#475467]"
                    }`}>
                      {p.bucket === "pitchable"
                        ? `Fit${p.serviceSlug ? ` · ${p.serviceSlug}` : ""}`
                        : p.bucket ?? "—"}
                    </span>
                  </td>
                  <td className="tnum py-2.5 pr-3">{p.score ?? "—"}</td>
                  <td className="py-2.5 pr-3">{p.tier ? (
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${p.tier === 1 ? "bg-[#EEF1FC] text-[#263BAA]" : "bg-[#F4F6FB] text-[#475467]"}`}>T{p.tier}</span>
                  ) : "—"}</td>
                  <td className="tnum py-2.5 pr-3 text-xs text-[#98A2B3]">
                    {p.lastPostAt ? p.lastPostAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}
                  </td>
                  <td className="py-2.5 pr-3">
                    <EnrichStatusChip status={p.enrichStatus} enrichedAt={p.enrichedAt} />
                  </td>
                  <td className="py-2.5 text-right">
                    {!p.batchId ? "—" : enrichable && selectable ? (
                      <EnrichRowButton failed={state === "failed"}
                        action={enrichPerson.bind(null, p.id, back)} />
                    ) : (
                      <Link href={href} className="text-xs text-[#263BAA] underline">profile</Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        </SelectRows>
        <div className="mt-3 flex items-center justify-between text-sm text-[#98A2B3]">
          <span className="tnum">{totalN.toLocaleString()} people · page {pg}/{pages}</span>
          <span className="flex gap-2">
            {pg > 1 && <Link href={qs({ page: pg - 1 })} className="rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 hover:bg-[#F4F6FB]">← Prev</Link>}
            {pg < pages && <Link href={qs({ page: pg + 1 })} className="rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 hover:bg-[#F4F6FB]">Next →</Link>}
          </span>
        </div>
      </div>
    </Shell>
  );
}
