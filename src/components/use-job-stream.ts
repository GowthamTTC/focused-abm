"use client";

import { useEffect, useState } from "react";

export type LiveJobState = {
  id: string;
  kind: string;
  status: string;
  progress: number | null;
  total: number | null;
};

/**
 * Live job updates.
 * Prefers Server-Sent Events (/api/jobs/live). Falls back to 2s polling
 * of /api/job-status if EventSource fails (proxies that buffer SSE).
 * Raw WebSockets are not used: Next.js App Router on Railway has no
 * stable upgrade path without a second process.
 */
export function useJobStream(initial: LiveJobState | null) {
  const [job, setJob] = useState<LiveJobState | null>(initial);

  useEffect(() => {
    if (!initial) return;
    let stop = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let es: EventSource | null = null;

    const apply = (next: LiveJobState | null) => {
      if (stop || !next || next.id !== initial.id) return;
      setJob(next);
    };

    const startPoll = () => {
      if (poll) return;
      poll = setInterval(async () => {
        try {
          const r = await fetch("/api/job-status", { cache: "no-store" });
          if (!r.ok) return;
          const data = (await r.json()) as { job: LiveJobState | null };
          apply(data.job);
        } catch { /* keep going */ }
      }, 2000);
    };

    try {
      es = new EventSource("/api/jobs/live");
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { job: LiveJobState | null };
          apply(data.job);
        } catch { /* ignore */ }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        startPoll();
      };
    } catch {
      startPoll();
    }

    return () => {
      stop = true;
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [initial?.id]);

  return job;
}
