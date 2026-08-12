import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, job } from "@/db";
import { currentUser, logout, type Ctx } from "@/auth/session";
import { env } from "@/lib/env";
import { AutoRefresh } from "@/app/auto-refresh";
import { retryJob } from "@/app/job-actions";

async function doLogout() { "use server"; await logout(); redirect("/login"); }

export async function requirePage(): Promise<Ctx> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

const KIND_LABEL: Record<string, string> = {
  classify: "Matching", deep_enrich: "Enriching", sync: "Syncing", import: "Importing",
};

/** App shell with the design's frosted job banner docked under the top bar
 *  (1c/1i): one slim mono line + lime progress, app-wide; failed variant in
 *  salmon with a Retry action. Only the latest job's state shows. */
export async function Shell({ user, active, children }: { user: Ctx; active: string; children: React.ReactNode }) {
  const [latest] = await db.select().from(job)
    .where(eq(job.orgId, user.orgId))
    .orderBy(desc(job.createdAt)).limit(1);
  const running = latest && (latest.status === "running" || latest.status === "queued") ? latest : undefined;
  const failed = !running && latest && latest.status === "failed" ? latest : undefined;
  const pct = running && running.total ? Math.min(100, Math.round(((running.progress ?? 0) / running.total) * 100)) : 0;

  const tabs: [string, string][] = [
    ["dashboard", "Dashboard"],
    ["connections", "Data"],
    ["services", "Services"],
    ["settings", "Settings"],
  ];
  if (user.email.toLowerCase() === (env.ADMIN_EMAIL ?? "").toLowerCase()) tabs.push(["admin", "Admin"]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {running && <AutoRefresh />}
      <header className="shrink-0 border-b border-white/10 bg-[#1F2329]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <span className="text-sm font-semibold tracking-tight text-[#B6FF2E]" style={{ fontFamily: "var(--font-display)" }}>
              Focused ABM
            </span>
            <nav className="flex gap-5 text-sm">
              {tabs.map(([slug, label]) => (
                <Link key={slug} href={`/${slug}`}
                  className={`-mb-3 border-b-2 pb-3 ${active === slug
                    ? "border-[#B6FF2E] font-medium text-[#E8EAF0]"
                    : "border-transparent text-white/55 hover:text-[#E8EAF0]"}`}>
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <form action={doLogout}>
            <button className="text-xs text-white/55 hover:text-[#E8EAF0]">{user.email} · sign out</button>
          </form>
        </div>
      </header>

      {running && (
        <div className="shrink-0 border-b border-white/5 bg-black/30 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-2">
            <span className="tnum whitespace-nowrap text-white/80">
              {KIND_LABEL[running.kind] ?? running.kind} · {(running.progress ?? 0).toLocaleString()}
              {(running.total ?? 0) > 0 ? ` / ${(running.total ?? 0).toLocaleString()}` : " pulled"}
            </span>
            <div className="relative h-0.5 flex-1 overflow-hidden rounded bg-white/10">
              {(running.total ?? 0) > 0
                ? <div className="h-0.5 rounded bg-[#B6FF2E] shadow-[0_0_8px_rgba(182,255,46,.7)]" style={{ width: `${pct}%` }} />
                : <div className="banner-indeterminate absolute h-0.5 w-1/3 rounded bg-[#B6FF2E] shadow-[0_0_8px_rgba(182,255,46,.7)]" />}
            </div>
          </div>
        </div>
      )}
      {failed && (
        <div className="shrink-0 border-b border-red-500/20 bg-red-500/10 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-2">
            <span className="tnum flex-1 truncate text-red-300">
              {KIND_LABEL[failed.kind] ?? failed.kind} failed — {failed.error}
            </span>
            <form action={retryJob.bind(null, failed.id)}>
              <button className="rounded-lg border border-red-400/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/15">
                Retry
              </button>
            </form>
          </div>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
