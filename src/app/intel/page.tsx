import { Shell, requirePage } from "@/app/shell";
import { loadIntel, scannedCompanies } from "@/modules/intel/query";
import { VOICE_BLURB, VOICE_LABEL } from "@/modules/intel/voice";
import { startIntelScan } from "./actions";

const CARD = "rounded-[12px] border border-[#E4E7EC] bg-white p-4";
const BTN = "rounded-[8px] bg-[#263BAA] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#1d2d85]";
const INPUT = "rounded-[8px] border border-[#DDE2EE] bg-white px-2.5 py-1.5 text-[13px]";

/** Sentiment runs -100..100. Green above, red below, grey for the middle and
 *  for "nothing scorable", which are different facts and must not share a look. */
function toneColor(score: number | null): string {
  if (score === null) return "#98A2B3";
  if (score >= 20) return "#027A48";
  if (score <= -20) return "#B42318";
  return "#B54708";
}

function toneWord(score: number | null): string {
  if (score === null) return "not scorable";
  if (score >= 20) return "positive";
  if (score <= -20) return "negative";
  return "mixed";
}

export default async function IntelPage({ searchParams }: {
  searchParams: Promise<{ c?: string; n?: string; queued?: string; err?: string; alias?: string }>;
}) {
  const user = await requirePage();
  const sp = await searchParams;
  const companies = await scannedCompanies(user.orgId);
  const key = (sp.c ?? companies[0]?.key ?? "").trim();
  const name = (sp.n ?? companies.find((c) => c.key === key)?.name ?? "").trim();
  // Parent and former names, comma separated. Staff who write "@AbbVie" rather
  // than the BU read as market without this, and which names count is a fact
  // about the account that only the person looking at it knows.
  const aliases = (sp.alias ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  const view = key ? await loadIntel(user.orgId, key, name || key, aliases) : null;

  return (
    <Shell user={user} active="intel">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Intelligence</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#475467]">
            What LinkedIn is saying about a company — anyone posting about it,
            connection or not. A tone, the themes under it, and the posts
            themselves. It does not name contacts.
          </p>
        </div>
        <form action={startIntelScan} className="flex flex-wrap items-center gap-2">
          <input name="company" defaultValue={name} placeholder="Company name"
            className={`${INPUT} w-52`} required />
          <select name="window" defaultValue="past_month" className={INPUT}>
            <option value="past_week">Past week</option>
            <option value="past_month">Past month</option>
            <option value="past_day">Past day</option>
          </select>
          <button className={BTN}>Scan LinkedIn</button>
        </form>
      </div>

      {sp.err && (
        <p className="mt-3 rounded-[8px] bg-[#FEF3F2] px-3 py-2 text-[13px] text-[#B42318]">{sp.err}</p>
      )}
      {sp.queued && (
        <p className="mt-3 rounded-[8px] bg-[#EFF4FF] px-3 py-2 text-[13px] text-[#263BAA]">
          Scan queued. The worker searches LinkedIn, then reads what it found —
          refresh this page in a minute.
        </p>
      )}

      {companies.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {companies.map((c) => (
            <a key={c.key} href={`/intel?c=${encodeURIComponent(c.key)}&n=${encodeURIComponent(c.name)}`}
              className={`rounded-[8px] border px-2.5 py-1 text-[12px] ${
                c.key === key ? "border-[#263BAA] bg-[#EFF4FF] text-[#263BAA]" : "border-[#DDE2EE] bg-white text-[#475467]"
              }`}>
              {c.name} <span className="text-[#98A2B3]">{c.n}</span>
            </a>
          ))}
        </div>
      )}

      {!view || view.stored === 0 ? (
        <section className={`${CARD} mt-5`}>
          <p className="text-[13px] text-[#667085]">
            {key
              ? "Nothing stored for this company yet. Run a scan above."
              : "No company scanned yet. Type one above and scan."}
          </p>
        </section>
      ) : (
        <>
        <section className="mt-5 grid gap-3 sm:grid-cols-3">
          {view.voices.map((v) => (
            <div key={v.voice} className={CARD}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium">{VOICE_LABEL[v.voice]}</span>
                <span className="text-[22px] font-semibold leading-none" style={{ color: toneColor(v.tone.score) }}>
                  {v.tone.score === null ? "—" : v.tone.score > 0 ? `+${v.tone.score}` : v.tone.score}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[#667085]">{VOICE_BLURB[v.voice]}</p>
              <p className="mt-2 text-[12px] text-[#475467]">
                {v.stored} post{v.stored === 1 ? "" : "s"} · {v.scored} scored
              </p>
            </div>
          ))}
        </section>

        {(() => {
          const inside = view.voices.find((v) => v.voice === "employee");
          if (!inside || inside.stored === 0) {
            return (
              <section className={`${CARD} mt-5`}>
                <h2 className="text-[15px] font-semibold">Inside the company</h2>
                <p className="mt-2 text-[13px] text-[#667085]">
                  Nobody in this scan wrote a headline naming the company. Staff
                  often leave the employer out of a headline, so add parent or
                  former names with <code>?alias=</code> and reload before
                  concluding they are quiet.
                </p>
              </section>
            );
          }
          return (
            <section className={`${CARD} mt-5`}>
              <h2 className="text-[15px] font-semibold">
                Inside the company
                <span className="ml-2 text-[12px] font-normal text-[#667085]">
                  newest first — a quiet role change is the point, so this is not ranked by loudness
                </span>
              </h2>
              <ul className="mt-3 space-y-3">
                {inside.top.map((p) => (
                  <li key={p.id} className="rounded-[10px] border border-[#EAECF0] p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium">{p.title ?? "LinkedIn post"}</span>
                      <span className="shrink-0 text-[12px]">
                        {p.theme && <span className="capitalize text-[#98A2B3]">{p.theme}</span>}
                        {p.sentiment !== null && (
                          <span className="ml-2 font-medium" style={{ color: toneColor(p.sentiment) }}>
                            {p.sentiment > 0 ? `+${p.sentiment}` : p.sentiment}
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] text-[#344054]">
                      {p.evidence ? <span className="italic">“{p.evidence}”</span> : (p.body ?? "").slice(0, 260)}
                    </p>
                    <p className="mt-1.5 text-[11px] text-[#98A2B3]">
                      {p.publishedAt ? p.publishedAt.toISOString().slice(0, 10) : "undated"}
                      {p.url && (
                        <>
                          {" · "}
                          <a href={p.url} target="_blank" rel="noreferrer" className="text-[#263BAA] hover:underline">
                            open on LinkedIn
                          </a>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })()}

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-5">
            <section className={CARD}>
              <h2 className="text-[15px] font-semibold">Sentiment</h2>
              <div className="mt-3 flex items-baseline gap-3">
                <span className="text-[38px] font-semibold leading-none"
                  style={{ color: toneColor(view.tone.score) }}>
                  {view.tone.score === null ? "—" : view.tone.score > 0 ? `+${view.tone.score}` : view.tone.score}
                </span>
                <span className="text-[13px] text-[#475467]">
                  {toneWord(view.tone.score)} · {view.tone.n} scored
                </span>
              </div>
              <p className="mt-2 text-[12px] text-[#667085]">
                −100 to +100, weighted so a post from last week counts less than
                one from yesterday. Posts the model could not quote are left out
                rather than counted as neutral.
              </p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat label="stored" value={view.stored} />
                <Stat label="read" value={view.judged} />
                <Stat label="scored" value={view.scored} />
              </dl>
              {view.scannedAt && (
                <p className="mt-3 text-[11px] text-[#98A2B3]">
                  Last scan {view.scannedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                </p>
              )}
            </section>

            {view.themes.length > 0 && (
              <section className={CARD}>
                <h2 className="text-[15px] font-semibold">Themes</h2>
                <ul className="mt-3 space-y-2">
                  {view.themes.map((t) => (
                    <li key={t.theme} className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="capitalize">{t.theme}</span>
                      <span className="shrink-0 text-[12px]">
                        <span className="text-[#667085]">{t.n} post{t.n === 1 ? "" : "s"}</span>
                        <span className="ml-2 font-medium" style={{ color: toneColor(t.score) }}>
                          {t.score === null ? "—" : t.score > 0 ? `+${t.score}` : t.score}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <section className={CARD}>
            <h2 className="text-[15px] font-semibold">
              Top posts
              <span className="ml-2 text-[12px] font-normal text-[#667085]">
                strongest opinions, each with the line it was scored on
              </span>
            </h2>
            {view.top.length === 0 ? (
              <p className="mt-2 text-[13px] text-[#667085]">
                Nothing scorable yet. {view.stored} post{view.stored === 1 ? "" : "s"} stored
                {view.judged === 0 ? " and not read yet" : ", none with a quotable line"}.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {view.top.map((p) => (
                  <li key={p.id} className="rounded-[10px] border border-[#EAECF0] p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium">{p.title ?? "LinkedIn post"}</span>
                      <span className="shrink-0 text-[12px] font-medium" style={{ color: toneColor(p.sentiment) }}>
                        {p.sentiment === null ? "—" : p.sentiment > 0 ? `+${p.sentiment}` : p.sentiment}
                        {p.theme && <span className="ml-2 font-normal capitalize text-[#98A2B3]">{p.theme}</span>}
                      </span>
                    </div>
                    {p.evidence && (
                      <p className="mt-1.5 border-l-2 border-[#DDE2EE] pl-2 text-[13px] italic text-[#344054]">
                        “{p.evidence}”
                      </p>
                    )}
                    <p className="mt-1.5 text-[11px] text-[#98A2B3]">
                      {p.publishedAt ? p.publishedAt.toISOString().slice(0, 10) : "undated"}
                      {p.url && (
                        <>
                          {" · "}
                          <a href={p.url} target="_blank" rel="noreferrer" className="text-[#263BAA] hover:underline">
                            open on LinkedIn
                          </a>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        </>
      )}
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[8px] bg-[#F9FAFB] py-2">
      <div className="text-[16px] font-semibold text-[#101828]">{value}</div>
      <div className="text-[11px] text-[#667085]">{label}</div>
    </div>
  );
}
