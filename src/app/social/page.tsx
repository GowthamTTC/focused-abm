/**
 * Social — what the people you know actually said.
 *
 * The deliberate opposite of Today. Today is a SALES list and every gate it has
 * exists to keep that list short: a hook, a relevance score, one row per
 * person, one per employer, bucket = pitchable, one campaign. This screen
 * applies none of them, because a reshare with no hook, a congratulation
 * scoring zero, three posts by one person in a week, and a competitor you have
 * known for years are all things you might want to reply to — and Today
 * structurally cannot show any of them.
 *
 * The only filters are: your 1st-degree connections, this workspace, and the
 * window you picked.
 *
 * THE COVERAGE LINE IS NOT DECORATION. Posts only exist for people somebody has
 * checked, and checking is capped at a shared 100 people a day. So a short list
 * here usually means "most of your network has not been looked at", not "your
 * network was quiet" — and a full-looking page drawn from a fraction of the
 * network, with nothing saying so, would be the most misleading thing this
 * feature could ship.
 */
import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Shell, requirePage } from "@/app/shell";
import { socialHidden } from "@/lib/feature-access";
import { db, job } from "@/db";
import { ago } from "@/components/dash-bits";
import { getDailyScanUsage } from "@/modules/posts/usage";
import {
  SOCIAL_SCAN_MAX_RUN, SOCIAL_WINDOWS, deepLinkFor, socialCoverage, socialDays, socialFeed,
} from "@/modules/posts/feed";
import { scanConnections } from "./actions";

const CARD = "bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const SELECT = "rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5 text-[13px]";

const ERR: Record<string, string> = {
  noseat: "Connect a LinkedIn seat in Settings first.",
  busy: "A run is already going. Give it a moment.",
  cap: "Today's check limit is used up. It resets at midnight UTC.",
  none: "Everyone reachable has already been checked today.",
};

export default async function SocialPage({ searchParams }: {
  searchParams: Promise<{ days?: string; n?: string; err?: string; scanning?: string }>;
}) {
  const user = await requirePage();
  // Same shape as /nova: the route itself refuses, so a bookmarked or guessed
  // URL lands somewhere useful rather than on a page the seat should not see.
  if (socialHidden(user)) redirect("/dashboard");
  const sp = await searchParams;
  const days = socialDays(sp.days);
  const limit = Number(sp.n) || undefined;

  const [feed, cov, usage, [activeJob]] = await Promise.all([
    socialFeed(user.orgId, { days, limit }),
    socialCoverage(user.orgId, days),
    getDailyScanUsage(user.orgId),
    db.select({ id: job.id }).from(job)
      .where(and(eq(job.orgId, user.orgId), inArray(job.status, ["queued", "running", "stopping"])))
      .limit(1),
  ]);

  const rows = feed.rows;
  const link = (d: number) => `/social?days=${d}`;
  // The honest headline number: the dropdown filters posted_at, but what
  // actually bounds this list is how many people were CHECKED recently.
  const behind = cov.scansPerDayForWindow > usage.cap;

  return (
    <Shell user={user} active="social">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Social</h1>
          <p className="mt-1 max-w-xl text-sm text-[#475467]">
            Everything your 1st-degree connections posted — no scoring, no filtering by fit.
            Open one to like or reply on LinkedIn.
          </p>
          {sp.err && <p className="mt-1 text-sm text-[#B54708]">{ERR[sp.err] ?? "That did not run."}</p>}
          {sp.scanning && <p className="mt-1 text-sm text-[#067647]">Checking {SOCIAL_SCAN_MAX_RUN} more connections — posts appear as they arrive.</p>}
        </div>
        <form action={scanConnections} className="flex flex-wrap items-center gap-2 text-[13px]">
          <select name="days" defaultValue={String(days)} className={SELECT}>
            {SOCIAL_WINDOWS.map((d) => <option key={d} value={d}>last {d} days</option>)}
          </select>
          <button className="rounded-[8px] bg-[#263BAA] px-3 py-1.5 text-white disabled:opacity-40"
            disabled={Boolean(activeJob) || usage.remaining === 0}>
            Check {Math.min(SOCIAL_SCAN_MAX_RUN, usage.remaining)} more
          </button>
        </form>
      </div>

      {/* Changing the window must not need the button pressed, so the select
          doubles as a set of links. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
        {SOCIAL_WINDOWS.map((d) => (
          <Link key={d} href={link(d)}
            className={`rounded-[8px] border px-3 py-1.5 ${d === days
              ? "border-[#263BAA] bg-[#EEF1FB] text-[#263BAA]"
              : "border-[#DDE2EE] text-[#475467] hover:bg-[#F4F6FB]"}`}>
            Last {d} days
          </Link>
        ))}
      </div>

      {/* ── What this page can and cannot see ── */}
      <section className={`${CARD} mt-4 p-4`}>
        <p className="text-[13px] text-[#475467]">
          <span className="tnum font-medium text-[#101828]">{cov.firstDegree}</span> 1st-degree connections ·{" "}
          <span className="tnum">{cov.everScanned}</span> ever checked ·{" "}
          <span className="tnum">{cov.neverScanned}</span> never checked
          {cov.newestScan && <> · newest check {ago(cov.newestScan)}</>}
        </p>
        <p className="mt-1 text-[12px] leading-5 text-[#98A2B3]">
          {cov.scannedInWindow === 0
            ? `Nobody has been checked in the last ${days} days, so this list can only hold posts found earlier. `
            : `${cov.scannedInWindow} of them were checked in the last ${days} days. `}
          {behind ? (
            <>
              Keeping a {days}-day window honest across {cov.firstDegree} people would mean checking{" "}
              <span className="tnum">{cov.scansPerDayForWindow}</span> a day, and the limit is{" "}
              <span className="tnum">{usage.cap}</span> — so this is what the people we checked posted,
              not what your whole network posted.
            </>
          ) : (
            <>Checking {cov.scansPerDayForWindow} a day would keep this window complete, within the {usage.cap}/day limit.</>
          )}
          {" "}Used today: <span className="tnum">{usage.used}</span>/<span className="tnum">{usage.cap}</span>.
        </p>
      </section>

      {rows.length === 0 ? (
        <section className={`${CARD} mt-4 p-6`}>
          <p className="text-[15px] font-medium text-[#101828]">Nothing in the last {days} days.</p>
          <p className="mt-2 max-w-xl text-[13px] leading-6 text-[#475467]">
            {cov.firstDegree === 0
              ? <>No connections in this workspace yet — <Link href="/sources" className="text-[#263BAA] underline underline-offset-2">sync LinkedIn or upload a CSV</Link> first.</>
              : cov.everScanned === 0
                ? <>Nobody has been checked yet. Press <span className="font-medium">Check {Math.min(SOCIAL_SCAN_MAX_RUN, usage.remaining)} more</span> to fetch recent posts — that is the only way posts get here.</>
                : <>
                    {cov.everScanned} people have been checked and none of them posted in this window.
                    {" "}Try a wider one — {SOCIAL_WINDOWS.filter((d) => d > days).map((d, i) => (
                      <span key={d}>{i > 0 ? " or " : ""}<Link href={link(d)} className="text-[#263BAA] underline underline-offset-2">{d} days</Link></span>
                    ))}
                    {cov.neverScanned > 0 && <> — or check some of the {cov.neverScanned} nobody has looked at.</>}
                  </>}
          </p>
        </section>
      ) : (
        <section className="mt-4 space-y-3">
          {/* Keyed on the POST, not the person: one person can appear several
              times here, which is the point of the screen. */}
          {rows.map((r) => {
            const href = deepLinkFor(r);
            return (
              <article key={r.postId} className={`${CARD} p-4`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[14px] font-medium text-[#101828]">
                    {r.firstName} {r.lastName}
                    {r.role && <span className="ml-2 text-[12px] font-normal text-[#98A2B3]">{r.role}</span>}
                    {r.company && <span className="ml-1 text-[12px] font-normal text-[#98A2B3]">· {r.company}</span>}
                  </p>
                  <span className="tnum text-[11px] text-[#98A2B3]">
                    {r.postedAt ? ago(r.postedAt) : ""}
                    {r.sentAt && <> · already messaged</>}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-[#344054]">{r.excerpt}</p>
                {href && (
                  <a href={href} target="_blank" rel="noreferrer"
                    className="mt-2 inline-block text-[12px] text-[#263BAA] underline underline-offset-2">
                    Open on LinkedIn →
                  </a>
                )}
              </article>
            );
          })}
        </section>
      )}
    </Shell>
  );
}
