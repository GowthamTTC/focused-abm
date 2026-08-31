"use client";

import { useEffect, useRef, useState } from "react";
import { ProgressBar } from "@/components/progress-bar";

export const NOVA_QUERIES = [
  "What should I do next?",
  "How many VPs — which account has most?",
  "Workspace snapshot",
  "Who still needs research on the shortlist?",
  "Enrich all remaining on the shortlist",
  "Who has a ready draft?",
  "Scan SaaStr last 7 days in the US",
];

type Msg = {
  role: "user" | "assistant";
  content: string;
  open?: string;
  tookMs?: number;
  estimateSec?: number;
  tools?: string[];
};

function estimateSec(message: string): { sec: number; label: string; job: boolean } {
  const m = message.toLowerCase();
  if (/\b(enrich|research|scan|radar|saasstr)\b/.test(m)) {
    return { sec: 14, label: "About 10–20s for the reply. Jobs may keep running ~1 min.", job: true };
  }
  if (/\b(recommend|priorit|what should|next|who to)\b/.test(m)) {
    return { sec: 12, label: "About 8–15s — ranking your workspace.", job: false };
  }
  if (/\b(how many|vp|title|count|snapshot)\b/.test(m)) {
    return { sec: 8, label: "About 5–10s — counting matches.", job: false };
  }
  return { sec: 7, label: "About 4–10s.", job: false };
}

function fmtSec(ms: number) {
  const s = Math.max(0.1, ms / 1000);
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

export function NovaMark({ large = false }: { large?: boolean }) {
  return (
    <div className={`nova-stage flex flex-col items-center ${large ? "gap-4" : "gap-1.5"}`}>
      <div className={`nova-orb ${large ? "h-[88px] w-[88px]" : "h-10 w-10"}`}>
        <span className="nova-orb-ring" />
        <span className="nova-orb-ring delay" />
        {large && <span className="nova-orb-spark" />}
        <span className={`nova-orb-core ${large ? "h-16 w-16 text-2xl" : "h-8 w-8 text-sm"}`}>✦</span>
      </div>
      <p className={`font-semibold tracking-[-.03em] text-[#101828] ${large ? "text-[40px] leading-none" : "text-sm"}`}>Nova</p>
      {large && (
        <p className="max-w-md text-center text-[15px] leading-6 text-[#475467]">
          Ask anything about this workspace. Counts, shortlist, enrich, Radar, drafts.
        </p>
      )}
    </div>
  );
}

export function NovaThread({
  page,
  compact = false,
}: {
  page: string;
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<{ sec: number; label: string; job: boolean } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const started = msgs.length > 0;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy, elapsed]);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 200);
    return () => clearInterval(id);
  }, [busy]);

  async function send(raw?: string) {
    const message = (raw ?? text).trim();
    if (!message || busy) return;
    setText("");
    const est = estimateSec(message);
    setHint(est);
    setElapsed(0);
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: message, estimateSec: est.sec }]);
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, page, history }),
      });
      const data = await res.json().catch(() => null) as {
        reply?: string; open?: string; error?: string; tookMs?: number; tools?: string[];
      } | null;
      if (!res.ok && data?.error === "rate") {
        setMsgs((m) => [...m, { role: "assistant", content: "Slow down a moment — too many asks." }]);
      } else {
        setMsgs((m) => [...m, {
          role: "assistant",
          content: data?.reply ?? "No reply.",
          open: data?.open,
          tookMs: data?.tookMs,
          estimateSec: est.sec,
          tools: data?.tools,
        }]);
      }
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Network error. Try again." }]);
    } finally {
      setBusy(false);
      setHint(null);
    }
  }

  const pct = hint ? Math.min(92, (elapsed / 1000 / hint.sec) * 100) : 0;

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${compact ? "" : ""}`}>
      <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto ${compact ? "px-4 py-3" : "px-1 py-2"} text-[13px] leading-5`}>
        {!started && (
          <div className={`ui-fade-in ${compact ? "py-4" : "py-10"} flex flex-col items-center`}>
            <NovaMark large={!compact} />
            <div className={`mt-8 flex flex-wrap justify-center gap-2 ${compact ? "" : "max-w-xl"}`}>
              {NOVA_QUERIES.map((q, i) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(q)}
                  className="nova-chip btn-press rounded-full border border-[#DDE2EE] bg-white/90 px-3.5 py-2 text-left text-[12.5px] text-[#475467] shadow-[0_1px_2px_rgba(16,24,40,.04)] hover:border-[#263BAA] hover:text-[#263BAA] hover:shadow-[0_6px_16px_rgba(38,59,170,.12)]"
                  style={{ animationDelay: `${80 + i * 55}ms` }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`nova-msg ${m.role === "user" ? "text-right" : ""}`}>
            <div className={`inline-block max-w-[95%] rounded-[10px] px-3 py-2 whitespace-pre-wrap text-left ${
              m.role === "user" ? "bg-[#263BAA] text-white" : "bg-[#F4F6FB] text-[#101828]"
            }`}>
              {m.content}
            </div>
            {m.role === "assistant" && m.tookMs != null && (
              <p className="mt-1 text-[11px] text-[#98A2B3]">
                Took {fmtSec(m.tookMs)}
                {m.estimateSec ? ` · estimate ${m.estimateSec}s` : ""}
                {m.tools?.length ? ` · ${m.tools.join(", ")}` : ""}
              </p>
            )}
            {m.open && (
              <p className="mt-1">
                <a href={m.open} className="text-[12px] text-[#263BAA] underline">Open in app</a>
              </p>
            )}
          </div>
        ))}
        {busy && hint && (
          <div className="enrich-wait rounded-[10px] border border-[#E7CE96] bg-[#FEFBF3] p-3 text-[12.5px] text-[#B54708]">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-[#B54708]" style={{ animation: "radar-pulse 1.1s ease-in-out infinite" }} />
              <span className="font-medium radar-banner-text">Nova is thinking</span>
              <span className="radar-dots" aria-hidden><span /><span /><span /></span>
              <span className="tnum ml-auto text-[#475467]">{fmtSec(elapsed)}</span>
            </div>
            <p className="mt-1.5 text-[#475467]">{hint.label}</p>
            <div className="mt-2"><ProgressBar value={pct} max={100} size="sm" tone="warm" /></div>
            <p className="mt-1 text-[11px] text-[#98A2B3]">
              Estimate ~{hint.sec}s{hint.job ? " · jobs keep running after" : ""}.
            </p>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form
        className={`flex gap-2 ${compact ? "border-t border-[#EEF1F8] p-3" : "mt-4"}`}
        onSubmit={(e) => { e.preventDefault(); void send(); }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask Nova…"
          className="min-w-0 flex-1 rounded-[10px] border border-[#DDE2EE] px-3 py-2.5 text-[13px]"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="btn-press rounded-[10px] bg-[#263BAA] px-4 py-2.5 text-[13px] font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export function AgentRail({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="pointer-events-auto flex h-[min(560px,74vh)] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[14px] border border-[#DDE2EE] bg-white shadow-[0_12px_40px_rgba(16,24,40,.12)] ui-fade-in">
          <div className="flex items-center justify-between border-b border-[#EEF1F8] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="nova-orb-core h-7 w-7 text-[11px]">✦</span>
              <div>
                <p className="text-[13px] font-semibold text-[#101828]">Nova</p>
                <p className="text-[11px] text-[#98A2B3] capitalize">{page} · this workspace</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-[#98A2B3] hover:text-[#101828]">✕</button>
          </div>
          <NovaThread page={page} compact />
        </div>
      )}
      <button
        type="button"
        className="pointer-events-auto rounded-full bg-[#263BAA] px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_8px_24px_rgba(38,59,170,.35)] hover:bg-[#1D2E86]"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Close Nova" : "Nova"}
      </button>
    </div>
  );
}
