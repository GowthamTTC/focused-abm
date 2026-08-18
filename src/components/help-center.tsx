"use client";
/** Two things behind one "?" button: a map of what every menu does, and a
 *  sequential setup tutorial with Next / Back / Skip. Tutorial position is
 *  remembered locally so it survives a refresh mid-walkthrough. */
import { useEffect, useState } from "react";

const MENUS: [label: string, what: string][] = [
  ["Today", "Your daily cockpit: the five numbers that matter, and the button that starts a research run."],
  ["Review", "Where drafted messages live. Decisions need a verdict, Ready can be copied and sent, Sent is your log."],
  ["People", "Every person in your network, searchable and filterable — the raw list behind everything else."],
  ["Network", "Analysis of who you know: composition by ICP and country, posting activity, and how fresh each relationship is."],
  ["Alerts", "Things worth knowing — failed runs, seats needing re-auth, people who went quiet."],
  ["Sources", "Where connections come in: sync from LinkedIn or upload a CSV. Delete old batches here too."],
  ["ICPs", "The customer profiles you sell to. Matching scores every connection against these, so this is the most important setup screen."],
  ["Exports", "Download the full workbook — every tab, every verdict, with an explanation of what's inside."],
  ["Settings", "Your LinkedIn seat, daily run limit, and voice profile."],
];

const STEPS: { title: string; body: string; href: string; cta: string }[] = [
  { title: "1 · Define who you sell to",
    body: "Add your ICPs — the kinds of companies and roles you want. Each one gets a name, who it's for, and what problem it solves. Everything downstream scores against these, so spend real time here. Most firms have three to eight.",
    href: "/offers", cta: "Open ICPs" },
  { title: "2 · Connect your LinkedIn seat",
    body: "Link the LinkedIn account whose network you want to work. This is also what lets the system read profiles and posts when researching.",
    href: "/settings", cta: "Open Settings" },
  { title: "3 · Scan your voice",
    body: "One click reads your last six months of posts and your profile, then every drafted message is written in your style instead of generic AI English. Leave the URL blank to use your connected account.",
    href: "/settings", cta: "Scan my voice" },
  { title: "4 · Bring in your network",
    body: "Sync your 1st-degree connections, or upload the CSV LinkedIn gives you. This is a one-time pull you can repeat whenever your network grows.",
    href: "/sources", cta: "Open Sources" },
  { title: "5 · Run matching",
    body: "Matching reads every connection against your ICPs and sorts them into matched, off-target, peers, and excluded — then ranks the matches best-first. This is cheap and covers your whole network.",
    href: "/sources", cta: "Go to the batch" },
  { title: "6 · Research your best matches",
    body: "On Today, complete the sentence: research your top N matches, optionally in one country, optionally only people who posted recently. Research is the expensive step, so it runs on a daily budget — best-ranked first.",
    href: "/dashboard", cta: "Open Today" },
  { title: "7 · Review and send",
    body: "Drafts land in Review. Give flagged people a verdict, copy the ready ones into LinkedIn, and mark them sent. That log becomes your reply-rate evidence.",
    href: "/review", cta: "Open Review" },
];

const KEY = "fabm-tutorial-step";

export function HelpCenter() {
  const [open, setOpen] = useState(false);
  const [tour, setTour] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    const saved = Number(localStorage.getItem(KEY) ?? -1);
    if (saved >= 0 && saved < STEPS.length) { setI(saved); }
  }, []);
  useEffect(() => { if (tour) localStorage.setItem(KEY, String(i)); }, [tour, i]);

  const close = () => { setOpen(false); setTour(false); };
  const finish = () => { localStorage.setItem(KEY, String(STEPS.length)); close(); };

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Help"
        title="Help — what each menu does, and a step-by-step setup walkthrough"
        className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#DDE2EE] bg-white text-[13px] text-[#475467] transition-colors duration-[130ms] hover:border-[#263BAA] hover:text-[#263BAA]">
        ?
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#101828]/20 px-4 pt-[8vh]"
          onClick={close}>
          <div className="max-h-[78vh] w-full max-w-2xl overflow-auto rounded-[14px] border border-[#DDE2EE] bg-white p-6 shadow-[0_12px_32px_rgba(16,24,40,.14)]"
            onClick={(e) => e.stopPropagation()}>

            {!tour ? (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-[#101828]">Help</h2>
                    <p className="mt-1 text-sm text-[#475467]">What each menu is for. New here? Take the walkthrough.</p>
                  </div>
                  <button onClick={close} aria-label="Close" className="px-2 text-[18px] leading-none text-[#98A2B3] hover:text-[#475467]">×</button>
                </div>

                <button onClick={() => setTour(true)}
                  className="mt-4 w-full rounded-[10px] bg-[#263BAA] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1D2E86]">
                  Start the setup walkthrough — 7 steps
                </button>

                <dl className="mt-5 divide-y divide-[#EEF1F8]">
                  {MENUS.map(([label, what]) => (
                    <div key={label} className="grid grid-cols-[110px_1fr] gap-4 py-2.5">
                      <dt className="text-sm font-medium text-[#101828]">{label}</dt>
                      <dd className="text-sm text-[#475467]">{what}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <span className="tnum text-xs uppercase tracking-wide text-[#98A2B3]">
                    Step {i + 1} of {STEPS.length}
                  </span>
                  <button onClick={close} aria-label="Close" className="px-2 text-[18px] leading-none text-[#98A2B3] hover:text-[#475467]">×</button>
                </div>
                <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-[#EEF1F8]">
                  <div className="h-[3px] rounded-full bg-[#263BAA] transition-[width] duration-[200ms]"
                    style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} />
                </div>

                <h2 className="mt-4 text-lg font-semibold text-[#101828]">{STEPS[i].title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-[#475467]">{STEPS[i].body}</p>

                <a href={STEPS[i].href}
                  className="mt-4 inline-block rounded-[10px] border border-[#263BAA] px-4 py-2 text-sm font-medium text-[#263BAA] hover:bg-[#EEF1FC]">
                  {STEPS[i].cta} →
                </a>

                <div className="mt-6 flex items-center justify-between border-t border-[#EEF1F8] pt-4">
                  <button onClick={finish} className="text-sm text-[#98A2B3] hover:text-[#475467]">Skip walkthrough</button>
                  <div className="flex gap-2">
                    {i > 0 && (
                      <button onClick={() => setI(i - 1)}
                        className="rounded-[10px] border border-[#DDE2EE] px-4 py-2 text-sm text-[#475467] hover:bg-[#F4F6FB]">
                        Back
                      </button>
                    )}
                    {i < STEPS.length - 1 ? (
                      <button onClick={() => setI(i + 1)}
                        className="rounded-[10px] bg-[#263BAA] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D2E86]">
                        Next
                      </button>
                    ) : (
                      <button onClick={finish}
                        className="rounded-[10px] bg-[#263BAA] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D2E86]">
                        Done
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
