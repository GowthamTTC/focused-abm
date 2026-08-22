"use client";
/** Live banner numbers: polls the plain-JSON status probe every 2.5s and
 *  updates in place. When the job reaches a terminal state, one clean reload
 *  repaints the whole page with the result. */
import { useEffect, useState } from "react";

type J = { id: string; kind: string; status: string; progress: number | null; total: number | null };

function stageOf(j: J): string {
  if (j.status === "queued") return "Queued";
  if (j.status === "stopping") return "Stopping at the next safe step";
  if (j.kind === "event_extended" || j.kind === "event_scan") {
    const total = j.total ?? 0;
    const prog = j.progress ?? 0;
    if (total <= 0) return "Starting";
    if (prog >= total) return "Finishing";
    return `Scanning ${prog}/${total}`;
  }
  if (j.kind === "classify") return "Classifying";
  if (j.kind === "sync") return "Syncing connections";
  return "Running";
}

export function LiveJob({ initial, label }: { initial: J; label: string }) {
  const [j, setJ] = useState<J>(initial);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/job-status", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as { job: J | null };
        if (stop || !data.job || data.job.id !== initial.id) return;
        setJ(data.job);
        if (!["queued", "running", "stopping"].includes(data.job.status)) {
          stop = true;
          setTimeout(() => window.location.reload(), 500);
        }
      } catch { /* transient — keep polling */ }
    };
    const iv = setInterval(tick, 2500);
    return () => { stop = true; clearInterval(iv); };
  }, [initial.id]);

  const total = j.total ?? 0, prog = j.progress ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((prog / total) * 100)) : 0;
  const terminal = !["queued", "running", "stopping"].includes(j.status);
  return (
    <div className="radar-live flex min-w-0 flex-1 items-center gap-3">
      <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-[#263BAA]" style={{ animation: "radar-pulse 1.4s ease-in-out infinite" }} />
      <span className="tnum min-w-0 text-[12px] text-[#475467]">
        {label}
        {" · "}
        {stageOf(j)}
        <span className="radar-dots" aria-hidden><span /><span /><span /></span>
        {terminal && ` · ${j.status}`}
        {" · "}{prog.toLocaleString()}
        {total > 0 ? ` / ${total.toLocaleString()}` : ""}
      </span>
      <div className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-[#EEF1F8]">
        {total > 0
          ? <div className="radar-bar-glow h-[3px] rounded-full transition-[width] duration-500" style={{ width: `${pct}%` }} />
          : <div className="banner-indeterminate absolute h-[3px] w-1/3 rounded-full bg-[#263BAA]" />}
      </div>
    </div>
  );
}
