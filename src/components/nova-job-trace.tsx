"use client";

import { useEffect, useRef, useState } from "react";
import { ProgressBar } from "@/components/progress-bar";

type Live = {
  id: string;
  kind: string;
  status: string;
  progress: number | null;
  total: number | null;
  current?: string | null;
};

const KIND: Record<string, string> = {
  deep_enrich: "Research",
  classify: "Classify",
  sync: "Sync",
  event_extended: "Radar",
  event_scan: "Radar",
};

type PersonCard = {
  title: string; subtitle: string; icp?: string; why?: string;
  pills: string[]; about: string; pain: string; draft?: string;
};

export function NovaJobTrace({
  active,
  onLive,
  showDone = true,
}: {
  active: boolean;
  onLive?: (live: boolean) => void;
  showDone?: boolean;
}) {
  const [job, setJob] = useState<Live | null>(null);
  const [results, setResults] = useState<PersonCard[]>([]);
  const log = useRef<string[]>([]);
  const fetched = useRef(false);
  const seenLive = useRef(false);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!active) return;
    let stop = false;
    let es: EventSource | null = null;
    const apply = (next: Live | null) => {
      if (stop || !next) return;
      setJob(next);
      const liveNow = ["queued", "running", "stopping"].includes(next.status);
      if (liveNow) seenLive.current = true;
      onLive?.(liveNow);
      const line = next.current
        || `${KIND[next.kind] ?? next.kind} ${next.status} ${next.progress ?? 0}/${next.total ?? 0}`;
      const last = log.current[log.current.length - 1];
      if (line && line !== last) {
        log.current = [...log.current.slice(-8), line];
        bump((n) => n + 1);
      }
      if (next.status === "done" && !fetched.current) {
        fetched.current = true;
        void (async () => {
          const r = await fetch("/api/agent/enriched-latest", { cache: "no-store" });
          const data = await r.json().catch(() => null) as { people?: typeof results } | null;
          if (data?.people) setResults(data.people);
        })();
      }
    };
    try {
      es = new EventSource("/api/jobs/live");
      es.onmessage = (ev) => {
        try { apply((JSON.parse(ev.data) as { job: Live | null }).job); } catch { /* ignore */ }
      };
    } catch { /* ignore */ }
    const poll = setInterval(async () => {
      try {
        const r = await fetch("/api/job-status", { cache: "no-store" });
        const data = await r.json() as { job: Live | null };
        apply(data.job);
      } catch { /* ignore */ }
    }, 2000);
    return () => { stop = true; es?.close(); clearInterval(poll); };
  }, [active]);

  if (!active || !job || !["queued", "running", "stopping"].includes(job.status)) {
    if (active && showDone && seenLive.current && job && job.status === "done") {
      return (
        <div className="mt-2 space-y-2">
          <div className="rounded-[10px] border border-[#D1FADF] bg-[#F6FEF9] p-3 text-[12.5px] text-[#067647]">
            Research finished · {job.progress ?? 0}/{job.total ?? 0} — results in this chat
          </div>
          <div className="flex flex-col gap-2">
            {results.map((p) => (
              <div key={p.title} className="rounded-[12px] border border-[#DDE2EE] bg-white px-3 py-2.5 text-left">
                <p className="text-[13.5px] font-medium text-[#101828]">{p.title}</p>
                <p className="text-[12px] text-[#667085]">{p.subtitle}</p>
                <p className="mt-1 text-[11px] text-[#263BAA]">{[p.icp, ...p.pills].filter(Boolean).join(" · ")}</p>
                {p.why ? <p className="mt-1.5 text-[12.5px] text-[#344054]"><span className="font-medium">ICP: </span>{p.why}</p> : null}
                {p.about ? <p className="mt-1 text-[12.5px] leading-5 text-[#344054]">{p.about}</p> : null}
                {p.pain ? <p className="mt-1 text-[12.5px] text-[#B54708]"><span className="font-medium">Pain: </span>{p.pain}</p> : null}
                {p.draft ? <p className="mt-1.5 rounded-md bg-[#F4F6FB] px-2 py-1.5 text-[12px] leading-5 text-[#101828]">{p.draft}</p> : null}
              </div>
            ))}
            {results.length > 0 && (
              <p className="text-[12.5px] text-[#101828]"><span className="font-medium">Recommendation: </span>
                {results.some((x) => x.draft) ? "Open the draft-ready cards above and send the strongest ICP fit first." : "These profiles are in. Ask Nova who to send first."}
              </p>
            )}
          </div>
        </div>
      );
    }
    if (!active || !job) return null;
  }

  const live = ["queued", "running", "stopping"].includes(job.status);
  if (!live && job.status !== "done") return null;
  if (!live) return null;

  const pct = job.total ? Math.round(((job.progress ?? 0) / job.total) * 100) : 0;

  return (
    <div className="mt-2 rounded-[10px] border border-[#DDE2EE] bg-white p-3 text-[12.5px] text-[#101828]">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-2 w-2 rounded-full bg-[#263BAA]" style={{ animation: "radar-pulse 1.1s ease-in-out infinite" }} />
        <span className="font-medium">{KIND[job.kind] ?? job.kind}</span>
        <span className="tnum ml-auto text-[#667085]">{job.progress ?? 0}/{job.total ?? 0} · {pct}%</span>
      </div>
      <div className="mt-2"><ProgressBar value={job.progress ?? 0} max={job.total ?? 0} size="sm" /></div>
      <p className="mt-2 text-[12px] text-[#475467]">{job.current ?? "Worker picked up the job…"}</p>
      <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto font-mono text-[11px] text-[#667085]">
        {log.current.map((line, i) => <li key={`${i}-${line}`}>{line}</li>)}
      </ul>
    </div>
  );
}
