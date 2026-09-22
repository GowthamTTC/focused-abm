import Link from "next/link";
import { Shell, requirePage } from "@/app/shell";
import { accountCompanies } from "@/modules/accounts/query";
import { accountCoverage, formatUnitLines, loadAccountMap } from "@/modules/accounts/org-map";
import { assignUnit, clearUnits, remapUnits, removeMap, saveMap } from "./actions";

const CARD = "rounded-[12px] border border-[#E4E7EC] bg-white p-4";
const INPUT = "w-full rounded-[8px] border border-[#DDE2EE] bg-white px-2.5 py-1.5 text-[13px]";
const BTN = "rounded-[8px] bg-[#263BAA] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#1d2d85]";
const BTN_GHOST = "rounded-[8px] border border-[#DDE2EE] bg-white px-3 py-1.5 text-[13px] hover:bg-[#F9FAFB]";

export default async function AccountMapPage({ params, searchParams }: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ saved?: string; matched?: string; cleared?: string; assigned?: string; err?: string }>;
}) {
  const user = await requirePage();
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const sp = await searchParams;

  const [map, companies] = await Promise.all([
    loadAccountMap(user.orgId, key),
    accountCompanies(user.orgId),
  ]);
  const known = companies.find((c) => c.key === key);
  const name = map?.name ?? known?.name ?? key;
  const coverage = map ? await accountCoverage(user.orgId, key) : null;

  return (
    <Shell user={user} active="accounts">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-[#667085]">
            <Link href="/accounts" className="hover:text-[#263BAA]">Accounts</Link> · Account map
          </p>
          <h1 className="mt-1 text-xl font-semibold">{name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#475467]">
            Your network shows the units you have landed in. It cannot show the ones
            you have not — an absence leaves no row to count. Paste the org chart and
            this page becomes the difference between the two.
          </p>
        </div>
        {coverage && (
          <div className="flex gap-4 text-right">
            <Stat label="Units mapped" value={coverage.totals.units} />
            <Stat label="Landed" value={coverage.totals.unitsLanded} />
            <Stat label="Whitespace" value={coverage.whitespace.length} tone="amber" />
            <Stat label="People held" value={coverage.totals.people} />
          </div>
        )}
      </div>

      {sp.saved && (
        <p className="mt-3 rounded-[8px] bg-[#ECFDF3] px-3 py-2 text-[13px] text-[#027A48]">
          Map saved. {sp.matched ?? "0"} {Number(sp.matched) === 1 ? "person" : "people"} matched to a unit by name.
        </p>
      )}
      {sp.cleared && (
        <p className="mt-3 rounded-[8px] bg-[#F2F4F7] px-3 py-2 text-[13px] text-[#344054]">
          Cleared {sp.cleared} rule-assigned {Number(sp.cleared) === 1 ? "row" : "rows"}. Hand-assigned ones were kept.
        </p>
      )}
      {sp.err === "confirm" && (
        <p className="mt-3 rounded-[8px] bg-[#FEF3F2] px-3 py-2 text-[13px] text-[#B42318]">
          Tick the confirm box first.
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          {coverage ? (
            <>
              <section className={CARD}>
                <h2 className="text-[15px] font-semibold">Where you have landed</h2>
                {coverage.landed.length === 0 ? (
                  <p className="mt-2 text-[13px] text-[#667085]">
                    No unit matched anyone yet. Either the map is empty, or nobody&apos;s
                    title names a unit — use the unmapped list below to place them by hand.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {coverage.landed.map((u) => (
                      <li key={u.unit.name} className="rounded-[10px] border border-[#EAECF0] p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[14px] font-medium">{u.unit.name}</span>
                          <span className="text-[12px] text-[#667085]">
                            {u.peopleCount} {u.peopleCount === 1 ? "person" : "people"}
                            {u.tier1Count > 0 && ` · ${u.tier1Count} tier 1`}
                            {u.bestRank != null && ` · best rank #${u.bestRank}`}
                          </span>
                        </div>
                        {u.services.length > 0 && (
                          <p className="mt-1 text-[12px] text-[#667085]">ICP: {u.services.join(", ")}</p>
                        )}
                        <ul className="mt-2 space-y-1">
                          {u.people.slice(0, 6).map((p) => (
                            <li key={p.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                              <span>
                                <Link href={`/people/${p.id}`} className="hover:text-[#263BAA]">{p.name}</Link>
                                <span className="text-[#667085]"> — {p.positionRaw ?? "—"}</span>
                              </span>
                              <span className="shrink-0 text-[11px] text-[#98A2B3]">
                                {p.divisionMethod === "manual" ? "by hand" : "by name"}
                              </span>
                            </li>
                          ))}
                          {u.people.length > 6 && (
                            <li className="text-[12px] text-[#98A2B3]">+ {u.people.length - 6} more</li>
                          )}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className={CARD}>
                <h2 className="text-[15px] font-semibold">
                  Whitespace
                  <span className="ml-2 text-[12px] font-normal text-[#667085]">
                    mapped units with nobody in them
                  </span>
                </h2>
                {coverage.whitespace.length === 0 ? (
                  <p className="mt-2 text-[13px] text-[#667085]">
                    {coverage.totals.units === 0
                      ? "Nothing to compare against yet — add the units on the right."
                      : "Every mapped unit has at least one person in it."}
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {coverage.whitespace.map((u) => (
                      <li key={u.name}
                        className="rounded-[8px] border border-[#FEC84B] bg-[#FFFCF5] px-2.5 py-1.5 text-[13px] text-[#B54708]">
                        {u.name}
                        {u.note && <span className="ml-1 text-[11px] text-[#98A2B3]">{u.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {coverage.unmapped.length > 0 && (
                <section className={CARD}>
                  <h2 className="text-[15px] font-semibold">
                    Unmapped
                    <span className="ml-2 text-[12px] font-normal text-[#667085]">
                      at this account, no unit named in their title
                    </span>
                  </h2>
                  <ul className="mt-3 space-y-2">
                    {coverage.unmapped.slice(0, 25).map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                        <span className="min-w-0">
                          <Link href={`/people/${p.id}`} className="hover:text-[#263BAA]">{p.name}</Link>
                          <span className="text-[#667085]"> — {p.positionRaw ?? "—"}</span>
                        </span>
                        <form action={assignUnit} className="flex items-center gap-1.5">
                          <input type="hidden" name="key" value={key} />
                          <input type="hidden" name="connId" value={p.id} />
                          <select name="unit" defaultValue=""
                            className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1 text-[12px]">
                            <option value="">Place in…</option>
                            {coverage.map.units.map((u) => (
                              <option key={u.name} value={u.name}>{u.name}</option>
                            ))}
                          </select>
                          <button className={BTN_GHOST}>Set</button>
                        </form>
                      </li>
                    ))}
                    {coverage.unmapped.length > 25 && (
                      <li className="text-[12px] text-[#98A2B3]">
                        + {coverage.unmapped.length - 25} more
                      </li>
                    )}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <section className={CARD}>
              <h2 className="text-[15px] font-semibold">No map yet</h2>
              <p className="mt-2 text-[13px] text-[#475467]">
                Add the account&apos;s units on the right — one per line, with the
                spellings people actually use in a headline after a pipe. Saving
                runs the free name-match pass straight away; nothing is sent to a
                model and nothing is fetched from LinkedIn.
              </p>
            </section>
          )}
        </div>

        <aside className="space-y-5">
          <section className={CARD}>
            <h2 className="text-[15px] font-semibold">{map ? "Edit the map" : "Start the map"}</h2>
            <form action={saveMap} className="mt-3 space-y-3">
              <input type="hidden" name="key" value={key} />
              <label className="block">
                <span className="text-[12px] text-[#475467]">Account name</span>
                <input name="name" defaultValue={name} className={INPUT} required />
              </label>
              <label className="block">
                <span className="text-[12px] text-[#475467]">
                  Also counts as (comma separated)
                </span>
                <input name="aliases" defaultValue={(map?.aliases ?? []).join(", ")}
                  placeholder="Allergan Aesthetics, Allergan" className={INPUT} />
                <span className="mt-1 block text-[11px] text-[#98A2B3]">
                  Other company spellings that roll up here — an acquired brand counts
                  as coverage of its own unit, not a separate account.
                </span>
              </label>
              <label className="block">
                <span className="text-[12px] text-[#475467]">Units — one per line</span>
                <textarea name="units" rows={12} defaultValue={formatUnitLines(map?.units ?? [])}
                  placeholder={"Medical Affairs & HEOR | HEOR, Health Economics\nAllergan Aesthetics | Allergan, Botox\nCommercial Operations"}
                  className={`${INPUT} font-mono text-[12px] leading-5`} />
              </label>
              <button className={BTN}>Save and match</button>
            </form>
          </section>

          {map && (
            <section className={CARD}>
              <h2 className="text-[15px] font-semibold">Maintenance</h2>
              <form action={remapUnits} className="mt-3">
                <input type="hidden" name="key" value={key} />
                <button className={BTN_GHOST}>Re-run name match</button>
                <span className="ml-2 text-[11px] text-[#98A2B3]">Free. Only touches unplaced rows.</span>
              </form>
              <form action={clearUnits} className="mt-3 flex items-center gap-2">
                <input type="hidden" name="key" value={key} />
                <label className="flex items-center gap-1.5 text-[12px] text-[#475467]">
                  <input type="checkbox" name="confirm" /> confirm
                </label>
                <button className={BTN_GHOST}>Clear matched units</button>
              </form>
              <form action={removeMap} className="mt-3 flex items-center gap-2">
                <input type="hidden" name="key" value={key} />
                <label className="flex items-center gap-1.5 text-[12px] text-[#475467]">
                  <input type="checkbox" name="confirm" /> confirm
                </label>
                <button className="rounded-[8px] border border-[#FDA29B] bg-white px-3 py-1.5 text-[13px] text-[#B42318] hover:bg-[#FEF3F2]">
                  Delete map
                </button>
              </form>
              <p className="mt-3 text-[11px] text-[#98A2B3]">
                Last saved {map.updatedAt.toISOString().slice(0, 10)} · {map.source}
              </p>
            </section>
          )}
        </aside>
      </div>
    </Shell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" }) {
  return (
    <div>
      <div className={`text-[20px] font-semibold ${tone === "amber" ? "text-[#B54708]" : "text-[#101828]"}`}>
        {value}
      </div>
      <div className="text-[11px] text-[#667085]">{label}</div>
    </div>
  );
}
