import Link from "next/link";
import { Shell, requirePage } from "@/app/shell";
import { loadL3 } from "@/modules/accounts/l3";
import { refreshFocusSignals } from "./actions";
import { CARD, HalfGauge, LegendDot, Meter, OrgTree, VolumeChart } from "./parts";

const BTN = "inline-flex items-center gap-1.5 rounded-[8px] bg-[#4F46E5] px-3.5 py-2 text-[13px] font-medium text-white hover:bg-[#4338CA]";
const BTN_GHOST = "inline-flex items-center gap-1.5 rounded-[8px] border border-[#E4E7EC] bg-white px-3 py-2 text-[13px] text-[#344054] hover:bg-[#F9FAFB]";

function toneColor(s: number | null): string {
  if (s === null) return "#98A2B3";
  if (s >= 20) return "#12B76A";
  if (s <= -20) return "#F04438";
  return "#F79009";
}
function toneWord(s: number | null): string {
  if (s === null) return "Not scorable";
  if (s >= 20) return "Positive";
  if (s <= -20) return "Negative";
  return "Mixed";
}

function Tile({ label, value, sub, tone }: { label: string; value: string | number; sub: string; tone?: string }) {
  return (
    <div className="rounded-[12px] border border-[#EDEFF3] px-4 py-3">
      <div className="text-[11.5px] text-[#667085]">{label}</div>
      <div className="mt-1 text-[26px] font-semibold leading-none" style={{ color: tone ?? "#101828" }}>{value}</div>
      <div className="mt-1.5 text-[11px] text-[#98A2B3]">{sub}</div>
    </div>
  );
}

export default async function L3Page({ params, searchParams }: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ focus?: string; alias?: string; queued?: string; country?: string }>;
}) {
  const user = await requirePage();
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const sp = await searchParams;
  const aliases = (sp.alias ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  const country = (sp.country ?? "").trim();
  const v = await loadL3(user.orgId, key, key, aliases, country || undefined);
  const focusRaw = (sp.focus ?? "").trim();
  const focus = focusRaw;
  const focusUnit = v.units.find((u) => u.unit.name.toLowerCase() === focus.toLowerCase());
  const p = v.map?.profile ?? {};

  if (!v.map) {
    return (
      <Shell user={user} active="accounts">
        <h1 className="text-xl font-semibold">L3 Account Intelligence</h1>
        <section className={`${CARD} mt-4 p-4`}>
          <p className="text-[13px] text-[#475467]">
            No org map for this account yet, and whitespace is the difference between a
            map and the network.{" "}
            <Link href={`/accounts/${encodeURIComponent(key)}`} className="text-[#4F46E5] hover:underline">
              Build the map first
            </Link>.
          </p>
        </section>
      </Shell>
    );
  }

  // The focused unit is the point of the diagram, so it is placed first and can
  // never be cut by the cap. Units are stored engaged-first, so without this the
  // tree showed eight pockets and left the whitespace unit being investigated
  // off the chart entirely.
  const TREE_MAX = 8;
  const focusFirst = [
    ...v.units.filter((u) => u.unit.name.toLowerCase() === focus.toLowerCase()),
    ...v.units.filter((u) => u.unit.name.toLowerCase() !== focus.toLowerCase()),
  ];
  const treeNodes = focusFirst.slice(0, TREE_MAX).map((u) => ({
    name: u.unit.name,
    state: (u.unit.name.toLowerCase() === focus.toLowerCase()
      ? "focus"
      : u.engaged || u.people > 0 ? "engaged" : "whitespace") as "focus" | "engaged" | "whitespace",
    sub: u.unit.name.toLowerCase() === focus.toLowerCase() ? "No Ariel engagement" : undefined,
  }));

  return (
    <Shell user={user} active="accounts">
      {/* ── header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12.5px] text-[#667085]">
            <Link href="/accounts" className="hover:text-[#4F46E5]">Accounts</Link>
            {" › "}
            <Link href={`/accounts/${encodeURIComponent(key)}`} className="hover:text-[#4F46E5]">{v.companyName}</Link>
            {focusUnit && <>{" › "}<span className="font-medium text-[#4F46E5]">{focusUnit.unit.name}</span></>}
          </p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-.01em]">L3 Account Intelligence</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-[#475467]">
            Map <span className="font-semibold text-[#101828]">whitespace</span>, read change
            signals, and see who still has to be identified before an expansion play is real.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={BTN_GHOST}>Last 90 days</span>
          <span className="inline-flex overflow-hidden rounded-[8px] border border-[#E4E7EC] text-[12.5px]">
            {[["", "Worldwide"], ["United States", "United States"]].map(([val, label]) => {
              const qs = new URLSearchParams();
              if (focusRaw) qs.set("focus", focusRaw);
              if (sp.alias) qs.set("alias", sp.alias);
              if (val) qs.set("country", val);
              const on = country.toLowerCase() === val.toLowerCase();
              return (
                <Link key={label} href={`/accounts/${encodeURIComponent(key)}/l3?${qs}`}
                  className={`px-3 py-2 ${on ? "bg-[#EEF4FF] font-medium text-[#4F46E5]" : "bg-white text-[#475467] hover:bg-[#F9FAFB]"}`}>
                  {label}
                </Link>
              );
            })}
          </span>
          {focus && (
            <form action={refreshFocusSignals}>
              <input type="hidden" name="key" value={key} />
              <input type="hidden" name="focus" value={focus} />
              <button className={BTN_GHOST}>↻ Refresh signals</button>
            </form>
          )}
          <Link href={`/intel?c=${encodeURIComponent(focus ? focus.toLowerCase() : key)}&n=${encodeURIComponent(focusUnit?.unit.name ?? v.companyName)}&alias=${encodeURIComponent(sp.alias ?? "")}`}
            className={BTN}>Open signal detail →</Link>
        </div>
      </div>

      {sp.queued && (
        <p className="mt-3 rounded-[8px] bg-[#EEF4FF] px-3 py-2 text-[13px] text-[#4F46E5]">
          Scan queued — refresh in a minute.
        </p>
      )}

      {/* ── account card ── */}
      <section className={`${CARD} mt-4 p-5`}>
        <div className="grid gap-5 lg:grid-cols-[minmax(240px,1fr)_2.4fr]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[26px] font-semibold tracking-[-.02em] text-[#101828]">{v.companyName}</span>
              {p.badge && (
                <span className="rounded-full bg-[#EEF4FF] px-2.5 py-1 text-[11px] font-medium text-[#4F46E5]">{p.badge}</span>
              )}
            </div>
            {p.description && (
              <p className="mt-2 max-w-sm text-[12.5px] leading-relaxed text-[#475467]">{p.description}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-[#667085]">
              {p.location && <span>◍ {p.location}</span>}
              {p.employees && <span>◌ {p.employees}</span>}
              {p.website && (
                <a href={`https://${p.website.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer"
                  className="text-[#4F46E5] hover:underline">{p.website}</a>
              )}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Existing Ariel pockets" value={v.counts.pockets} sub="asserted by the team" />
            <Tile label="Mapped functions" value={v.counts.mapped} sub={`across ${v.companyName}`} />
            <Tile label="Whitespace functions" value={v.counts.whitespace} sub="no engagement recorded" tone="#B54708" />
            <div className="rounded-[12px] border border-[#D3F8DF] bg-[#F6FEF9] px-3 py-2">
              <HalfGauge value={v.whitespacePct} color="#B54708"
                big="Whitespace" small={`${v.counts.whitespace} of ${v.counts.mapped} functions`} />
            </div>
          </div>
        </div>
      </section>

      {/* ── footprint + org tree ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_1.45fr]">
        <section className={`${CARD} p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Ariel footprint inside {v.companyName}</h2>
            <span className="rounded-full bg-[#ECFDF3] px-2.5 py-1 text-[11px] font-medium text-[#027A48]">
              {v.counts.pockets} active pockets
            </span>
          </div>
          <p className="mt-1 text-[12px] text-[#667085]">
            Organically landed business areas — asserted by the team, not evidenced by
            anyone in this workspace&apos;s network.
          </p>
          <ul className="mt-3.5 flex flex-wrap gap-2">
            {v.footprint.map((u) => (
              <li key={u.name}
                className="rounded-[8px] border border-[#D3F8DF] bg-[#F6FEF9] px-2.5 py-2 text-[12px] font-medium text-[#027A48]">
                ✓ {u.name}
              </li>
            ))}
            {v.footprint.length === 0 && (
              <li className="text-[13px] text-[#667085]">None marked — star units with <code>*</code> in the map editor.</li>
            )}
          </ul>
        </section>

        <section className={`${CARD} p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold">Org-chart whitespace map</h2>
              <p className="mt-1 text-[12px] text-[#667085]">
                A first-draft org chart — correct it in the{" "}
                <Link href={`/accounts/${encodeURIComponent(key)}`} className="text-[#4F46E5] hover:underline">map editor</Link>.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <LegendDot color="#12B76A" label="Current engagement" />
              <LegendDot color="#D0D5DD" label="Potential whitespace" />
              <LegendDot color="#F04438" label="Priority opportunity" />
            </div>
          </div>
          <OrgTree root={v.companyName} nodes={treeNodes} />
          {v.units.length > TREE_MAX && (
            <p className="mt-3 text-center text-[11px] text-[#98A2B3]">
              + {v.units.length - TREE_MAX} further functions mapped, {v.counts.whitespace} of {v.counts.mapped} with no engagement
            </p>
          )}
        </section>
      </div>

      {/* ── change signals + sentiment ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_1fr]">
        <section className={`${CARD} p-5`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">{focusUnit?.unit.name ?? v.companyName} — change signals</h2>
            <span className="rounded-full bg-[#FEF3F2] px-2.5 py-1 text-[11px] font-medium text-[#B42318]">
              {v.counts.changeSignals} signals
            </span>
          </div>
          <p className="mt-1 text-[12px] text-[#667085]">Recent news, filings and leadership posts.</p>
          {v.changeSignals.length === 0 ? (
            <p className="mt-3 text-[13px] text-[#667085]">Nothing stored yet.</p>
          ) : (
            <ul className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
              {v.changeSignals.slice(0, 4).map((s) => (
                <li key={s.id} className="rounded-[10px] border border-[#EDEFF3] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[10px] font-medium text-[#475467]">
                      {s.kind === "linkedin" ? "LinkedIn" : s.source ?? s.kind}
                    </span>
                    <span className="text-[10px] text-[#98A2B3]">
                      {s.publishedAt ? s.publishedAt.toISOString().slice(0, 10) : "undated"}
                    </span>
                  </div>
                  <p className="mt-2 text-[12.5px] font-semibold leading-snug">{(s.title ?? "Untitled").slice(0, 80)}</p>
                  <p className="mt-1 text-[11.5px] leading-snug text-[#667085]">{(s.body ?? "").slice(0, 110)}…</p>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer"
                      className="mt-1.5 inline-block text-[11px] text-[#4F46E5] hover:underline">open ↗</a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3.5 rounded-[8px] border border-[#FEDF89] bg-[#FFFCF5] px-3 py-2.5">
            <p className="text-[12px] leading-snug text-[#B54708]">
              <b>What is not here:</b> no restructuring signal. Four searches — the news
              domains, a 60-post company scan, and targeted queries for restructuring,
              layoffs and reorganization — returned nothing that names this unit. If it is
              happening, it is not public.
            </p>
          </div>
        </section>

        <section className={`${CARD} p-5`}>
          <h2 className="text-[15px] font-semibold">LinkedIn signal sentiment</h2>
          <p className="mt-1 text-[12px] text-[#667085]">
            Sampled public posts — a reading of the conversation, not a measure of the company.
            {country
              ? ` Authors in ${country} only; ${v.geo.located} of ${v.geo.total} posts could be placed at all.`
              : ` ${v.geo.located} of ${v.geo.total} posts carry a location.`}
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-[170px_minmax(0,1fr)]">
            <HalfGauge value={v.linkedin.gauge} color={toneColor(v.linkedin.tone.score)}
              big={toneWord(v.linkedin.tone.score)} small={`${v.linkedin.tone.n} scored posts`} />
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-medium text-[#344054]">Post volume, last 90 days</span>
                {v.linkedin.volumeChangePct !== null && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    v.linkedin.volumeChangePct >= 0 ? "bg-[#ECFDF3] text-[#027A48]" : "bg-[#FEF3F2] text-[#B42318]"}`}>
                    {v.linkedin.volumeChangePct >= 0 ? "↑" : "↓"} {Math.abs(v.linkedin.volumeChangePct)}%
                  </span>
                )}
              </div>
              <VolumeChart points={v.linkedin.volume} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-[8px] bg-[#FAFBFC] px-3 py-2">
              <div className="text-[11px] text-[#667085]">Inside the company</div>
              <div className="text-[16px] font-semibold" style={{ color: toneColor(v.linkedin.insideTone.score) }}>
                {v.linkedin.insideTone.score ?? "—"} <span className="text-[11px] font-normal text-[#98A2B3]">({v.linkedin.insideTone.n})</span>
              </div>
            </div>
            <div className="rounded-[8px] bg-[#FAFBFC] px-3 py-2">
              <div className="text-[11px] text-[#667085]">Market</div>
              <div className="text-[16px] font-semibold" style={{ color: toneColor(v.linkedin.marketTone.score) }}>
                {v.linkedin.marketTone.score ?? "—"} <span className="text-[11px] font-normal text-[#98A2B3]">({v.linkedin.marketTone.n})</span>
              </div>
            </div>
          </div>
          {v.linkedin.themes.length > 0 && (
            <div className="mt-3">
              <p className="text-[12px] font-medium text-[#344054]">Top conversation themes</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {v.linkedin.themes.slice(0, 5).map((t) => (
                  <li key={t.theme} className="rounded-full border border-[#E4E7EC] px-2.5 py-1 text-[11.5px] capitalize text-[#344054]">
                    {t.theme} <span className="text-[#98A2B3]">{t.n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* ── people · posts · triggers ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className={`${CARD} p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Target decision-makers</h2>
            <span className="rounded-full bg-[#F2F4F7] px-2.5 py-1 text-[10.5px] text-[#475467]">
              Validate CHRO/CLO with Gaysel
            </span>
          </div>
          <table className="mt-3 w-full">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-[#98A2B3]">
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium">Seniority</th>
                <th className="pb-2 font-medium">Relationship path</th>
                <th className="pb-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {v.decisionMakers.map((d) => (
                <tr key={d.role} className="border-t border-[#F2F4F7] text-[12px]">
                  <td className="py-2.5 pr-2 align-top font-medium text-[#101828]">{d.role}</td>
                  <td className="py-2.5 pr-2 align-top text-[#667085]">{d.seniority}</td>
                  <td className="py-2.5 pr-2 align-top text-[#98A2B3]">
                    {d.person ? d.person.name : "To be identified"}
                  </td>
                  <td className="py-2.5 align-top">
                    {d.person ? (
                      <Link href={`/people/${d.person.id}`}
                        className="rounded-[6px] border border-[#E4E7EC] px-2 py-1 text-[11px] hover:bg-[#F9FAFB]">Open</Link>
                    ) : (
                      <Link href={`/intel?c=${encodeURIComponent(focus.toLowerCase() || key)}&n=${encodeURIComponent(focusUnit?.unit.name ?? v.companyName)}`}
                        className="rounded-[6px] border border-[#E4E7EC] px-2 py-1 text-[11px] hover:bg-[#F9FAFB]">Identify</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] leading-snug text-[#98A2B3]">
            No warm paths or mutual connections are shown: this workspace holds nobody at
            this account, so any path here would be invented — and one invented path
            discredits every real thing on this page.
          </p>
        </section>

        <section className={`${CARD} p-5`}>
          <h2 className="text-[15px] font-semibold">Top LinkedIn signals</h2>
          {v.linkedin.top.length === 0 ? (
            <p className="mt-2 text-[13px] text-[#667085]">Nothing scorable yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {v.linkedin.top.map((s) => {
                const who = (s.title ?? "").split(" — ")[0];
                const role = (s.title ?? "").split(" — ")[1] ?? "";
                return (
                  <li key={s.id} className="flex gap-2.5 border-b border-[#F2F4F7] pb-3 last:border-0 last:pb-0">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-[12px] font-semibold text-[#4F46E5]">
                      {who.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12.5px] font-semibold">{who.slice(0, 26)}</span>
                        <span className="shrink-0 text-[11px] font-semibold" style={{ color: toneColor(s.sentiment) }}>
                          {s.sentiment !== null && (s.sentiment > 0 ? `+${s.sentiment}` : s.sentiment)}
                        </span>
                      </div>
                      {role && <div className="text-[10.5px] text-[#98A2B3]">{role.slice(0, 44)}</div>}
                      {s.evidence && (
                        <p className="mt-1 text-[11.5px] italic leading-snug text-[#475467]">“{s.evidence.slice(0, 110)}”</p>
                      )}
                      <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-[#98A2B3]">
                        <span>{s.publishedAt ? s.publishedAt.toISOString().slice(0, 10) : "undated"}</span>
                        {s.url && (
                          <a href={s.url} target="_blank" rel="noreferrer"
                            className="rounded-[5px] border border-[#E4E7EC] px-1.5 py-0.5 text-[#4F46E5] hover:bg-[#F9FAFB]">
                            Open on LinkedIn ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={`${CARD} p-5`}>
          <h2 className="text-[15px] font-semibold">Recommended pitch triggers</h2>
          {v.triggers.length === 0 ? (
            <div className="mt-3 rounded-[10px] border border-[#FEDF89] bg-[#FFFCF5] p-3.5">
              <p className="text-[13px] font-semibold text-[#B54708]">No trigger qualified.</p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#667085]">
                The model read every stored signal against this workspace&apos;s six offers
                and returned nothing — twice, once on all 61 posts and once on the 11 by
                people who work there. Its test is whether the same sentence could be
                written about any company in the industry; “new leaders, so they need
                communication support” fails it.
              </p>
              <p className="mt-2 text-[11.5px] leading-relaxed text-[#667085]">
                Nothing is shown rather than something generic. A padded list is believed
                once, and then the real trigger is not believed at all.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {v.triggers.map((t, i) => (
                <li key={i} className="border-b border-[#F2F4F7] pb-3 last:border-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-semibold capitalize">{t.theme}</span>
                    <Meter value={t.confidence} color="#12B76A" />
                  </div>
                  <p className="mt-1 text-[11.5px] leading-snug text-[#475467]">{t.why}</p>
                  {t.serviceSlug && (
                    <span className="mt-1.5 inline-block rounded bg-[#EEF4FF] px-1.5 py-0.5 text-[10.5px] text-[#4F46E5]">
                      {t.serviceSlug}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── the play ── */}
      <section className="mt-4 rounded-[14px] border border-[#E9EAEE] bg-[#FAFBFF] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[18px]">⚑</span>
              <h2 className="text-[16px] font-semibold">L3 ABM play</h2>
            </div>
            <p className="mt-1.5 text-[12.5px] text-[#475467]">
              <b>Why now:</b> {v.counts.whitespace} of {v.counts.mapped} mapped functions with no
              engagement{focusUnit && <>, {focusUnit.unit.name} among them</>}, against {v.counts.pockets} pockets
              of relationship equity elsewhere in {v.companyName}.
            </p>
            <ol className="mt-2.5 flex flex-wrap gap-x-7 gap-y-2 text-[12px]">
              {[
                ["Map stakeholders", "Expand the org chart, identify the seats"],
                ["Find a route in", "Use the pockets that already exist"],
                ["Open on something specific", "Once there is something specific"],
              ].map(([t, s], i) => (
                <li key={t} className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#4F46E5] text-[10px] font-semibold text-white">{i + 1}</span>
                  <span><b className="text-[#101828]">{t}</b><br /><span className="text-[#667085]">{s}</span></span>
                </li>
              ))}
            </ol>
          </div>
          <Link href={`/accounts/${encodeURIComponent(key)}`} className={BTN_GHOST}>Edit the org map</Link>
        </div>
      </section>
    </Shell>
  );
}
