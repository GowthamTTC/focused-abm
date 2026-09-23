import Link from "next/link";
import { Shell, requirePage } from "@/app/shell";
import { loadL3 } from "@/modules/accounts/l3";
import { refreshFocusSignals, scanTriggerVocabulary } from "./actions";
import { CARD, HalfGauge, Meter, OrgTree, VolumeChart } from "./parts";

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

  // A WHITESPACE map has to show the whitespace. Units are stored engaged-first,
  // so taking the first N filled the diagram with green pockets and read as
  // "this account is almost fully covered" — the opposite of what the panel
  // exists to say, and the grey legend entry never appeared at all. The order
  // is the focus, then everything with no engagement, then the pockets; the cap
  // is high enough that the balance on screen is the balance in the account.
  // Only units with their own public website. An internal function like
  // Regulatory Affairs is not a thing an account plan can walk into; an
  // operating company that kept its own site after acquisition is.
  const TREE_MAX = 12;
  const siteUnits = v.units.filter((u) => u.unit.website);
  const isFocus = (n: string) => n.toLowerCase() === focus.toLowerCase();
  const ordered = [
    ...siteUnits.filter((u) => isFocus(u.unit.name)),
    ...siteUnits.filter((u) => !isFocus(u.unit.name) && !u.engaged && u.people === 0),
    ...siteUnits.filter((u) => !isFocus(u.unit.name) && (u.engaged || u.people > 0)),
  ];
  // No focus highlight and no legend. Every entity on this chart is whitespace,
  // so singling one out in red implied the others were something else, and a
  // legend explaining three states when only one is drawn is furniture.
  const treeNodes = ordered.slice(0, TREE_MAX).map((u) => ({
    name: u.unit.name,
    state: (u.engaged || u.people > 0 ? "engaged" : "whitespace") as "engaged" | "whitespace",
    sub: u.unit.website,
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
          {/* A filter that can never match is worse than no filter: selecting it
              emptied every band on the page and read as a broken screen. The
              control only appears once some post carries a location. */}
          {v.geo.located > 0 && (
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
          )}
          {focus && (
            <form action={refreshFocusSignals}>
              <input type="hidden" name="key" value={key} />
              <input type="hidden" name="focus" value={focus} />
              <button className={BTN_GHOST}>↻ Refresh signals</button>
            </form>
          )}
          <a href={`/api/account-export/${encodeURIComponent(key)}?focus=${encodeURIComponent(focusRaw)}&alias=${encodeURIComponent(sp.alias ?? "")}`}
            className={BTN_GHOST}>⤓ Export brief</a>
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
        <div className="grid gap-6 lg:grid-cols-[minmax(280px,1fr)_1.5fr]">
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

          <div className="lg:border-l lg:border-[#EDEFF3] lg:pl-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-[13px] font-semibold">Org-chart whitespace map</h2>
            </div>
            <p className="mt-1 text-[11.5px] text-[#667085]">
              Entities with their own public website — correct it in the{" "}
              <Link href={`/accounts/${encodeURIComponent(key)}`} className="text-[#4F46E5] hover:underline">map editor</Link>.
            </p>
            <OrgTree root={v.companyName} nodes={treeNodes} />
            <p className="mt-3 text-center text-[11px] text-[#98A2B3]">
              {siteUnits.length} of {v.counts.mapped} mapped units have their own website ·{" "}
              {v.counts.whitespace} of {v.counts.mapped} have no engagement
            </p>
          </div>
        </div>
      </section>

      {/* ── company news ── */}
      <div className="mt-4">
        <section className={`${CARD} p-5`}>
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <h2 className="text-[13px] font-semibold">From their US LinkedIn pages · 30 days</h2>
                <p className="mt-0.5 text-[11.5px] text-[#667085]">
                  What they posted, and why it is an opening for this workspace.
                </p>
              </div>
              <span className="text-[11px] text-[#98A2B3]">
                {v.companyUpdates.length > 0
                  ? `${v.companyUpdates.length} post${v.companyUpdates.length === 1 ? "" : "s"}`
                  : "no company-page posts stored"}
              </span>
            </div>
            {v.companyUpdates.length === 0 ? (
              <p className="mt-2 text-[12px] leading-snug text-[#667085]">
                No US company-page posts in the last 30 days among those stored. Pages that
                name another market, and posts written in another language, are left out.
              </p>
            ) : (
              <ul className="mt-2.5 divide-y divide-[#F2F4F7]">
                {v.companyUpdates.map((n) => (
                  <li key={n.id} className="grid gap-4 py-3 first:pt-0 lg:grid-cols-[1.35fr_1fr]">
                    <div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12.5px] font-medium leading-snug text-[#101828]">
                          {(n.body ?? "").replace(/\s+/g, " ").slice(0, 150)}…
                        </span>
                        <span className="shrink-0 text-[10.5px] text-[#98A2B3]">
                          {n.publishedAt ? n.publishedAt.toISOString().slice(5, 10) : ""}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-[#667085]">
                        {n.who}
                        {n.url && (
                          <> · <a href={n.url} target="_blank" rel="noreferrer"
                            className="text-[#4F46E5] hover:underline">open on LinkedIn ↗</a></>
                        )}
                      </p>
                    </div>

                    <div className="lg:border-l lg:border-[#F2F4F7] lg:pl-4">
                      {n.about && (
                        <p className="mb-2 rounded-[8px] bg-[#F9FAFB] px-2.5 py-2 text-[11px] leading-snug text-[#475467]">
                          {n.about}
                        </p>
                      )}
                      {n.matchedTriggers.length === 0 ? (
                        <p className="text-[11.5px] leading-snug text-[#98A2B3]">
                          No buying signal. Product marketing — nothing here to open on.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {n.matchedTriggers.map((t) => (
                            <div key={t.phrase}>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="rounded-[6px] border border-[#D9D6FE] bg-[#FAFAFF] px-1.5 py-0.5 text-[10.5px] font-medium text-[#4F46E5]">
                                  {t.label} · {t.weight} pts
                                </span>
                                {t.offer && (
                                  <span className="rounded-[6px] bg-[#ECFDF3] px-1.5 py-0.5 text-[10.5px] font-medium text-[#027A48]">
                                    {t.offer}
                                  </span>
                                )}
                              </div>
                              {t.why && (
                                <p className="mt-1 text-[11.5px] leading-snug text-[#475467]">{t.why}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
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
        </section>

        <section className={`${CARD} p-5`}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#D9D6FE] bg-[#FAFAFF] px-4 py-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[#101828]">Buying signals</div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-[#667085]">
                {v.triggerScore.fired.length > 0
                  ? v.triggerScore.fired.slice(0, 3).map((h) => h.trigger.label).join(" · ")
                  : "Nothing in the vocabulary has been said by this account yet"}
              </p>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[30px] font-semibold leading-none text-[#4F46E5]">{v.triggerScore.points}</span>
              <span className="text-[11px] text-[#667085]">points</span>
            </div>
          </div>

          <h2 className="text-[15px] font-semibold">LinkedIn signal sentiment</h2>
          <p className="mt-1 text-[12px] text-[#667085]">
            Sampled public posts — a reading of the conversation, not a measure of the company.
            {v.geo.located === 0
              ? " LinkedIn's post search does not return author location, so this cannot be read by market."
              : country
                ? ` Authors in ${country} only; ${v.geo.located} of ${v.geo.total} posts could be placed at all.`
                : ` ${v.geo.located} of ${v.geo.total} posts carry a location.`}
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-[170px_minmax(0,1fr)]">
            <HalfGauge value={v.linkedin.gauge} color={toneColor(v.linkedin.tone.score)}
              big={toneWord(v.linkedin.tone.score)} small={`${v.linkedin.tone.n} scored posts`} />
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-medium text-[#344054]">Posts stored, by week</span>
                {v.linkedin.volumeChangePct !== null && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    v.linkedin.volumeChangePct >= 0 ? "bg-[#ECFDF3] text-[#027A48]" : "bg-[#FEF3F2] text-[#B42318]"}`}>
                    {v.linkedin.volumeChangePct >= 0 ? "↑" : "↓"} {Math.abs(v.linkedin.volumeChangePct)}%
                  </span>
                )}
              </div>
              <VolumeChart points={v.linkedin.volume} />
              <p className="text-[10.5px] leading-snug text-[#98A2B3]">
                What this workspace has collected per week, not how much the company
                posted — the shape follows when a scan was run.
              </p>
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

      {/* ── buying signals ── */}
      <section className={`${CARD} mt-4 p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Buying signals</h2>
            <p className="mt-1 max-w-2xl text-[12px] text-[#667085]">
              Phrases that mean this account needs what this workspace sells, counted in
              its posts. Not distress — a buying moment. Every point below traces to a
              phrase in a post you can open.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[28px] font-semibold leading-none text-[#4F46E5]">
                {v.triggerScore.points}
              </div>
              <div className="text-[11px] text-[#667085]">signal points</div>
            </div>
            <form action={scanTriggerVocabulary}>
              <input type="hidden" name="key" value={key} />
              <input type="hidden" name="focus" value={focusRaw} />
              <button className={BTN_GHOST}>↻ Scan vocabulary</button>
            </form>
          </div>
        </div>

        {v.triggerScore.fired.length === 0 ? (
          <p className="mt-3 text-[13px] text-[#667085]">
            None of the vocabulary&apos;s phrases appear in the stored posts. Press
            &ldquo;Scan vocabulary&rdquo; to search LinkedIn for each of them.
          </p>
        ) : (
          <ul className="mt-3.5 grid gap-2.5 lg:grid-cols-2">
            {v.triggerScore.fired.map((h) => (
              <li key={h.trigger.phrase} className="rounded-[10px] border border-[#D9D6FE] bg-[#FAFAFF] p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-[#101828]">{h.trigger.label}</span>
                  <span className="shrink-0 text-[11px] text-[#667085]">
                    {h.hits} post{h.hits === 1 ? "" : "s"} · weight {h.trigger.weight} ·{" "}
                    <b className="text-[#4F46E5]">{h.points} pts</b>
                  </span>
                </div>
                {h.example?.line && (
                  <p className="mt-1.5 text-[11.5px] italic leading-snug text-[#475467]">
                    &ldquo;{h.example.line.slice(0, 150)}&rdquo;
                  </p>
                )}
                <p className="mt-1.5 text-[10.5px] text-[#98A2B3]">
                  {h.lastSeenAt ? `last seen ${h.lastSeenAt.toISOString().slice(0, 10)}` : "undated"}
                  {h.example?.url && (
                    <> · <a href={h.example.url} target="_blank" rel="noreferrer"
                      className="text-[#4F46E5] hover:underline">open ↗</a></>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}

        {v.triggerScore.quiet.length > 0 && (
          <div className="mt-3.5 border-t border-[#F2F4F7] pt-3">
            <p className="text-[11.5px] text-[#667085]">
              <b>Quiet this month</b> — searched for, not found:{" "}
              {v.triggerScore.quiet.map((t) => t.label).join(", ")}.
            </p>
          </div>
        )}
        <p className="mt-2.5 text-[10.5px] leading-snug text-[#98A2B3]">
          Points are the phrase&apos;s weight per matching post, at full value inside 30
          days and tapering to a third at 90. There is no ceiling and no score out of 100 —
          a number out of 100 would imply one.
        </p>
      </section>

      {/* ── the evidence ── */}
      <section className={`${CARD} mt-4 p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold">Leadership &amp; company posts</h2>
            <p className="mt-1 text-[12px] text-[#667085]">
              Posts by people who say they work here, and by the company&apos;s own pages —
              the market half of the feed is left out. Each one carries the phrase that
              surfaced it, so any claim made from it can be traced back to the search.
            </p>
          </div>
          <span className="rounded-full bg-[#EEF4FF] px-2.5 py-1 text-[11px] font-medium text-[#4F46E5]">
            {v.voicePosts.length} posts
          </span>
        </div>
        {v.voicePosts.length === 0 ? (
          <p className="mt-3 text-[13px] text-[#667085]">Nothing stored from inside the company yet.</p>
        ) : (
          <ul className="mt-3.5 grid gap-2.5 lg:grid-cols-2">
            {v.voicePosts.slice(0, 12).map((p) => (
              <li key={p.id} className="rounded-[10px] border border-[#EDEFF3] p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-[#101828]">{p.who}</span>
                  <span className="shrink-0 text-[10.5px] text-[#98A2B3]">
                    {p.voice === "company" ? "Company page" : "Employee"}
                    {p.publishedAt && ` · ${p.publishedAt.toISOString().slice(0, 10)}`}
                  </span>
                </div>
                {p.role && <div className="text-[11px] leading-snug text-[#667085]">{p.role.slice(0, 78)}</div>}
                <p className="mt-2 text-[12px] leading-relaxed text-[#344054]">
                  {p.evidence ? <span className="italic">&ldquo;{p.evidence.slice(0, 210)}&rdquo;</span> : (p.body ?? "").slice(0, 210)}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {p.theme && (
                    <span className="rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[10px] capitalize text-[#475467]">{p.theme}</span>
                  )}
                  {p.sentiment !== null && (
                    <span className="text-[10.5px] font-medium" style={{ color: toneColor(p.sentiment) }}>
                      {p.sentiment > 0 ? `+${p.sentiment}` : p.sentiment}
                    </span>
                  )}
                  <span className="rounded border border-[#E4E7EC] px-1.5 py-0.5 text-[10px] text-[#667085]">
                    found via: {p.capturedBy ?? "company name scan"}
                  </span>
                  {p.matchedTriggers.map((t) => (
                    <span key={t.phrase}
                      className="rounded border border-[#D9D6FE] bg-[#FAFAFF] px-1.5 py-0.5 text-[10px] font-medium text-[#4F46E5]">
                      {t.label}
                    </span>
                  ))}
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noreferrer"
                      className="text-[10.5px] text-[#4F46E5] hover:underline">open on LinkedIn ↗</a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {v.voicePosts.length > 12 && (
          <p className="mt-2.5 text-[11px] text-[#98A2B3]">+ {v.voicePosts.length - 12} more stored</p>
        )}

        {v.queries.length > 0 && (
          <div className="mt-4 border-t border-[#F2F4F7] pt-3.5">
            <h3 className="text-[13px] font-semibold">How these were found</h3>
            <p className="mt-1 text-[11.5px] text-[#667085]">
              Every phrase this account has been searched with. The ones that returned
              nothing are listed too — a search that finds no restructuring is a finding,
              not a gap.
            </p>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {v.queries.map((q) => (
                <li key={q.keywords + String(q.at)}
                  className={`rounded-[7px] border px-2 py-1 text-[11px] ${
                    q.stored > 0
                      ? "border-[#ABEFC6] bg-[#F6FEF9] text-[#027A48]"
                      : "border-[#E4E7EC] bg-[#FAFBFC] text-[#98A2B3]"
                  }`}>
                  {q.keywords}
                  <span className="ml-1.5 opacity-70">{q.stored}/{q.seen}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10.5px] text-[#98A2B3]">
              kept / returned. A post is kept only when it names the company, so a large
              gap between the two is the guard doing its job.
            </p>
          </div>
        )}
      </section>

      {/* ── people · posts · triggers ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
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

          {v.contacts.length > 0 && (
            <div className="mt-4 border-t border-[#F2F4F7] pt-3.5">
              <h3 className="text-[13px] font-semibold">Named in the signal feed</h3>
              <p className="mt-1 text-[11px] leading-snug text-[#667085]">
                People whose own LinkedIn headline says they work here. Not enriched and
                not bought — they said it in public, in a post already stored. This is the
                only route that has produced real names at this account.
              </p>
              <ul className="mt-2.5 space-y-2">
                {v.contacts.slice(0, 8).map((c) => (
                  <li key={c.name} className="text-[12px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-[#101828]">{c.name}</span>
                      <span className="shrink-0 text-[10.5px] text-[#98A2B3]">
                        {c.lastPostAt ? c.lastPostAt.toISOString().slice(0, 10) : ""}
                      </span>
                    </div>
                    {c.role && <div className="text-[11px] leading-snug text-[#667085]">{c.role.slice(0, 74)}</div>}
                    {c.url && (
                      <a href={c.url} target="_blank" rel="noreferrer"
                        className="text-[10.5px] text-[#4F46E5] hover:underline">open their post ↗</a>
                    )}
                  </li>
                ))}
              </ul>
              {v.contacts.length > 8 && (
                <p className="mt-2 text-[11px] text-[#98A2B3]">+ {v.contacts.length - 8} more</p>
              )}
            </div>
          )}
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

      </div>

      {/* ── incumbents ── */}
      <section className={`${CARD} mt-4 p-5`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold">Who else is selling in here</h2>
          {v.competitors.length > 0 && (
            <span className="rounded-full bg-[#FEF3F2] px-2.5 py-1 text-[11px] font-medium text-[#B42318]">
              {v.competitors.length} incumbent{v.competitors.length === 1 ? "" : "s"} seen
            </span>
          )}
        </div>
        <p className="mt-1 text-[12px] text-[#667085]">
          Named competitors appearing in this account&apos;s signals. Walking into an
          incumbent is worth knowing before the first call rather than during it.
        </p>
        {v.competitors.length === 0 ? (
          <p className="mt-3 text-[13px] text-[#667085]">
            No named competitor found in the stored signals.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {v.competitors.map((c) => (
              <li key={c.peer} className="rounded-[10px] border border-[#FEE4E2] bg-[#FFFBFA] p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-[#B42318]">{c.peer}</span>
                  <span className="text-[11px] text-[#98A2B3]">
                    {c.mentions} mention{c.mentions === 1 ? "" : "s"}
                    {c.latestAt && ` · ${c.latestAt.toISOString().slice(0, 10)}`}
                  </span>
                </div>
                {c.snippet && (
                  <p className="mt-1.5 text-[11.5px] italic leading-snug text-[#475467]">“{c.snippet.slice(0, 220)}”</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

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
