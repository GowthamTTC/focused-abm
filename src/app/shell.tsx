import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, connection, job } from "@/db";
import { currentUser, logout, type Ctx } from "@/auth/session";
import { env } from "@/lib/env";
import { requestStop } from "@/app/jobs/actions";
import { NavIcon } from "@/components/nav-icons";
import { CommandPalette, PaletteTrigger } from "@/components/command-palette";
import { LiveJob } from "@/components/live-job";
import { DismissibleBanner } from "@/components/dismissible-banner";
import { HelpCenter } from "@/components/help-center";
import { AgentRail } from "@/components/agent-rail";
import { novaHidden } from "@/lib/nova-access";

export async function requirePage(): Promise<Ctx> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  return user;
}

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

/** Turn provider noise into something a salesperson can act on. The raw text
 *  stays available on hover. */
function plainError(raw: string | null): string {
  const e = raw ?? "something went wrong";
  if (/invalid_recipient|cannot be reached/i.test(e))
    return "LinkedIn wouldn't return that profile. Re-scan from Settings — leave the URL blank to use your connected account.";
  if (/429|rate.?limit/i.test(e)) return "LinkedIn rate limit hit — wait a few minutes and try again.";
  if (/401|403|reauth|unauthor/i.test(e)) return "the LinkedIn seat needs reconnecting (Settings → seat).";
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(e)) return "the connection dropped mid-run. Try again.";
  return e.length > 140 ? e.slice(0, 140) + "…" : e;
}

const KIND_LABEL: Record<string, string> = {
  classify: "Matching", deep_enrich: "Researching", sync: "Syncing",
  import: "Importing", activity_scan: "Scanning posts", voice_scan: "Sampling voice",
  event_scan: "Event scan",
  event_extended: "Event search",
};

const NAV: { section: string; items: [key: string, href: string, label: string, tip: string][] }[] = [
  { section: "Work", items: [
    ["nova", "/nova", "Nova", "Ask Nova — counts, shortlist, enrich, Radar"],
    ["dashboard", "/dashboard", "Today", "Your daily numbers and the research button"],
    ["review", "/review", "Review", "Verdicts, ready-to-send drafts, and your sent log"],
    ["people", "/people", "People", "Every person in your network, searchable"],
  ]},
  { section: "On site", items: [
    ["radar", "/radar", "Radar", "Event metro scan — separate from matching and research"],
  ]},
  { section: "Analysis", items: [
    ["accounts", "/accounts", "Accounts", "Companies with pitchable coverage — warm ABM list"],
    ["network", "/network", "Network", "Composition by ICP and country, activity, and freshness"],
    ["alerts", "/alerts", "Alerts", "Failed runs, seats needing re-auth, people gone quiet"],
  ]},
  { section: "Setup", items: [
    ["sources", "/sources", "Sources", "Sync LinkedIn or upload a CSV; manage batches"],
    ["offers", "/offers", "ICPs", "Who you sell to — people are matched to these profiles"],
    ["exports", "/exports", "Exports", "Download the full workbook"],
    ["settings", "/settings", "Settings", "LinkedIn seat, run limit, and your voice profile"],
  ]},
];

export async function Shell({ user, active, children }: {
  user: Ctx; active: string; children: React.ReactNode;
}) {
  const isAdmin = user.email.toLowerCase() === (env.ADMIN_EMAIL ?? "").toLowerCase();
  const hideNova = novaHidden(user);
  const [jobs, [badges]] = await Promise.all([
    db.select().from(job).where(eq(job.orgId, user.orgId)).orderBy(desc(job.createdAt)).limit(1),
    db.select({
      decisions: sql<number>`count(*) filter (where flag is not null and flag_verdict is null and enrich_status = 'done')::int`,
      ready: sql<number>`count(*) filter (where enrich_status = 'done' and outreach_message is not null and sent_at is null and (flag is null or flag_verdict = 'variant'))::int`,
    }).from(connection).where(eq(connection.orgId, user.orgId)),
  ]);
  const latest = jobs[0];
  const running = latest && ["running", "queued", "stopping"].includes(latest.status) ? latest : null;
  const dismissed = Boolean((latest?.payloadJson as { dismissed?: boolean } | null)?.dismissed);
  const failed = latest && latest.status === "failed" && !dismissed ? latest : null;
  const pct = running && (running.total ?? 0) > 0
    ? Math.min(100, Math.round(((running.progress ?? 0) / running.total) * 100)) : 0;
  const reviewBadge = (badges?.decisions ?? 0) + (badges?.ready ?? 0);
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const badgeFor = (key: string): { n: number; owed: boolean } | null => {
    if (key === "review" && reviewBadge > 0) return { n: reviewBadge, owed: (badges?.decisions ?? 0) > 0 };
    return null;
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#F6F7FB] text-[#101828]">
      <CommandPalette />
      {/* ── Sidebar 232px ── */}
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-[#DDE2EE] bg-white">
        <div className="flex items-center gap-[9px] px-4 pb-[14px] pt-[18px]">
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-[#263BAA] text-[12px] font-bold text-white">F</span>
          <span className="min-w-0">
            <span className="block whitespace-nowrap text-[14px] font-semibold tracking-[-.01em] text-[#101828]">Focused ABM</span>
            <span className="block text-[10px] uppercase tracking-[.06em] text-[#98A2B3]">Warm network</span>
          </span>
        </div>
        <nav className="pane-scroll flex-1 px-[10px] pb-[10px] pt-1">
          {NAV.map((group) => (
            <div key={group.section} className="mb-4">
              <p className="mb-[6px] px-2 text-[9px] font-semibold uppercase tracking-[.12em] text-[#98A2B3]">{group.section}</p>
              <div className="space-y-[2px]">
                {group.items.filter(([key]) => !(hideNova && key === "nova")).map(([key, href, label, tip]) => {
                  const isActive = active === key;
                  const badge = badgeFor(key);
                  return (
                    <Link key={key} href={href} data-tip={tip}
                      className={`nav-tip relative flex w-full items-center justify-between gap-2 rounded-[8px] px-[10px] py-[7px] text-[13px] transition-colors duration-[130ms] ${isActive
                        ? "bg-[#EEF1FC] font-medium text-[#263BAA]"
                        : "text-[#475467] hover:bg-[#F4F6FB] hover:text-[#101828]"}`}>
                      <span className="flex min-w-0 flex-1 items-center gap-[9px]">
                        <NavIcon name={key === "dashboard" ? "today" : key} />
                        <span className="whitespace-nowrap">{label}</span>
                      </span>
                      {badge && (
                        <span className={`tnum rounded-[4px] px-[5px] py-px text-[10px] ${badge.owed ? "bg-[#FDF6E7] text-[#B54708]" : "bg-[#EEF1FC] text-[#263BAA]"}`}>
                          {badge.n}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          {isAdmin && (
            <div className="mb-4">
              <p className="mb-[6px] px-2 text-[9px] font-semibold uppercase tracking-[.12em] text-[#98A2B3]">Admin</p>
              <Link href="/admin"
                className={`flex items-center gap-[9px] rounded-[8px] px-[10px] py-[7px] text-[13px] transition-colors duration-[130ms] ${active === "admin"
                  ? "bg-[#EEF1FC] font-medium text-[#263BAA]" : "text-[#475467] hover:bg-[#F4F6FB] hover:text-[#101828]"}`}>
                <NavIcon name="admin" /><span>Console</span>
              </Link>
            </div>
          )}
        </nav>
        <div className="group border-t border-[#DDE2EE] px-[14px] py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#EEF1FC] text-[10px] font-semibold text-[#263BAA]">{initials}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium">{user.name}</span>
              <span className="block text-[10px] text-[#98A2B3]">{user.email}</span>
            </span>
          </div>
          <form action={signOut} className="mt-1.5">
            <button className="text-[12px] text-[#475467] underline-offset-2 hover:underline">sign out</button>
          </form>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex h-screen min-w-0 flex-1 flex-col">
        {/* Header 54px */}
        <header className="flex min-h-[54px] items-center gap-3 border-b border-[#DDE2EE] bg-white px-5">
          <div className="min-w-0 flex-initial overflow-hidden" id="campaign-slot" />
          <div className="ml-auto flex flex-none items-center gap-[14px]">
            <PaletteTrigger />
            <HelpCenter />
            <Link href="/alerts" className="flex items-center gap-2 rounded-[10px] border border-[#DDE2EE] px-[10px] py-[6px] text-[13px] text-[#475467] transition-colors duration-[130ms] hover:border-[#98A2B3]">
              Alerts
            </Link>
            <span className="flex items-center">
              <span className="z-[3] flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-white bg-[#EEF1FC] text-[10px] font-semibold text-[#263BAA]">{initials}</span>
            </span>
          </div>
        </header>

        {running && (
          <div className="flex shrink-0 items-center gap-3 border-b border-[#DDE2EE] bg-white px-5 py-2">
            <LiveJob label={KIND_LABEL[running.kind] ?? running.kind}
              initial={{ id: running.id, kind: running.kind, status: running.status,
                progress: running.progress, total: running.total }} />
            {running.status !== "stopping" && (
              <form action={requestStop.bind(null, running.id)}>
                <button className="rounded-[6px] border border-[#DDE2EE] px-2 py-[2px] text-[11px] text-[#475467] transition-colors duration-[130ms] hover:border-[#FDA29B] hover:text-[#B42318]"
                  title="Stops at the next safe point — completed people keep their results.">
                  Stop
                </button>
              </form>
            )}
          </div>
        )}
        {failed && (
          <DismissibleBanner jobId={failed.id} title={failed.error ?? undefined}>
            {KIND_LABEL[failed.kind] ?? failed.kind} failed — {plainError(failed.error)}
          </DismissibleBanner>
        )}
        <main className="pane-scroll min-h-0 flex-1">
          <div className="mx-auto max-w-[1240px] px-6 pb-14 pt-[22px]">{children}</div>
        </main>
        {active !== "nova" && !hideNova && <AgentRail page={active || "app"} />}
      </div>
    </div>
  );
}
