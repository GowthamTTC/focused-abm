import Link from "next/link";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db, connection, job } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { StatCard } from "@/components/charts";

type Alert = { at: Date; sev: "high" | "med" | "low"; title: string; body: string; href?: string };

export default async function AlertsPage(props: { searchParams: Promise<{ f?: string }> }) {
  const user = await requirePage();
  const { f = "all" } = await props.searchParams;

  const [flags, newActivity, failedRows, recentJobs] = await Promise.all([
    db.select().from(connection)
      .where(and(eq(connection.orgId, user.orgId), isNotNull(connection.flag), sql`flag_verdict is null`))
      .orderBy(desc(connection.enrichedAt)).limit(30),
    db.select().from(connection)
      .where(and(eq(connection.orgId, user.orgId), sql`last_post_at > enriched_at`, sql`sent_at is null`, eq(connection.enrichStatus, "done")))
      .orderBy(desc(connection.lastPostAt)).limit(15),
    db.select().from(connection)
      .where(and(eq(connection.orgId, user.orgId), eq(connection.enrichStatus, "failed"))).limit(10),
    db.select().from(job).where(eq(job.orgId, user.orgId)).orderBy(desc(job.updatedAt)).limit(12),
  ]);

  const jobChange = (t: string | null) => /left|no longer|moved|changed|former|different company/i.test(t ?? "");
  const alerts: Alert[] = [
    ...flags.map((p): Alert => ({
      at: p.enrichedAt ?? new Date(0),
      sev: jobChange(p.flag) ? "high" : "med",
      title: jobChange(p.flag) ? "Job change detected" : "Flag needs a decision",
      body: `${p.firstName} ${p.lastName} — ${p.flag}`,
      href: `/review?tab=decisions`,
    })),
    ...newActivity.map((p): Alert => ({
      at: p.lastPostAt!, sev: "med", title: "New activity since draft",
      body: `${p.firstName} ${p.lastName} posted after their message was written — re-run before sending.`,
      href: p.batchId ? `/batches/${p.batchId}?view=enriched&p=${p.id}` : undefined,
    })),
    ...failedRows.map((p): Alert => ({
      at: p.enrichedAt ?? new Date(0), sev: "high", title: "Research failed",
      body: `${p.firstName} ${p.lastName} — ${p.enrichError?.slice(0, 80) ?? "unknown error"}`,
      href: "/review?tab=decisions",
    })),
    ...recentJobs.filter((j) => j.status === "failed" || j.status === "stopped").map((j): Alert => ({
      at: j.updatedAt, sev: j.status === "failed" ? "high" : "low",
      title: j.status === "failed" ? "Run failed" : "Run stopped",
      body: `${j.kind} · ${j.progress}/${j.total}${j.error ? ` — ${j.error.slice(0, 80)}` : ""}`,
    })),
    ...recentJobs.filter((j) => j.kind === "sync" && j.status === "done").slice(0, 3).map((j): Alert => ({
      at: j.updatedAt, sev: "low", title: "Sync completed",
      body: `${(j.total ?? 0).toLocaleString()} connections pulled.`, href: "/sources",
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const shown = alerts.filter((a) => f === "all" || a.sev === f);
  const count = (sev: string) => alerts.filter((a) => a.sev === sev).length;
  const SEV_STYLE = { high: "border-[#FDA29B] text-[#B42318]", med: "border-[#B54708]/40 text-[#B54708]", low: "border-[#DDE2EE] text-[#263BAA]" };

  return (
    <Shell user={user} active="alerts">
      <h1 className="text-2xl font-semibold">Alerts</h1>
      <p className="mt-1 text-sm text-[#98A2B3]">
        Real events from your own pipeline — flags, job changes, fresh activity, failures. We never invent
        "profile viewed you" style alerts: LinkedIn does not expose that data to any tool.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="High priority" value={String(count("high"))} sub="job changes · failures" />
        <StatCard label="Medium" value={String(count("med"))} sub="flags · new activity" />
        <StatCard label="Low" value={String(count("low"))} sub="run history" />
      </div>

      <div className="mt-6 flex gap-1 rounded-[8px] bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-1 text-sm w-fit">
        {(["all", "high", "med", "low"] as const).map((v) => (
          <Link key={v} href={`/alerts?f=${v}`}
            className={`rounded-md px-3 py-1.5 capitalize ${f === v ? "bg-[#EEF1FC] font-medium text-[#263BAA]" : "text-[#98A2B3]"}`}>
            {v === "med" ? "Medium" : v}
          </Link>
        ))}
      </div>

      <div className="pane-scroll mt-4 max-h-[54vh] space-y-3 pr-1">
        {shown.map((a, i) => (
          <div key={i} className="flex items-start gap-4 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4">
            <span className={`mt-0.5 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${SEV_STYLE[a.sev]}`}>{a.sev}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{a.title}</p>
              <p className="mt-0.5 text-sm text-[#475467]">{a.body}</p>
            </div>
            <span className="tnum shrink-0 text-xs text-[#98A2B3]">{a.at.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
            {a.href && <Link href={a.href} className="shrink-0 text-xs text-[#263BAA] underline">open</Link>}
          </div>
        ))}
        {shown.length === 0 && (
          <div className="rounded-[14px] border border-dashed border-[#DDE2EE] p-10 text-center text-sm text-[#98A2B3]">
            Nothing here — a quiet inbox is a healthy pipeline.
          </div>
        )}
      </div>
    </Shell>
  );
}
