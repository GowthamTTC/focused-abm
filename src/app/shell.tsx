import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, job } from "@/db";
import { currentUser, logout, type Ctx } from "@/auth/session";
import { env } from "@/lib/env";
import { requestStop } from "@/app/jobs/actions";

export async function requirePage(): Promise<Ctx> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

const KIND_LABEL: Record<string, string> = {
  classify: "Matching", deep_enrich: "Enriching", sync: "Syncing",
  import: "Importing", activity_scan: "Scanning posts",
};

const NAV: { section: string; items: [key: string, href: string, label: string][] }[] = [
  { section: "Overview", items: [
    ["dashboard", "/dashboard", "Dashboard"],
    ["insights", "/insights", "Network Insights"],
    ["engagement", "/engagement", "Engagement"],
    ["alerts", "/alerts", "Alerts"],
  ]},
  { section: "Pipeline", items: [
    ["connections", "/connections", "Data & Batches"],
    ["top", "/top-connections", "Top Connections"],
    ["health", "/relationship-health", "Relationship Health"],
    ["services", "/services", "Services"],
  ]},
  { section: "System", items: [
    ["exports", "/exports", "Exports"],
    ["settings", "/settings", "Settings"],
  ]},
];

export async function Shell({ user, active, children }: {
  user: Ctx; active: string; children: React.ReactNode;
}) {
  const isAdmin = user.email.toLowerCase() === (env.ADMIN_EMAIL ?? "").toLowerCase();
  const jobs = await db.select().from(job).where(eq(job.orgId, user.orgId))
    .orderBy(desc(job.createdAt)).limit(1);
  const latest = jobs[0];
  const running = latest && (latest.status === "running" || latest.status === "queued" || latest.status === "stopping") ? latest : null;
  const failed = latest && latest.status === "failed" ? latest : null;
  const pct = running && (running.total ?? 0) > 0
    ? Math.min(100, Math.round(((running.progress ?? 0) / running.total) * 100)) : 0;

  return (
    <div className="flex min-h-screen bg-[#FFF4D6] text-[#1B2559]">
      {/* ── Sidebar ── */}
      <aside className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-[#263BAA]/12 bg-white">
        <div className="px-5 pb-4 pt-6">
          <p className="text-lg font-semibold text-[#263BAA]">Focused ABM</p>
          <p className="text-xs text-[#2B3355]/50">Warm-network intelligence</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {NAV.map((group) => (
            <div key={group.section} className="mt-4 first:mt-0">
              <p className="px-2 text-[10px] font-semibold uppercase tracking-widest text-[#2B3355]/40">{group.section}</p>
              <div className="mt-1.5 space-y-0.5">
                {group.items.map(([key, href, label]) => (
                  <Link key={key} href={href}
                    className={`block rounded-lg px-3 py-2 text-sm ${active === key
                      ? "bg-[#263BAA]/10 font-medium text-[#263BAA]"
                      : "text-[#2B3355]/70 hover:bg-[#263BAA]/5 hover:text-[#1B2559]"}`}>
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
          {isAdmin && (
            <div className="mt-4">
              <p className="px-2 text-[10px] font-semibold uppercase tracking-widest text-[#2B3355]/40">Admin</p>
              <Link href="/admin"
                className={`mt-1.5 block rounded-lg px-3 py-2 text-sm ${active === "admin"
                  ? "bg-[#263BAA]/10 font-medium text-[#263BAA]" : "text-[#2B3355]/70 hover:bg-[#263BAA]/5"}`}>
                Console
              </Link>
            </div>
          )}
        </nav>
        <div className="border-t border-[#263BAA]/12 p-4 text-sm">
          <p className="truncate font-medium">{user.name}</p>
          <p className="truncate text-xs text-[#2B3355]/50">{user.email}</p>
          <form action={signOut} className="mt-2">
            <button className="text-xs text-[#263BAA] underline decoration-[#263BAA]/40">sign out</button>
          </form>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="ml-60 min-w-0 flex-1">
        {running && (
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[#263BAA]/15 bg-[#EEF0FB] px-6 py-2 text-sm">
            <span className="tnum whitespace-nowrap text-[#1B2559]/80">
              {KIND_LABEL[running.kind] ?? running.kind}
              {running.status === "stopping" && " · stopping…"}
              {" · "}{(running.progress ?? 0).toLocaleString()}
              {(running.total ?? 0) > 0 ? ` / ${(running.total ?? 0).toLocaleString()}` : " pulled"}
            </span>
            <div className="relative h-1 flex-1 overflow-hidden rounded bg-[#263BAA]/15">
              {(running.total ?? 0) > 0
                ? <div className="h-1 rounded bg-[#263BAA]" style={{ width: `${pct}%` }} />
                : <div className="banner-indeterminate absolute h-1 w-1/3 rounded bg-[#263BAA]" />}
            </div>
            {(running.kind === "deep_enrich" || running.kind === "sync" || running.kind === "activity_scan") && running.status !== "stopping" && (
              <form action={requestStop.bind(null, running.id)}>
                <button className="rounded border border-[#263BAA]/25 px-2 py-0.5 text-[11px] text-[#2B3355]/70 hover:border-red-500/50 hover:text-red-600"
                  title="Stops at the next safe point — completed people keep their results.">
                  Stop
                </button>
              </form>
            )}
          </div>
        )}
        {failed && (
          <div className="flex items-center gap-3 border-b border-red-500/25 bg-red-500/5 px-6 py-2 text-sm text-red-600">
            <span className="truncate">{KIND_LABEL[failed.kind] ?? failed.kind} failed — {failed.error}</span>
          </div>
        )}
        <main className="mx-auto max-w-[1200px] px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
