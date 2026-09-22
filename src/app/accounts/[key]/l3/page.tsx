import Link from "next/link";
import { Shell, requirePage } from "@/app/shell";
import { loadL3 } from "@/modules/accounts/l3";
import { refreshFocusSignals } from "./actions";

const CARD = "rounded-[12px] border border-[#E4E7EC] bg-white p-4";
const BTN = "inline-flex items-center gap-1.5 rounded-[8px] bg-[#4338CA] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#3730A3]";
const BTN_GHOST = "inline-flex items-center gap-1.5 rounded-[8px] border border-[#DDE2EE] bg-white px-3 py-1.5 text-[13px] hover:bg-[#F9FAFB]";

function toneColor(s: number | null): string {
  if (s === null) return "#98A2B3";
  if (s >= 20) return "#027A48";
  if (s <= -20) return "#B42318";
  return "#B54708";
}

/** A ring that states one number. The caption always says what the number IS —
 *  a gauge without a definition reads as rigour and cannot survive the question
 *  "how is that calculated". */
function Ring({ value, label, sub, color }: {
  value: number | null; label: string; sub: string; color: string;
}) {
  const r = 34, c = 2 * Math.PI * r;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col items-center">
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden>
        <circle cx="44" cy="44" r={r} fill="none" stroke="#EAECF0" strokeWidth="8" />
        {value !== null && (
          <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="round"
            transform="rotate(-90 44 44)" />
        )}
        <text x="44" y="42" textAnchor="middle" className="fill-[#101828]"
          style={{ fontSize: 19, fontWeight: 600 }}>
          {value === null ? "—" : value}
        </text>
        <text x="44" y="57" textAnchor="middle" className="fill-[#98A2B3]" style={{ fontSize: 9 }}>
          {value === null ? "" : "/100"}
        </text>
      </svg>
      <div className="mt-1 text-center">
        <div className="text-[12px] font-medium text-[#344054]">{label}</div>
        <div className="text-[11px] text-[#667085]">{sub}</div>
      </div>
    </div>
  );
}

function Spark({ points }: { points: { week: string; n: number }[] }) {
  if (points.length < 2) {
    return <p className="text-[12px] text-[#98A2B3]">Not enough dated posts to plot a trend.</p>;
  }
  const w = 320, h = 60, max = Math.max(...points.map((p) => p.n), 1);
  const d = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - (p.n / max) * (h - 6) - 3;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="#4338CA" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function Stat({ n, label, sub, tone }: { n: number; label: string; sub: string; tone?: string }) {
  return (
    <div className={CARD}>
      <div className="text-[12px] text-[#475467]">{label}</div>
      <div className="mt-1 text-[26px] font-semibold leading-none" style={{ color: tone ?? "#101828" }}>{n}</div>
      <div className="mt-1 text-[11px] text-[#667085]">{sub}</div>
    </div>
  );
}

export default async function L3Page({ params, searchParams }: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ focus?: string; alias?: string; queued?: string }>;
}) {
  const user = await requirePage();
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const sp = await searchParams;
  const aliases = (sp.alias ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  const v = await loadL3(user.orgId, key, key, aliases);
  const focus = (sp.focus ?? "").trim();
  const focusUnit = v.units.find((u) => u.unit.name.toLowerCase() === focus.toLowerCase());

  if (!v.map) {
    return (
      <Shell user={user} active="accounts">
        <h1 className="text-xl font-semibold">L3 Account Intelligence</h1>
        <section className={`${CARD} mt-4`}>
          <p className="text-[13px] text-[#475467]">
            This account has no org map yet, and whitespace is the difference between
            a map and the network — without one there is nothing to measure.{" "}
            <Link href={`/accounts/${encodeURIComponent(key)}`} className="text-[#4338CA] hover:underline">
              Build the map first
            </Link>.
          </p>
        </section>
      </Shell>
    );
  }

  return (
    <Shell user={user} active="accounts">
      {/* ── header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[13px] text-[#667085]">
            <Link href="/accounts" className="hover:text-[#4338CA]">Accounts</Link>
            {" › "}
            <Link href={`/accounts/${encodeURIComponent(key)}`} className="hover:text-[#4338CA]">{v.companyName}</Link>
            {focusUnit && <>{" › "}<span className="text-[#4338CA]">{focusUnit.unit.name}</span></>}
          </p>
          <h1 className="mt-1 text-[24px] font-semibold">L3 Account Intelligence</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#475467]">
            Map <span className="font-medium text-[#101828]">whitespace</span>, read change
            signals, and see who still has to be identified before an expansion play is real.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {focus && (
            <form action={refreshFocusSignals}>
              <input type="hidden" name="key" value={key} />
              <input type="hidden" name="focus" value={focus} />
              <button className={BTN_GHOST}>Refresh signals</button>
            </form>
          )}
          <Link href={`/intel?c=${encodeURIComponent(focus ? focus.toLowerCase() : key)}&n=${encodeURIComponent(focusUnit?.unit.name ?? v.companyName)}&alias=${encodeURIComponent(sp.alias ?? "")}`}
            className={BTN}>
            Open signal detail →
          </Link>
        </div>
      </div>

      {sp.queued && (
        <p className="mt-3 rounded-[8px] bg-[#EEF4FF] px-3 py-2 text-[13px] text-[#4338CA]">
          Scan queued — the worker searches LinkedIn, then reads what it found. Refresh in a minute.
        </p>
      )}

      {/* ── the numbers ── */}
      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat n={v.counts.pockets} label="Ariel pockets" sub="asserted by the team" />
        <Stat n={v.counts.mapped} label="Mapped functions" sub={`across ${v.companyName}`} />
        <Stat n={v.counts.whitespace} label="Whitespace functions" sub="no engagement recorded" tone="#B54708" />
        <Stat n={v.linkedin.stored} label="LinkedIn posts read" sub={`${v.linkedin.tone.n} carried a scorable line`} />
        <div className={`${CARD} flex items-center justify-center`}>
          <Ring value={v.whitespacePct} label="Whitespace"
            sub={`${v.counts.whitespace} of ${v.counts.mapped} functions`} color="#B54708" />
        </div>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* ── footprint ── */}
        <section className={CARD}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Ariel footprint inside {v.companyName}</h2>
            <span className="rounded-full bg-[#ECFDF3] px-2 py-0.5 text-[11px] text-[#027A48]">
              {v.counts.pockets} pockets
            </span>
          </div>
          <p className="mt-1 text-[12px] text-[#667085]">
            Asserted by the team — not one of these is evidenced by a person in this
            workspace&apos;s network, so none of it was derived.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {v.footprint.map((u) => (
              <li key={u.name} className="rounded-[8px] border border-[#ABEFC6] bg-[#F6FEF9] px-2.5 py-1.5 text-[12px] text-[#027A48]">
                ✓ {u.name}
              </li>
            ))}
            {v.footprint.length === 0 && (
              <li className="text-[13px] text-[#667085]">No pockets marked. Star units with <code>*</code> in the map editor.</li>
            )}
          </ul>
        </section>

        {/* ── whitespace ── */}
        <section className={CARD}>
          <h2 className="text-[15px] font-semibold">Org-chart whitespace</h2>
          <p className="mt-1 text-[12px] text-[#667085]">
            Mapped functions with no recorded engagement. A first-draft org chart —
            correct it in the{" "}
            <Link href={`/accounts/${encodeURIComponent(key)}`} className="text-[#4338CA] hover:underline">map editor</Link>.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {v.whitespace.map((u) => {
              const isFocus = u.name.toLowerCase() === focus.toLowerCase();
              return (
                <li key={u.name}
                  className={`rounded-[8px] border px-2.5 py-1.5 text-[12px] ${
                    isFocus
                      ? "border-[#F97066] bg-[#FFFBFA] font-medium text-[#B42318]"
                      : "border-[#EAECF0] bg-[#F9FAFB] text-[#475467]"
                  }`}>
                  {u.name}
                  {isFocus && <span className="ml-1 text-[10px]">· no engagement</span>}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* ── signals + sentiment ── */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <section className={CARD}>
          <h2 className="text-[15px] font-semibold">
            {focusUnit?.unit.name ?? v.companyName} — change signals
          </h2>
          <p className="mt-1 text-[12px] text-[#667085]">
            Recent news, filings and leadership posts, newest first.
          </p>
          {v.changeSignals.length === 0 ? (
            <p className="mt-3 text-[13px] text-[#667085]">Nothing stored yet.</p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {v.changeSignals.map((s) => (
                <li key={s.id} className="rounded-[10px] border border-[#EAECF0] p-3">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-[#667085]">
                    <span className="rounded bg-[#F2F4F7] px-1.5 py-0.5">{s.source ?? s.kind}</span>
                    <span>{s.publishedAt ? s.publishedAt.toISOString().slice(0, 10) : "undated"}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] font-medium leading-snug">{s.title ?? "Untitled"}</p>
                  <p className="mt-1 text-[12px] leading-snug text-[#475467]">
                    {(s.body ?? "").slice(0, 130)}…
                  </p>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer"
                      className="mt-1.5 inline-block text-[11px] text-[#4338CA] hover:underline">open source ↗</a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={CARD}>
          <h2 className="text-[15px] font-semibold">LinkedIn signal sentiment</h2>
          <p className="mt-1 text-[12px] text-[#667085]">
            Sampled public posts — a reading of the conversation, not a measure of the company.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-6">
            <Ring value={v.linkedin.gauge}
              label={v.linkedin.tone.score === null ? "not scorable" : v.linkedin.tone.score >= 10 ? "Positive" : v.linkedin.tone.score <= -10 ? "Negative" : "Mixed"}
              sub={`${v.linkedin.tone.n} scored posts`}
              color={toneColor(v.linkedin.tone.score)} />
            <div className="min-w-[200px] flex-1">
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="text-[#475467]">Post volume, last 90 days</span>
                {v.linkedin.volumeChangePct !== null && (
                  <span className={v.linkedin.volumeChangePct >= 0 ? "text-[#027A48]" : "text-[#B42318]"}>
                    {v.linkedin.volumeChangePct >= 0 ? "↑" : "↓"} {Math.abs(v.linkedin.volumeChangePct)}%
                  </span>
                )}
              </div>
              <Spark points={v.linkedin.volume} />
              <div className="mt-1 flex gap-4 text-[11px] text-[#667085]">
                <span>Inside <b style={{ color: toneColor(v.linkedin.insideTone.score) }}>
                  {v.linkedin.insideTone.score ?? "—"}</b> ({v.linkedin.insideTone.n})</span>
                <span>Market <b style={{ color: toneColor(v.linkedin.marketTone.score) }}>
                  {v.linkedin.marketTone.score ?? "—"}</b> ({v.linkedin.marketTone.n})</span>
              </div>
            </div>
          </div>
          {v.linkedin.themes.length > 0 && (
            <div className="mt-3">
              <p className="text-[12px] text-[#475467]">Top conversation themes</p>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {v.linkedin.themes.slice(0, 5).map((t) => (
                  <li key={t.theme} className="rounded-full border border-[#DDE2EE] px-2.5 py-1 text-[12px] capitalize text-[#344054]">
                    {t.theme} <span className="text-[#98A2B3]">{t.n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* ── people, posts, triggers ── */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className={CARD}>
          <h2 className="text-[15px] font-semibold">Target decision-makers</h2>
          <p className="mt-1 text-[12px] text-[#667085]">
            Validate CHRO/CLO paths with Gaysel.
          </p>
          <table className="mt-3 w-full text-[12px]">
            <thead className="text-left text-[11px] text-[#667085]">
              <tr><th className="pb-1 font-normal">Role</th><th className="pb-1 font-normal">Seniority</th><th className="pb-1 font-normal">Path</th></tr>
            </thead>
            <tbody>
              {v.decisionMakers.map((d) => (
                <tr key={d.role} className="border-t border-[#EEF1F8]">
                  <td className="py-2 pr-2 align-top">{d.role}</td>
                  <td className="py-2 pr-2 align-top text-[#667085]">{d.seniority}</td>
                  <td className="py-2 align-top">
                    {d.person ? (
                      <Link href={`/people/${d.person.id}`} className="text-[#4338CA] hover:underline">
                        {d.person.name}
                      </Link>
                    ) : (
                      <span className="text-[#98A2B3]">to be identified</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-[#98A2B3]">
            No warm paths are shown because this workspace holds nobody at this
            account — a path invented here would be the one thing that discredits
            the rest of the page.
          </p>
        </section>

        <section className={CARD}>
          <h2 className="text-[15px] font-semibold">Top LinkedIn signals</h2>
          {v.linkedin.top.length === 0 ? (
            <p className="mt-2 text-[13px] text-[#667085]">Nothing scorable yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {v.linkedin.top.map((p) => (
                <li key={p.id} className="border-b border-[#EEF1F8] pb-3 last:border-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-medium leading-snug">{(p.title ?? "").slice(0, 60)}</span>
                    <span className="shrink-0 text-[11px] font-medium" style={{ color: toneColor(p.sentiment) }}>
                      {p.sentiment !== null && (p.sentiment > 0 ? `+${p.sentiment}` : p.sentiment)}
                    </span>
                  </div>
                  {p.evidence && (
                    <p className="mt-1 text-[12px] italic leading-snug text-[#475467]">“{p.evidence.slice(0, 120)}”</p>
                  )}
                  <p className="mt-1 text-[11px] text-[#98A2B3]">
                    {p.publishedAt ? p.publishedAt.toISOString().slice(0, 10) : "undated"}
                    {p.url && <> · <a href={p.url} target="_blank" rel="noreferrer" className="text-[#4338CA] hover:underline">open ↗</a></>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={CARD}>
          <h2 className="text-[15px] font-semibold">Recommended pitch triggers</h2>
          {v.triggers.length === 0 ? (
            <div className="mt-2 rounded-[8px] bg-[#FFFCF5] p-3">
              <p className="text-[13px] text-[#B54708]">No trigger qualified.</p>
              <p className="mt-1.5 text-[12px] leading-snug text-[#667085]">
                The model read every stored signal against this workspace&apos;s offers
                and returned nothing, twice. Its test is whether the same sentence
                could be written about any company in the industry — &ldquo;new leaders,
                so they need communication support&rdquo; fails it. Nothing is shown here
                rather than something generic.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {v.triggers.map((t, i) => (
                <li key={i} className="border-b border-[#EEF1F8] pb-3 last:border-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium capitalize">{t.theme}</span>
                    <span className="text-[11px] text-[#667085]">{t.confidence}%</span>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-[#475467]">{t.why}</p>
                  {t.serviceSlug && (
                    <span className="mt-1 inline-block rounded bg-[#EEF4FF] px-1.5 py-0.5 text-[11px] text-[#4338CA]">
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
      <section className="mt-5 rounded-[12px] border border-[#DDE2EE] bg-[#F9FAFB] p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold">L3 ABM play</h2>
            <p className="mt-1 text-[12px] text-[#475467]">
              <b>Why now:</b> {v.counts.whitespace} mapped functions with no engagement
              {focusUnit && <>, {focusUnit.unit.name} among them</>}, against {v.counts.pockets} pockets
              of existing relationship equity elsewhere in {v.companyName}.
            </p>
            <ol className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-[#475467]">
              <li><b>1.</b> Identify the seats — none are known yet</li>
              <li><b>2.</b> Find a route in, from the pockets that already exist</li>
              <li><b>3.</b> Open on something specific, once there is something specific</li>
            </ol>
          </div>
          <Link href={`/accounts/${encodeURIComponent(key)}`} className={BTN_GHOST}>Edit the org map</Link>
        </div>
      </section>
    </Shell>
  );
}
