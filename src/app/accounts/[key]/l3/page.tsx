import Link from "next/link";
import { Shell, requirePage } from "@/app/shell";
import { loadL3 } from "@/modules/accounts/l3";
import { refreshFocusSignals, scanTriggerVocabulary } from "./actions";
import { CARD, OrgTree } from "./parts";

const BTN = "inline-flex items-center gap-1.5 rounded-[8px] bg-[#4F46E5] px-3.5 py-2 text-[13px] font-medium text-white hover:bg-[#4338CA]";
const BTN_GHOST = "inline-flex items-center gap-1.5 rounded-[8px] border border-[#E4E7EC] bg-white px-3 py-2 text-[13px] text-[#344054] hover:bg-[#F9FAFB]";

export default async function L3Page({ params, searchParams }: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ focus?: string; alias?: string; queued?: string; country?: string; level?: string; person?: string }>;
}) {
  const user = await requirePage();
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const sp = await searchParams;
  const aliases = (sp.alias ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  const country = (sp.country ?? "").trim();
  const v = await loadL3(user.orgId, key, key, aliases, country || undefined, (sp.focus ?? "").trim() || undefined);
  const focusRaw = (sp.focus ?? "").trim();
  const focus = focusRaw;
  const focusUnit = v.units.find((u) => u.unit.name.toLowerCase() === focus.toLowerCase());
  const p = v.map?.profile ?? {};

  if (!v.map) {
    return (
      <Shell user={user} active="accounts">
        <h1 className="text-xl font-semibold">Account Intelligence</h1>
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
  // No legend, and no red. Every entity on this chart is whitespace, so
  // singling one out in a warning colour implied the others were something
  // else. The unit the page is scoped to glows instead — not a state, a
  // "you are here", so a reader can see in one second which of thirteen boxes
  // everything below is about.
  const treeNodes = ordered.slice(0, TREE_MAX).map((u) => ({
    name: u.unit.name,
    state: (u.engaged || u.people > 0 ? "engaged" : "whitespace") as "engaged" | "whitespace",
    focus: Boolean(v.focusApplied) && u.unit.name.toLowerCase() === (v.focusApplied ?? "").toLowerCase(),
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
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-.01em]">Account Intelligence</h1>

        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/accounts/${encodeURIComponent(key)}`} className={BTN_GHOST}>Edit the org map</Link>
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

      {/* ── Overview ── */}
      <div id="overview" className="mt-5 flex items-baseline gap-2.5">
        <h2 className="rounded-[6px] bg-[#F2F4F7] px-2 py-0.5 font-mono text-[12px] font-medium text-[#344054]">Overview</h2>
        <p className="text-[12px] text-[#667085]">Executive summary and recommended next action.</p>
      </div>
      {v.exec ? (
        <section className="ai-glow mt-2 rounded-[14px] bg-gradient-to-br from-[#F6F4FF] via-white to-[#EEF4FF] p-5">
          <dl className="space-y-2.5">
            {([
              ["What changed", v.exec.summary],
              ["What it means", v.narratives.length > 0
                ? `${v.narratives.map((n) => n.title.toLowerCase()).slice(0, 3).join("; ")} — ${v.narratives.length} narrative${v.narratives.length === 1 ? "" : "s"} across ${v.narratives.reduce((t, n) => t + n.strands, 0)} independent sources.`
                : "Not enough converging evidence to call a narrative yet."],
              ["Where Ariel may fit", v.opportunities.length > 0
                ? `${v.opportunities.length} opportunit${v.opportunities.length === 1 ? "y" : "ies"}, strongest ${v.opportunities[0].offer} at ${v.opportunities[0].strength.total}/100.`
                : "No opportunity has enough behind it yet."],
              ["Who matters", `${v.contacts.length} stakeholder${v.contacts.length === 1 ? "" : "s"} · ${v.contacts.filter((c) => c.research).length} researched · ${v.contacts.filter((c) => c.connected).length} already known to this workspace.`],
              ["What we don't know", `${v.unknowns.length} open question${v.unknowns.length === 1 ? "" : "s"} — ${v.unknowns[0] ?? ""}`],
            ] as const).map(([label, body]) => (
              <div key={label} className="grid gap-1 sm:grid-cols-[150px_1fr]">
                <dt className="text-[10.5px] font-medium uppercase tracking-wide text-[#6941C6]">{label}</dt>
                <dd className="text-[12.5px] leading-relaxed text-[#344054]">{body}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 grid gap-2 border-t border-[#E9D7FE] pt-3 sm:grid-cols-2">
            <div className="rounded-[8px] border border-[#EDEFF3] bg-white/70 p-2.5">
              <div className="text-[9.5px] font-medium uppercase tracking-wide text-[#98A2B3]">Observed</div>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-[#344054]">{v.exec.observed}</p>
            </div>
            <div className="rounded-[8px] border border-[#FDE9C9] bg-[#FFFCF5] p-2.5">
              <div className="text-[9.5px] font-medium uppercase tracking-wide text-[#B54708]">Inferred</div>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-[#344054]">{v.exec.inferred}</p>
            </div>
          </div>

          <p className="mt-3 flex flex-wrap items-baseline gap-2 border-t border-[#E9D7FE] pt-3 text-[13px]">
            <span className="rounded-[6px] bg-[#4F46E5] px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-white">
              Next step
            </span>
            <span className="font-medium text-[#101828]">{v.exec.nextAction}</span>
          </p>
        </section>
      ) : (
        <section className={`${CARD} mt-2 p-5`}>
          <p className="text-[13px] text-[#667085]">
            Nothing has fired yet on this account. Scan it, then research the people.
          </p>
        </section>
      )}

      {/* ── Opportunities ── */}
      {v.opportunities.length > 0 && (
        <>
          <div id="opportunities" className="mt-6 flex items-baseline gap-2.5">
            <h2 className="rounded-[6px] bg-[#F2F4F7] px-2 py-0.5 font-mono text-[12px] font-medium text-[#344054]">Opportunities</h2>
            <p className="text-[12px] text-[#667085]">Commercial opportunities standing on more than one signal.</p>
          </div>
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            {v.opportunities.map((o) => (
              <section key={o.offer} className={`${CARD} p-4`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-[#101828]">{o.offer}</span>
                  <span className="text-[11px] text-[#98A2B3]">
                    fits {o.people.length} {o.people.length === 1 ? "person" : "people"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-[6px] bg-[#101828] px-2 py-0.5 text-[11px] font-semibold text-white">
                    {o.strength.total}/100
                  </span>
                  {o.strength.components.map((c) => (
                    <span key={c.label} title={`${c.why} · ${c.earned}/${c.weight}`}
                      className={`rounded-[5px] px-1.5 py-0.5 text-[10px] ${
                        c.band === "Strong" ? "bg-[#ECFDF3] text-[#027A48]"
                          : c.band === "Medium" ? "bg-[#FFFAEB] text-[#B54708]"
                            : "bg-[#FEF3F2] text-[#B42318]"}`}>
                      {c.label} · {c.band}
                    </span>
                  ))}
                </div>
                {o.narrativeTitles.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-[#667085]">
                    Rests on: {o.narrativeTitles.join(" · ")}
                  </p>
                )}
                {o.signals.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {o.signals.map((sig) => (
                      <span key={sig.label}
                        className="rounded-[6px] border border-[#D9D6FE] bg-[#FAFAFF] px-1.5 py-0.5 text-[10.5px] font-medium text-[#4F46E5]">
                        {sig.label} · {sig.hits} post{sig.hits === 1 ? "" : "s"} · {sig.strength}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-[#98A2B3]">
                    No signal fired for this one — it rests on the people alone.
                  </p>
                )}
                {o.why && (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-[#475467]">
                    {o.whyFor && (
                      <span className="text-[#98A2B3]">
                        why, for{" "}
                        {o.whyForUrl ? (
                          <a href={o.whyForUrl} target="_blank" rel="noreferrer"
                            className="font-medium text-[#6941C6] hover:underline">{o.whyFor}</a>
                        ) : o.whyFor}
                        {": "}
                      </span>
                    )}
                    {o.why.length > 260 ? `${o.why.slice(0, 260)}…` : o.why}
                  </p>
                )}
              </section>
            ))}
          </div>
        </>
      )}


      {/* ── signals ── */}
      <div id="signals" className="mt-6 flex items-baseline gap-2.5">
        <h2 className="rounded-[6px] bg-[#F2F4F7] px-2 py-0.5 font-mono text-[12px] font-medium text-[#344054]">Signals</h2>
        <p className="text-[12px] text-[#667085]">News, LinkedIn, hiring, leadership changes, events, restructuring.</p>
      </div>
      {v.narratives.length > 0 && (
        <section className={`${CARD} mt-2 p-5`}>
          <h3 className="text-[13px] font-semibold">What keeps repeating</h3>
          <p className="mt-0.5 text-[11.5px] text-[#667085]">
            The same thing observed from more than one direction. A seller should not have to
            read {v.postMixTotal} posts to find {v.narratives.length} themes.
          </p>
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {v.narratives.map((n) => (
              <li key={n.key} className="rounded-[10px] border border-[#EDEFF3] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-[#101828]">{n.title}</span>
                  <span className="text-[10.5px] text-[#98A2B3]">
                    {n.strands} independent supporting signal{n.strands === 1 ? "" : "s"}
                    {n.newest ? ` · newest ${n.newest.toISOString().slice(0, 10)}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-[#475467]">{n.relevance}</p>
                <div className="mt-2 text-[9.5px] font-medium uppercase tracking-wide text-[#98A2B3]">
                  Why we believe this
                </div>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {n.evidence.map((e, k) => (
                    <li key={`${e.label}-${k}`}>
                      {e.url ? (
                        <a href={e.url} target="_blank" rel="noreferrer"
                          className="rounded-[5px] bg-[#F9FAFB] px-1.5 py-0.5 text-[10px] text-[#4F46E5] hover:underline">
                          ✓ {e.at ? `${e.at.toISOString().slice(5, 10)} — ` : ""}{e.label.slice(0, 44)}
                        </a>
                      ) : (
                        <span className="rounded-[5px] bg-[#F9FAFB] px-1.5 py-0.5 text-[10px] text-[#667085]">
                          ✓ {e.at ? `${e.at.toISOString().slice(5, 10)} — ` : ""}{e.label.slice(0, 44)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}


      {/* ── announcements ── */}
      {v.announcements.length > 0 && (
        <div className="mt-4">
          <section className={`${CARD} p-5`}>
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <h2 className="text-[13px] font-semibold">What the business announced</h2>
                <p className="mt-0.5 text-[11.5px] text-[#667085]">
                  Press the unit&apos;s LinkedIn page does not publish and its newsroom files
                  under the parent — kept where it carries something to open on.
                </p>
              </div>
              <span className="text-[11px] text-[#98A2B3]">
                {v.announcements.length} item{v.announcements.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="mt-2.5 divide-y divide-[#F2F4F7]">
              {v.announcements.map((n) => (
                <li key={n.id} className="grid gap-4 py-3 first:pt-0 lg:grid-cols-[1.35fr_1fr]">
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12.5px] font-medium leading-snug text-[#101828]">
                        {n.title}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-[#98A2B3]">
                        {n.publishedAt ? n.publishedAt.toISOString().slice(0, 10) : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-snug text-[#475467]">
                      {(n.body ?? "").replace(/\s+/g, " ").slice(0, 320)}…
                    </p>
                    <p className="mt-1 text-[11px] text-[#667085]">
                      {n.source}
                      {n.url && (
                        <> · <a href={n.url} target="_blank" rel="noreferrer"
                          className="text-[#4F46E5] hover:underline">source ↗</a></>
                      )}
                    </p>
                  </div>

                  <div className="lg:border-l lg:border-[#F2F4F7] lg:pl-4">
                    <div className="space-y-1.5">
                        {n.contributesTo.length > 0 && (
                          <div className="mb-2">
                            <div className="text-[9.5px] font-medium uppercase tracking-wide text-[#98A2B3]">
                              Contributes to
                            </div>
                            <p className="mt-0.5 text-[12px] font-medium text-[#101828]">
                              {n.contributesTo.join(" · ")}
                            </p>
                            <p className="text-[10.5px] text-[#667085]">{n.strength}</p>
                          </div>
                        )}
                        {n.matchedTriggers.map((t) => (
                          <div key={t.phrase}>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded-[6px] border border-[#D9D6FE] bg-[#FAFAFF] px-1.5 py-0.5 text-[10.5px] font-medium text-[#4F46E5]">
                                {t.label}
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
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {/* ── company news ── */}
      <div className="mt-4">
        <section className={`${CARD} p-5`}>
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <h2 className="text-[13px] font-semibold">From their US LinkedIn pages · 30 days</h2>
                <p className="mt-0.5 text-[11.5px] text-[#667085]">
                  Only the posts that carry a buying signal, and why each one is an opening.
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
                No US company-page post in the last 30 days carries buying-signal language.
                Product marketing is not listed, and neither are pages naming another market or
                posts written in another language.
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
                      <div className="space-y-1.5">
                          {n.matchedTriggers.map((t) => (
                            <div key={t.phrase}>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="rounded-[6px] border border-[#D9D6FE] bg-[#FAFAFF] px-1.5 py-0.5 text-[10.5px] font-medium text-[#4F46E5]">
                                  {t.label}
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
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>

      {/* ── post mix ── */}
      {v.postMix.length > 0 && (
        <section className={`${CARD} mt-4 p-5`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold">What is being posted, and how it reads</h2>
              <p className="mt-1 max-w-3xl text-[12px] text-[#667085]">
                Every stored post about {v.focusApplied ?? v.companyName} from the last 30 days,
                sorted by what kind of post it is. Sentiment is averaged over the posts a model
                actually scored, and each row says how many that was — an unscored post is not a
                neutral one.
              </p>
            </div>
            <span className="text-[11px] text-[#98A2B3]">{v.postMixTotal} posts</span>
          </div>

          <ul className="mt-3.5 space-y-2">
            {v.postMix.map((m) => {
              const tone = m.sentiment === null
                ? { text: "not scored", cls: "bg-[#F2F4F7] text-[#667085]" }
                : m.sentiment >= 25
                  ? { text: `+${m.sentiment}`, cls: "bg-[#ECFDF3] text-[#027A48]" }
                  : m.sentiment <= -25
                    ? { text: `${m.sentiment}`, cls: "bg-[#FEF3F2] text-[#B42318]" }
                    : { text: `${m.sentiment > 0 ? "+" : ""}${m.sentiment}`, cls: "bg-[#FFFAEB] text-[#B54708]" };
              return (
                <li key={m.key}>
                  <details className="group rounded-[10px] border border-[#EDEFF3] open:bg-[#FCFCFD]">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-3.5 py-2.5">
                      <span className="text-[12.5px] font-medium text-[#101828]">{m.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${tone.cls}`}>
                        {tone.text}
                      </span>
                      <span className="text-[11px] text-[#98A2B3]">
                        {m.posts} post{m.posts === 1 ? "" : "s"} · {m.employee} from employees ·{" "}
                        {m.market} from the market · {m.judged} scored
                      </span>
                      <span className="ml-auto flex h-1.5 w-[160px] overflow-hidden rounded-full bg-[#F2F4F7]">
                        <span
                          className="h-full rounded-full bg-[#4F46E5]"
                          style={{ width: `${Math.round((m.posts / Math.max(1, v.postMixTotal)) * 100)}%` }}
                        />
                      </span>
                      <span className="text-[10.5px] text-[#98A2B3] group-open:hidden">▾</span>
                    </summary>
                    <ul className="max-h-72 overflow-y-auto border-t border-[#F2F4F7] px-3.5 py-2">
                      {m.examples.map((e, i) => (
                        <li key={`${e.who}-${i}`} className="border-b border-[#F2F4F7] py-2 last:border-0">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-[11.5px] font-medium text-[#101828]">{e.who}</span>
                            <span className={`rounded-[5px] px-1.5 py-0.5 text-[9.5px] ${
                              e.voice === "market" ? "bg-[#F2F4F7] text-[#667085]" : "bg-[#EEF4FF] text-[#3538CD]"}`}>
                              {e.voice}
                            </span>
                            {e.sentiment !== null && (
                              <span className="text-[10px] text-[#98A2B3]">
                                {e.sentiment > 0 ? "+" : ""}{e.sentiment}
                              </span>
                            )}
                            <span className="ml-auto shrink-0 text-[10px] text-[#98A2B3]">
                              {e.when ? e.when.toISOString().slice(0, 10) : "undated"}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] leading-snug text-[#475467]">{e.line}…</p>
                          {e.url && (
                            <a href={e.url} target="_blank" rel="noreferrer"
                              className="text-[10px] text-[#4F46E5] hover:underline">open on LinkedIn ↗</a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── org-map ── */}
      <div id="org-map" className="mt-6 flex items-baseline gap-2.5">
        <h2 className="rounded-[6px] bg-[#F2F4F7] px-2 py-0.5 font-mono text-[12px] font-medium text-[#344054]">Org Map</h2>
        <p className="text-[12px] text-[#667085]">Business units, whitespace and existing Ariel relationships.</p>
      </div>

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
            <OrgTree root={v.companyName} nodes={treeNodes} />
          </div>
        </div>
      </section>

      {/* ── people-band ── */}
      <div id="people-band" className="mt-6 flex items-baseline gap-2.5">
        <h2 className="rounded-[6px] bg-[#F2F4F7] px-2 py-0.5 font-mono text-[12px] font-medium text-[#344054]">People</h2>
        <p className="text-[12px] text-[#667085]">ICP contacts ranked by relevance to the signals.</p>
      </div>

      {/* ── people ── */}
      <div className="mt-4">
        <section className={`${CARD} p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold">
                People who match the ICP
                {v.focusApplied && (
                  <span className="ml-2 rounded-full bg-[#EEF4FF] px-2 py-0.5 text-[10.5px] font-medium text-[#3538CD]">
                    {v.focusApplied}
                  </span>
                )}
              </h2>
              <p className="mt-1 max-w-3xl text-[12px] text-[#667085]">
                Everyone whose LinkedIn headline puts them at this unit, US only — from posts
                we hold and from searching LinkedIn for the roles themselves. Kept only where the
                role buys leadership and communication development, or owns a team it is bought
                for.
              </p>
            </div>
            <span className="rounded-full bg-[#F2F4F7] px-2.5 py-1 text-[10.5px] text-[#475467]">
              Validate CHRO/CLO with Gaysel
            </span>
          </div>

          {v.contacts.length === 0 ? (
            <p className="mt-3 text-[13px] text-[#667085]">
              No US employee-voice posts stored for this account match the ICP yet.
            </p>
          ) : (() => {
            const BANDS: { key: string; label: string }[] = [
              { key: "all", label: "All" },
              { key: "exec", label: "C-level / SVP" },
              { key: "vp", label: "VP / Head of" },
              { key: "director", label: "Director" },
              { key: "manager", label: "Manager / Lead" },
              { key: "trainer", label: "Trainer" },
              { key: "other", label: "No rank named" },
            ];
            const picked = BANDS.some((x) => x.key === sp.level) ? sp.level! : "all";
            const count = (k: string) =>
              k === "all" ? v.contacts.length : v.contacts.filter((c) => c.level === k).length;
            const shown = picked === "all"
              ? v.contacts
              : v.contacts.filter((c) => c.level === picked);
            const chosen = shown.find((c) => c.name === sp.person) ?? shown[0];
            const href = (k: string, person?: string) => {
              const qs = new URLSearchParams();
              if (focusRaw) qs.set("focus", focusRaw);
              if (sp.alias) qs.set("alias", sp.alias);
              if (k !== "all") qs.set("level", k);
              if (person) qs.set("person", person);
              return `/accounts/${encodeURIComponent(key)}/l3?${qs}#people`;
            };
            return (
              <div id="people" className="mt-3.5 grid gap-4 lg:grid-cols-[170px_1fr_1.15fr]">
                <div>
                  <div className="text-[10.5px] font-medium uppercase tracking-wide text-[#98A2B3]">
                    Seniority
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {BANDS.filter((b) => b.key === "all" || count(b.key) > 0 || b.key === picked).map((b) => (
                      <li key={b.key}>
                        <Link href={href(b.key)}
                          className={`flex items-baseline justify-between rounded-[7px] px-2.5 py-1.5 text-[12px] ${
                            b.key === picked
                              ? "bg-[#EEF4FF] font-medium text-[#3538CD]"
                              : "text-[#475467] hover:bg-[#F9FAFB]"}`}>
                          <span>{b.label}</span>
                          <span className={b.key === picked ? "text-[#3538CD]" : "text-[#98A2B3]"}>
                            {count(b.key)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 px-2.5 text-[10.5px] leading-snug text-[#98A2B3]">
                    {v.contacts.filter((c) => c.research).length} of {v.contacts.length} researched.
                  </p>
                </div>

                <ul className="max-h-[32rem] divide-y divide-[#F2F4F7] overflow-y-auto rounded-[10px] border border-[#EDEFF3]">
                  {shown.map((c) => (
                    <li key={c.name}>
                      <Link href={href(picked, c.name)}
                        className={`block px-3.5 py-2.5 hover:bg-[#F9FAFB] ${
                          chosen && c.name === chosen.name ? "bg-[#EEF4FF]" : ""}`}>
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="w-5 shrink-0 text-right font-mono text-[10px] text-[#98A2B3]">
                            {shown.indexOf(c) + 1}
                          </span>
                          <span className="text-[12.5px] font-medium text-[#101828]">{c.name}</span>
                          {c.newArrival && (
                            <span className="rounded-[5px] bg-[#ECFDF3] px-1.5 py-0.5 text-[10px] font-medium text-[#027A48]">
                              New arrival
                            </span>
                          )}
                          {c.amiEvent && (
                            <span className="rounded-[5px] bg-[#FAFAFF] px-1.5 py-0.5 text-[10px] font-medium text-[#4F46E5] ring-1 ring-[#D9D6FE]">
                              AMI
                            </span>
                          )}
                          {c.research && (
                            <span className="ml-auto shrink-0 text-[9.5px] uppercase tracking-wide text-[#98A2B3]">
                              researched
                            </span>
                          )}
                        </div>
                        {c.role && (
                          <div className="mt-0.5 text-[11px] leading-snug text-[#667085]">
                            {c.role.length > 92 ? `${c.role.slice(0, 92)}…` : c.role}
                          </div>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>

                {/* Same height as the list beside it, and scrolls inside that
                    height: a research note that grows to two thousand pixels
                    pushes the rest of the page down and leaves the list
                    stranded against white space. */}
                <div className="max-h-[32rem] overflow-y-auto rounded-[10px] border border-[#EDEFF3] p-4">
                  {!chosen ? (
                    <p className="text-[12.5px] text-[#667085]">Pick a name to read the research.</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[14.5px] font-semibold text-[#101828]">{chosen.name}</div>
                          {chosen.role && (
                            <div className="mt-0.5 text-[11.5px] leading-snug text-[#667085]">{chosen.role}</div>
                          )}
                        </div>
                        <span className="flex shrink-0 items-baseline gap-2 text-[10.5px]">
                          {chosen.url && (
                            <a href={chosen.url} target="_blank" rel="noreferrer"
                              className="text-[#4F46E5] hover:underline">recent post ↗</a>
                          )}
                          {chosen.profileUrl && (
                            <a href={chosen.profileUrl} target="_blank" rel="noreferrer"
                              className="text-[#4F46E5] hover:underline">profile ↗</a>
                          )}
                        </span>
                      </div>

                      <div className="mt-2.5 rounded-[8px] border border-[#EDEFF3] bg-[#FCFCFD] p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-[5px] bg-[#101828] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            relevance {chosen.relevance.score}
                          </span>
                          <span className="rounded-[5px] bg-[#EEF4FF] px-1.5 py-0.5 text-[10px] font-medium text-[#3538CD]">
                            {chosen.relevance.buyingRole}
                          </span>
                          <span className={`rounded-[5px] px-1.5 py-0.5 text-[10px] font-medium ${
                            chosen.connected ? "bg-[#ECFDF3] text-[#027A48]" : "bg-[#FEF3F2] text-[#B42318]"}`}>
                            {chosen.connected ? "Connected" : "No relationship"}
                          </span>
                        </div>
                        {chosen.relevance.reasons.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {chosen.relevance.reasons.map((r) => (
                              <li key={r} className="text-[11.5px] leading-snug text-[#475467]">— {r}</li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-2 text-[11px] leading-snug text-[#B54708]">
                          <span className="font-medium uppercase tracking-wide">Gap · </span>
                          {chosen.relevance.gap}
                        </p>
                      </div>

                      {chosen.research ? (
                        <div className="mt-3 space-y-2.5">
                          {chosen.research.flag && (
                            <p className="rounded-[8px] bg-[#FFFBFA] px-2.5 py-2 text-[11.5px] leading-snug text-[#B42318] ring-1 ring-[#FEE4E2]">
                              {chosen.research.flag}
                            </p>
                          )}
                          {chosen.research.offer && (
                            <p className="rounded-[8px] bg-[#EEF4FF] px-2.5 py-2 text-[11.5px] leading-relaxed text-[#3538CD]">
                              <b>{chosen.research.offer}</b>
                              {chosen.research.offerWhy ? ` — ${chosen.research.offerWhy}` : ""}
                            </p>
                          )}

                          <div className="grid gap-2.5 xl:grid-cols-2">
                            <div className="rounded-[8px] border border-[#EDEFF3] p-2.5">
                              <div className="text-[9.5px] font-medium uppercase tracking-wide text-[#98A2B3]">
                                Observed
                              </div>
                              <p className="mt-1 text-[11.5px] leading-relaxed text-[#344054]">
                                {chosen.research.observed}
                              </p>
                              {chosen.research.postsRead && (
                                <p className="mt-2 text-[11px] leading-relaxed text-[#667085]">
                                  {chosen.research.postsRead}
                                </p>
                              )}
                              {chosen.research.evidence && (
                                <p className="mt-2 border-l-2 border-[#D9D6FE] pl-2 text-[11.5px] italic leading-relaxed text-[#475467]">
                                  &ldquo;{chosen.research.evidence}&rdquo;
                                </p>
                              )}
                            </div>

                            <div className="rounded-[8px] border border-[#FDE9C9] bg-[#FFFCF5] p-2.5">
                              <div className="text-[9.5px] font-medium uppercase tracking-wide text-[#B54708]">
                                Inferred
                              </div>
                              <p className="mt-1 text-[11.5px] leading-relaxed text-[#344054]">
                                {chosen.research.inferred}
                              </p>
                            </div>
                          </div>

                          <p className="border-t border-[#F2F4F7] pt-2 text-[10.5px] leading-snug text-[#98A2B3]">
                            Read by {chosen.researchedBy ?? "an unnamed seat"}
                            {chosen.researchedAt ? ` on ${chosen.researchedAt.toISOString().slice(0, 10)}` : ""}.
                            Observed is what their profile and posts say. Inferred is what follows
                            from the role and the moment — useful, and not the same thing.
                          </p>
                        </div>
                      ) : (
                        <p className="mt-3 text-[12px] leading-relaxed text-[#667085]">
                          Not researched yet. The list knows their name, headline and profile; nobody
                          has read them.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })()}
          <p className="mt-2 text-[11px] leading-snug text-[#98A2B3]">
            {v.contacts.length} {v.contacts.length === 1 ? "person" : "people"} ·{" "}
            {v.contacts.filter((c) => c.source === "post").length} found by what they posted,{" "}
            {v.contacts.filter((c) => c.source === "search").length} by searching LinkedIn for the
            roles. Seniority is read off the headline, so &ldquo;no rank named&rdquo; means the
            title says none, and a band set by hand overrides it where a reader knows better. New arrival reads the
            post&apos;s own words and excludes tenure anniversaries, which use the same language.
            AMI means the headline or post names the Allergan Medical Institute.
          </p>
        </section>
      </div>

      {/* ── Plays ── */}
      {v.overview.pitch.length > 0 && (
        <>
          <div id="plays" className="mt-6 flex items-baseline gap-2.5">
            <h2 className="rounded-[6px] bg-[#F2F4F7] px-2 py-0.5 font-mono text-[12px] font-medium text-[#344054]">Plays</h2>
            <p className="text-[12px] text-[#667085]">Ariel offerings mapped against the people who own the problem.</p>
          </div>
          <section className={`${CARD} mt-2 p-5`}>
            <ul className="space-y-3">
              {v.overview.pitch.map((o) => (
                <li key={o.offer} className="rounded-[10px] border border-[#EDEFF3] p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold text-[#101828]">{o.offer}</span>
                    <span className="text-[11px] text-[#98A2B3]">
                      fits {o.people.length} {o.people.length === 1 ? "person" : "people"}
                    </span>
                  </div>
                  <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[11.5px] text-[#475467]">
                    {o.people.map((pp) => (
                      pp.url ? (
                        <a key={pp.name} href={pp.url} target="_blank" rel="noreferrer"
                          className="rounded-[6px] bg-[#F9FAFB] px-1.5 py-0.5 text-[#6941C6] hover:underline">
                          {pp.name}
                        </a>
                      ) : (
                        <span key={pp.name} className="rounded-[6px] bg-[#F9FAFB] px-1.5 py-0.5">{pp.name}</span>
                      )
                    ))}
                  </p>
                </li>
              ))}
            </ul>
            {v.overview.entry.length > 0 && (
              <p className="mt-3 border-t border-[#F2F4F7] pt-2.5 text-[11.5px] leading-snug text-[#475467]">
                <span className="text-[#98A2B3]">Open on: </span>
                {v.overview.entry.map((e, i) => (
                  <span key={e.name}>
                    {i > 0 ? " · " : ""}
                    {e.url ? (
                      <a href={e.url} target="_blank" rel="noreferrer"
                        className="font-medium text-[#101828] hover:text-[#6941C6] hover:underline">{e.name}</a>
                    ) : <span className="font-medium text-[#101828]">{e.name}</span>}
                  </span>
                ))}
              </p>
            )}
          </section>
        </>
      )}


      {/* ── Unknowns ── */}
      {v.unknowns.length > 0 && (
        <>
          <div id="unknowns" className="mt-6 flex items-baseline gap-2.5">
            <h2 className="rounded-[6px] bg-[#F2F4F7] px-2 py-0.5 font-mono text-[12px] font-medium text-[#344054]">Unknowns</h2>
            <p className="text-[12px] text-[#667085]">What nobody has established, and that would change the approach.</p>
          </div>
          <section className={`${CARD} mt-2 p-5`}>
            <ul className="space-y-2">
              {v.unknowns.map((u) => (
                <li key={u} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-[#344054]">
                  <span className="mt-[3px] h-3.5 w-3.5 shrink-0 rounded-[4px] border border-[#D0D5DD]" />
                  <span>{u}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {/* ── Sources ── */}
      {v.sources.length > 0 && (
        <>
          <div id="sources" className="mt-6 flex items-baseline gap-2.5">
            <h2 className="rounded-[6px] bg-[#F2F4F7] px-2 py-0.5 font-mono text-[12px] font-medium text-[#344054]">Sources</h2>
            <p className="text-[12px] text-[#667085]">Articles, filings and recorded events behind the page.</p>
          </div>
          <section className={`${CARD} mt-2 p-5`}>
            <ul className="divide-y divide-[#F2F4F7]">
              {v.sources.map((s2, i) => (
                <li key={`${s2.title}-${i}`} className="flex flex-wrap items-baseline gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="rounded-[5px] bg-[#F2F4F7] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-[#667085]">
                    {s2.kind}
                  </span>
                  <span className="text-[12px] text-[#101828]">{s2.title}</span>
                  <span className="text-[11px] text-[#98A2B3]">{s2.source}</span>
                  {s2.url && (
                    <a href={s2.url} target="_blank" rel="noreferrer"
                      className="text-[11px] text-[#4F46E5] hover:underline">open ↗</a>
                  )}
                  <span className="ml-auto shrink-0 text-[10.5px] text-[#98A2B3]">
                    {s2.when ? s2.when.toISOString().slice(0, 10) : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}


    </Shell>
  );
}
