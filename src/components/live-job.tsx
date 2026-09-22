"use client";

import { useEffect } from "react";
import { JobProgress } from "@/components/progress-bar";
import { useJobStream, type LiveJobState } from "@/components/use-job-stream";

function stageOf(j: LiveJobState): string {
  if (j.status === "queued") return "Queued";
  if (j.status === "stopping") return "Stopping at the next safe step";
  if (j.kind === "event_extended" || j.kind === "event_scan") {
    const total = j.total ?? 0;
    const prog = j.progress ?? 0;
    if (total <= 0) return "Starting";
    if (prog >= total) return "Finishing";
    return `Scanning ${prog}/${total}`;
  }
  if (j.kind === "activity_scan") return (j.total ?? 0) > 0 ? `Scanning ${j.progress}/${j.total} people` : "Starting";
  if (j.kind === "post_judge") return (j.total ?? 0) > 0 ? `Reading ${j.progress}/${j.total} posts` : "Starting";
  if (j.kind === "classify") return "Classifying";
  if (j.kind === "sync") return "Syncing connections";
  if (j.kind === "deep_enrich") return "Researching";
  // Four coarse steps rather than a count of anything: a Pulse refresh fetches,
  // stores, judges and then derives, and the only number a reader could act on
  // is which of those it is stuck on.
  if (j.kind === "account_pulse") {
    const step = ["Starting", "Fetching news", "Reading what was found", "Working out the triggers", "Finishing"];
    return step[Math.min(j.progress ?? 0, 4)] ?? "Running";
  }
  return "Running";
}

export function LiveJob({ initial, label }: { initial: LiveJobState; label: string }) {
  const j = useJobStream(initial) ?? initial;

  useEffect(() => {
    if (["queued", "running", "stopping"].includes(j.status)) return;
    const t = setTimeout(() => window.location.reload(), 600);
    return () => clearTimeout(t);
  }, [j.status]);

  return (
    <JobProgress
      label={label}
      stage={stageOf(j)}
      value={j.progress ?? 0}
      max={j.total ?? 0}
      status={j.status}
    />
  );
}
