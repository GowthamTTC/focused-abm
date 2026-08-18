"use client";
/** Three pieces of guidance, one component:
 *  · "?"  — a map of what every menu does, plus the walkthrough launcher
 *  · "i"  — turns the hover tooltips on the sidebar on or off
 *  · the walkthrough itself — a docked panel that FOLLOWS the user from page
 *    to page until they finish it, keeping Back / Next / Skip in their hands. */
import { useEffect, useState } from "react";

const MENUS: [label: string, what: string][] = [
  ["Today", "Your daily cockpit: the five numbers that matter, and the sentence that starts a research run."],
  ["Review", "Where drafted messages live. Decisions need a verdict, Ready can be copied and sent, Sent is your log."],
  ["People", "Every person in your network, searchable and filterable."],
  ["Network", "Who you know: composition by ICP and country, posting activity, relationship freshness."],
  ["Alerts", "Failed runs, seats needing re-auth, people who went quiet."],
  ["Sources", "Where connections come in — sync LinkedIn or upload a CSV. Delete old batches here."],
  ["ICPs", "The customer profiles you sell to. Everything is scored against these, so this is the most important setup screen."],
  ["Exports", "Download the full workbook — classify and research results, side by side."],
  ["Settings", "Your LinkedIn seat, daily run limit, and voice profile."],
];

const STEPS: { title: string; body: string; href: string; cta: string }[] = [
  { title: "Define who you sell to",
    body: "Add your ICPs — the kinds of companies and roles you want. Each gets a name, who it's for, and the problem it solves. Everything downstream scores against these. Most firms have three to eight.",
    href: "/offers", cta: "Open ICPs" },
  { title: "Connect your LinkedIn seat",
    body: "Link the LinkedIn account whose network you want to work. This is also what lets the system read profiles and posts during research.",
    href: "/settings", cta: "Open Settings" },
  { title: "Scan your voice",
    body: "One click reads your last six months of posts and your profile, then every draft is written in your style instead of generic AI English. Leave the URL blank to use your connected account.",
    href: "/settings", cta: "Go scan it" },
  { title: "Bring in your network",
    body: "Sync your 1st-degree connections, or upload the CSV LinkedIn gives you. Repeat whenever your network grows.",
    href: "/sources", cta: "Open Sources" },
  { title: "Run matching",
    body: "Matching reads every connection against your ICPs, sorts them into matched, off-target, peers and excluded, then ranks the matches best-first. Cheap, and it covers the whole network.",
    href: "/sources", cta: "Open the batch" },
  { title: "Research your best matches",
    body: "On Today, complete the sentence: research your top N matches, optionally in one country, optionally only people who posted recently. Research is the expensive step — it runs best-ranked-first inside your daily budget.",
    href: "/dashboard", cta: "Open Today" },
  { title: "Review and send",
    body: "Drafts land in Review. Give flagged people a verdict, copy the ready ones into LinkedIn, mark them sent. That log becomes your reply-rate evidence.",
    href: "/review", cta: "Open Review" },
];

const STEP_KEY = "fabm-tutorial-step";
const ACTIVE_KEY = "fabm-tutorial-active";
const TIPS_KEY = "fabm-tips";

export function HelpCenter() {
  const [open, setOpen] = useState(false);
  const [tour, setTour] = useState(false);
  const [i, setI] = useState(0);
  const [tips, setTips] = useState(true);

  // Resume: if a walkthrough was left running, it reappears on whatever page
  // the user lands on — that is what makes it "follow" them.
  useEffect(() => {
    const on = localStorage.getItem(TIPS_KEY) !== "off";
    setTips(on);
    document.documentElement.dataset.tips = on ? "on" : "off";
    if (localStorage.getItem(ACTIVE_KEY) === "1") {
      const saved = Number(localStorage.getItem(STEP_KEY) ?? 0);
      setI(Math.min(Math.max(saved, 0), STEPS.length - 1));
      setTour(true);
    }
  }, []);

  const go = (next: number) => {
    setI(next);
    localStorage.setItem(STEP_KEY, String(next));
  };
  const startTour = () => {
    localStorage.setItem(ACTIVE_KEY, "1");
    localStorage.setItem(STEP_KEY, String(i));
    setOpen(false);
    setTour(true);
  };
  const endTour = () => {
    localStorage.setItem(ACTIVE_KEY, "0");
    localStorage.setItem(STEP_KEY, "0");
    setTour(false);
    setI(0);
  };
  const toggleTips = () => {
    const on = !tips;
    setTips(on);
    localStorage.setItem(TIPS_KEY, on ? "on" : "off");
    document.documentElement.dataset.tips = on ? "on" : "off";
  };

  return (
    <>
      <button onClick={toggleTips} aria-label="Toggle menu tooltips"
        title={tips ? "Menu tooltips are ON — click to turn off" : "Menu tooltips are OFF — click to turn on"}
        className={`flex h-8 w-8 items-center justify-center rounded-[8px] border text-[13px] italic transition-colors duration-[130ms] ${tips
          ? "border-[#263BAA] bg-[#EEF1FC] text-[#263BAA]"
          : "border-[#DDE2EE] bg-white text-[#98A2B3] hover:text-[#475467]"}`}>
        i
      </button>

      <button onClick={() => setOpen(true)} aria-label="Help"
        title="Help — what each menu does, and the setup walkthrough"
        className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#DDE2EE] bg-white text-[13px] text-[#475467] transition-colors duration-[130ms] hover:border-[#263BAA] hover:text-[#263BAA]">
        ?
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#101828]/20 px-4 pt-[8vh]" onClick={() => setOpen(false)}>
          <div className="max-h-[78vh] w-full max-w-2xl overflow-auto rounded-[14px] border border-[#DDE2EE] bg-white p-6 shadow-[0_12px_32px_rgba(16,24,40,.14)]"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#101828]">Help</h2>
                <p className="mt-1 text-sm text-[#475467]">What each menu is for. New here? Take the walkthrough — it follows you from screen to screen.</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="px-2 text-[18px] leading-none text-[#98A2B3] hover:text-[#475467]">×</button>
            </div>
            <button onClick={startTour}
              className="mt-4 w-full rounded-[10px] bg-[#263BAA] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1D2E86]">
              {localStorage.getItem(ACTIVE_KEY) === "1" ? "Resume the setup walkthrough" : `Start the setup walkthrough — ${STEPS.length} steps`}
            </button>
            <dl className="mt-5 divide-y divide-[#EEF1F8]">
              {MENUS.map(([label, what]) => (
                <div key={label} className="grid grid-cols-[110px_1fr] gap-4 py-2.5">
                  <dt className="text-sm font-medium text-[#101828]">{label}</dt>
                  <dd className="text-sm text-[#475467]">{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {tour && (
        <div className="fixed bottom-5 right-5 z-40 w-[360px] rounded-[14px] border border-[#DDE2EE] bg-white p-5 shadow-[0_12px_32px_rgba(16,24,40,.14)]">
          <div className="flex items-center justify-between">
            <span className="tnum text-[11px] uppercase tracking-wide text-[#98A2B3]">
              Setup · step {i + 1} of {STEPS.length}
            </span>
            <button onClick={endTour} aria-label="Close walkthrough"
              className="px-1 text-[16px] leading-none text-[#98A2B3] hover:text-[#475467]">×</button>
          </div>
          <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[#EEF1F8]">
            <div className="h-[3px] rounded-full bg-[#263BAA] transition-[width] duration-[200ms]"
              style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} />
          </div>
          <h3 className="mt-3 text-[15px] font-semibold text-[#101828]">{STEPS[i].title}</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#475467]">{STEPS[i].body}</p>
          <a href={STEPS[i].href}
            className="mt-3 inline-block rounded-[8px] border border-[#263BAA] px-3 py-1.5 text-[13px] font-medium text-[#263BAA] hover:bg-[#EEF1FC]">
            {STEPS[i].cta} →
          </a>
          <div className="mt-4 flex items-center justify-between border-t border-[#EEF1F8] pt-3">
            <button onClick={endTour} className="text-[12px] text-[#98A2B3] hover:text-[#475467]">Skip</button>
            <div className="flex gap-2">
              {i > 0 && (
                <button onClick={() => go(i - 1)}
                  className="rounded-[8px] border border-[#DDE2EE] px-3 py-1.5 text-[13px] text-[#475467] hover:bg-[#F4F6FB]">Back</button>
              )}
              <button onClick={() => (i < STEPS.length - 1 ? go(i + 1) : endTour())}
                className="rounded-[8px] bg-[#263BAA] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#1D2E86]">
                {i < STEPS.length - 1 ? "Next" : "Done"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
