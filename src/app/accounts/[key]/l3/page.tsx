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
            Map <span className="font-semibold text-[#101828]">whitespace</span>, read what the
            account is saying and who is moving, and see who still has to be identified before
            an expansion play is real.
          </p>
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
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>

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
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {/* ── workforce movement ── */}
      <section className={`${CARD} mt-4 p-5`}>
        <h2 className="text-[15px] font-semibold">Workforce movement</h2>
        <p className="mt-1 max-w-3xl text-[12px] text-[#667085]">
          Two sources that see different things. Filings are official, dated and complete.
          LinkedIn is unofficial, reaches back 30 days only, and shows whoever chose to post.
          Neither is the whole picture; together they are the shape of it.
        </p>

        <div className="mt-3.5 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <div className="rounded-[10px] border border-[#FEE4E2] bg-[#FFFBFA] p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[#B42318]">
              Filed layoffs · WARN notices
            </div>
            {v.workforce.filings.length === 0 ? (
              <p className="mt-2 text-[13px] text-[#667085]">No restructuring filing recorded.</p>
            ) : (
              <ul className="mt-2.5 space-y-2.5">
                {v.workforce.filings.map((f) => (
                  <li key={f.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold text-[#101828]">
                        {(f.title ?? "").replace(/ \(WARN notice\)$/, "")}
                      </span>
                      <span className="shrink-0 text-[11px] text-[#98A2B3]">
                        {f.publishedAt ? f.publishedAt.toISOString().slice(0, 10) : ""}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-[#475467]">
                      {(f.body ?? "").slice(0, 190)}…
                    </p>
                    {f.url && (
                      <a href={f.url} target="_blank" rel="noreferrer"
                        className="text-[11px] text-[#4F46E5] hover:underline">source ↗</a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-[10px] border border-[#EDEFF3] p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[#475467]">
              LinkedIn · {v.workforce.scope} · US
            </div>
            <p className="mt-0.5 text-[11px] text-[#98A2B3]">
              {v.workforce.from && v.workforce.to
                ? `posts held ${v.workforce.from.toISOString().slice(0, 10)} → ${v.workforce.to.toISOString().slice(0, 10)}`
                : "no dated posts held"}
            </p>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              {([
                { label: "Arrival posts", posts: v.workforce.arrivals, colour: "#027A48" },
                { label: "Hiring posts", posts: v.workforce.hiringPosts, colour: "#027A48" },
                { label: "Exit posts", posts: v.workforce.exits, colour: v.workforce.exits.length > 0 ? "#B42318" : "#98A2B3" },
              ]).map((b) => (
                <details key={b.label} className="group rounded-[8px] bg-[#FAFBFC] open:bg-white open:ring-1 open:ring-[#E4E7EC]">
                  <summary className="cursor-pointer list-none py-2.5 text-center">
                    <div className="text-[20px] font-semibold leading-none" style={{ color: b.colour }}>
                      {b.posts.length}
                    </div>
                    <div className="mt-1 text-[10.5px] text-[#667085]">
                      {b.label}
                      {b.posts.length > 0 && <span className="ml-1 text-[#98A2B3] group-open:hidden">▾</span>}
                    </div>
                  </summary>
                  {b.posts.length > 0 && (
                    <ul className="max-h-72 overflow-y-auto border-t border-[#F2F4F7] px-3 py-2 text-left">
                      {b.posts.map((pp) => (
                        <li key={pp.id} className="border-b border-[#F2F4F7] py-2 last:border-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[11.5px] font-medium text-[#101828]">{pp.who}</span>
                            <span className="shrink-0 text-[10px] text-[#98A2B3]">
                              {pp.publishedAt ? pp.publishedAt.toISOString().slice(5, 10) : ""}
                            </span>
                          </div>
                          {pp.role && <div className="text-[10px] leading-snug text-[#667085]">{pp.role.slice(0, 52)}</div>}
                          <p className="mt-1 text-[10.5px] leading-snug text-[#475467]">{pp.excerpt.slice(0, 120)}…</p>
                          {pp.url && (
                            <a href={pp.url} target="_blank" rel="noreferrer"
                              className="text-[10px] text-[#4F46E5] hover:underline">open ↗</a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              ))}
            </div>
            <p className="mt-2.5 text-[11px] leading-snug text-[#98A2B3]">
              Click a number to see every post behind it. Counted over {v.workforce.postsRead}{" "}
              posts by people whose headline says they work here. Counts of POSTS containing the language, never headcount, and
              approximate — a tenure anniversary or a departure can read as an arrival. US means &ldquo;not shown to be
              elsewhere&rdquo; — a post carries no location, so pages naming another market and
              posts in another language are removed and the rest kept. LinkedIn&apos;s search
              reaches back a month at most, so this window cannot be widened to meet the filing
              date on the left; the two columns are years apart on purpose.
            </p>
          </div>
        </div>
      </section>

      {/* ── people ── */}
      <div className="mt-4">
        <section className={`${CARD} p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold">People who match the ICP</h2>
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

                <div className="rounded-[10px] border border-[#EDEFF3] p-4">
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

                      {chosen.research ? (
                        <div className="mt-3 space-y-2.5">
                          {chosen.research.flag && (
                            <p className="rounded-[8px] bg-[#FFFBFA] px-2.5 py-2 text-[11.5px] leading-snug text-[#B42318] ring-1 ring-[#FEE4E2]">
                              {chosen.research.flag}
                            </p>
                          )}
                          {([
                            ["Who they are", chosen.research.aboutSummary],
                            ["What they are measured on", chosen.research.priorities],
                            ["Where we meet it", chosen.research.angle],
                            ["What they post", chosen.research.postsSummary],
                          ] as const).map(([label, body]) => body ? (
                            <div key={label}>
                              <div className="text-[10px] font-medium uppercase tracking-wide text-[#98A2B3]">
                                {label}
                              </div>
                              <p className="mt-0.5 text-[12px] leading-relaxed text-[#344054]">{body}</p>
                            </div>
                          ) : null)}
                          {chosen.research.evidence && (
                            <p className="border-l-2 border-[#D9D6FE] pl-2.5 text-[12px] italic leading-relaxed text-[#475467]">
                              &ldquo;{chosen.research.evidence}&rdquo;
                            </p>
                          )}
                          <p className="border-t border-[#F2F4F7] pt-2 text-[10.5px] leading-snug text-[#98A2B3]">
                            Read by {chosen.researchedBy ?? "an unnamed seat"}
                            {chosen.researchedAt ? ` on ${chosen.researchedAt.toISOString().slice(0, 10)}` : ""}.
                            Everything above is drawn from their own profile and posts; where those
                            were empty the note says so and reasons from the role instead.
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

    </Shell>
  );
}
