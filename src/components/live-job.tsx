"use client";
/** Live banner numbers: polls the plain-JSON status probe every 2.5s and
 *  updates in place. When the job reaches a terminal state, one clean reload
 *  repaints the whole page with the result. */
import { useEffect, useState } from "react";

type J = { id: string; kind: string; status: string; progress: number | null; total: number | null };

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
    <>
      <span className="tnum text-[12px] text-[#475467]">
        {label}
        {j.status === "stopping" && " · stopping — finishing the current step"}
        {terminal && ` · ${j.status}`}
        {" · "}{prog.toLocaleString()}
        {total > 0 ? ` / ${total.toLocaleString()}` : " pulled"}
      </span>
      <div className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-[#EEF1F8]">
        {total > 0
          ? <div className="h-[3px] rounded-full bg-[#263BAA] transition-[width] duration-500" style={{ width: `${pct}%` }} />
          : <div className="banner-indeterminate absolute h-[3px] w-1/3 rounded-full bg-[#263BAA]" />}
      </div>
    </>
  );
}
