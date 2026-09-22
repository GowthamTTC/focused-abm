/**
 * Account Pulse panel. Facts about a company — never a person (§0).
 *
 * Every band here can be empty, and an empty band ALWAYS says which kind of
 * empty it is: switched off for this seat, nothing fetched because no domains
 * are allowed, or not enough read yet. A band that renders as blank reads as
 * "nothing is happening at this account", which is the most misleading thing
 * this panel could do — the same reasoning as the coverage line on /social.
 */
import { ago } from "@/components/dash-bits";
import {
  NETWORK_MIN_PEOPLE,
  NETWORK_MIN_POSTS,
  PULSE_WINDOW_DAYS,
  type AccountPulse,
} from "@/modules/pulse/types";

const CARD = "rounded-[12px] border border-[#DDE2EE] bg-white p-4";
const MUTED = "text-[12px] leading-5 text-[#98A2B3]";

/** Sentiment is signed, so it gets a signed colour. Null is never coloured —
 *  it is not a neutral score, it is the absence of one. */
function toneOf(score: number | null): string {
  if (score === null) return "text-[#98A2B3]";
  if (score >= 25) return "text-[#067647]";
  if (score <= -25) return "text-[#B42318]";
  return "text-[#475467]";
}

function Score({ score, n, label }: { score: number | null; n: number; label: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-[#98A2B3]">{label}</p>
      {score === null ? (
        <p className="mt-0.5 text-[13px] text-[#98A2B3]">Not enough read yet</p>
      ) : (
        <p className={`mt-0.5 text-lg font-semibold tnum ${toneOf(score)}`}>
          {score > 0 ? `+${score}` : score}
          <span className="ml-1 text-[12px] font-normal text-[#98A2B3]">from {n}</span>
        </p>
      )}
    </div>
  );
}

export function PulsePanel({ pulse, domains }: { pulse: AccountPulse; domains: number }) {
  const { network } = pulse;
  // Volume against the account's own trailing window, never folded into tone:
  // at a restructuring account people go quiet rather than hostile, and one
  // number cannot say both (§2).
  const quieter = network.baselineVolume > 0 && network.volume < network.baselineVolume / 2;

  return (
    <section className="mt-5 border-t border-[#EEF1F8] pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold">Pulse</h3>
        <span className={MUTED}>
          {pulse.refreshedAt ? `refreshed ${ago(pulse.refreshedAt)}` : "never refreshed"}
        </span>
      </div>

      <div className="mt-3 flex gap-6">
        <Score score={pulse.narrative.score} n={pulse.narrative.n} label="Narrative" />
        <Score score={network.score} n={network.n} label="Network" />
      </div>

      {/* ── Network coverage. The denominator, always. ── */}
      <p className={`mt-2 ${MUTED}`}>
        {network.hidden ? (
          <>The Network band is switched off for this workspace. The other bands are unaffected.</>
        ) : (
          <>
            <span className="tnum">{network.peopleAtAccount}</span> here in your network ·{" "}
            <span className="tnum">{network.peopleChecked}</span> ever checked ·{" "}
            <span className="tnum">{network.postsRead}</span> posts read in {PULSE_WINDOW_DAYS} days
            {network.score === null && network.postsRead > 0 && (
              <> · below the {NETWORK_MIN_POSTS}-post, {NETWORK_MIN_PEOPLE}-person floor, so no score is shown</>
            )}
            {quieter && (
              <> · <span className="text-[#B54708]">quieter than usual</span> ({network.volume} vs {network.baselineVolume} the window before) — which is not the same as negative</>
            )}
          </>
        )}
      </p>

      {/* ── Triggers ── */}
      <div className="mt-4">
        <p className="text-[11px] uppercase tracking-wider text-[#98A2B3]">Triggers</p>
        {pulse.triggers.length === 0 ? (
          <p className={`mt-1 ${MUTED}`}>
            {pulse.refreshedAt
              ? "No credible trigger at this account right now. That is a real answer, not a gap."
              : "Nothing yet — refresh to look."}
          </p>
        ) : (
          <ul className="mt-1 space-y-2">
            {pulse.triggers.map((t, i) => (
              <li key={`${t.theme}-${i}`} className={CARD}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium">{t.theme}</span>
                  <span className="tnum text-[11px] text-[#98A2B3]">{t.confidence}</span>
                </div>
                <p className="mt-1 text-[12px] leading-5 text-[#475467]">{t.why}</p>
                <p className="mt-1 text-[11px] text-[#263BAA]">
                  {t.serviceSlug ?? "no offer in this catalogue opens on it"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Competitors ── */}
      {pulse.competitors.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wider text-[#98A2B3]">Also seen here</p>
          {/* The quote, not just the count. A bare "Korn Ferry (1)" cannot be
              checked, and an incumbent is too consequential a claim to make
              without showing the sentence it rests on. */}
          <ul className="mt-1 space-y-1.5">
            {pulse.competitors.map((c) => (
              <li key={c.peer} className="text-[12px] leading-5">
                <span className="font-medium text-[#101828]">{c.peer}</span>
                <span className={MUTED}>
                  {" "}· {c.mentions} mention{c.mentions === 1 ? "" : "s"}
                  {c.latestAt ? ` · ${ago(c.latestAt)}` : ""}
                </span>
                {c.snippet && (
                  <p className="mt-0.5 text-[#475467]">&ldquo;{c.snippet}&rdquo;</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── News ── */}
      <div className="mt-4">
        <p className="text-[11px] uppercase tracking-wider text-[#98A2B3]">News</p>
        {pulse.news.length === 0 ? (
          <p className={`mt-1 ${MUTED}`}>
            {domains === 0
              ? "No news domains are allowed for this workspace, so nothing was fetched. This band is empty because nobody looked, not because nothing happened."
              : "Nothing fetched for this account yet."}
          </p>
        ) : (
          <ul className="mt-1 space-y-2">
            {pulse.news.slice(0, 8).map((s) => (
              <li key={s.id} className="text-[12px] leading-5">
                <a href={s.url ?? "#"} target="_blank" rel="noreferrer"
                  className="text-[#101828] hover:text-[#263BAA]">
                  {s.title ?? s.url}
                </a>
                <span className={MUTED}>
                  {" "}· {s.source ?? "unknown"}
                  {s.publishedAt ? ` · ${ago(s.publishedAt)}` : ""}
                  {s.theme ? ` · ${s.theme}` : ""}
                </span>
                {s.sentiment !== null && (
                  <span className={`ml-1 tnum text-[11px] ${toneOf(s.sentiment)}`}>
                    {s.sentiment > 0 ? `+${s.sentiment}` : s.sentiment}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
