"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ProgressBar } from "@/components/progress-bar";
import { NOVA_SAYS, nextSaying } from "@/components/nova-says";

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
  tools?: string[];
  suggestions?: string[];
};

const LEARN_KEY = "nova-learn-v1";
type Learn = { topics: Record<string, number>; last: string[] };

function loadLearn(): Learn {
  try {
    const raw = localStorage.getItem(LEARN_KEY);
    if (raw) return JSON.parse(raw) as Learn;
  } catch { /* ignore */ }
  return { topics: {}, last: [] };
}

function remember(message: string) {
  const L = loadLearn();
  const m = message.toLowerCase();
  const bump = (k: string) => { L.topics[k] = (L.topics[k] ?? 0) + 1; };
  if (/vp|director|title|head|cxo/.test(m)) bump("title");
  if (/account|company|shortlist|capital/.test(m)) bump("account");
  if (/enrich|research/.test(m)) bump("enrich");
  if (/radar|scan|event/.test(m)) bump("radar");
  if (/draft|send|review/.test(m)) bump("review");
  L.last = [...L.last.filter((x) => x !== message), message].slice(-12);
  try { localStorage.setItem(LEARN_KEY, JSON.stringify(L)); } catch { /* ignore */ }
}

function adaptSuggestions(base: string[]): string[] {
  const L = loadLearn();
  const top = Object.entries(L.topics).sort((a, b) => b[1] - a[1])[0]?.[0];
  const extra =
    top === "title" ? "How many directors — which account has most?" :
    top === "enrich" ? "Who still needs research on the shortlist?" :
    top === "radar" ? "Scan another US event last 7 days" :
    top === "review" ? "Who has a ready draft?" :
    top === "account" ? "What should I do next on accounts?" :
    null;
  const out = [...base];
  if (extra && !out.includes(extra)) out.splice(Math.min(1, out.length), 0, extra);
  return out.slice(0, 3);
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
  const [saying, setSaying] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const started = msgs.length > 0;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  useEffect(() => {
    if (!busy) return;
    setSaying(nextSaying());
    setElapsed(0);
    const t0 = Date.now();
    let sayTimer: ReturnType<typeof setInterval> | null = null;
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    const armSay = () => {
      sayTimer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        setSaying(nextSaying());
      }, 5000);
    };
    armSay();
    const onVis = () => {
      if (document.hidden) {
        if (sayTimer) clearInterval(sayTimer);
        sayTimer = null;
      } else if (!sayTimer) armSay();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(tick);
      if (sayTimer) clearInterval(sayTimer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [busy]);

  async function send(raw?: string) {
    const message = (raw ?? text).trim();
    if (!message || busy) return;
    setText("");
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, page, history }),
      });
      remember(message);
      const data = await res.json().catch(() => null) as {
        reply?: string; open?: string; error?: string; tookMs?: number; tools?: string[]; suggestions?: string[];
      } | null;
      if (!res.ok && data?.error === "rate") {
        setMsgs((m) => [...m, { role: "assistant", content: "Slow down a moment — too many asks." }]);
      } else {
        setMsgs((m) => [...m, {
          role: "assistant",
          content: data?.reply ?? "No reply.",
          open: data?.open,
          tookMs: data?.tookMs,
          tools: data?.tools,
          suggestions: adaptSuggestions(data?.suggestions ?? []),
        }]);
      }
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Network error. Try again." }]);
    } finally {
      setBusy(false);
    }
  }

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
                {m.tools?.length ? m.tools.join(", ") : ""}
              </p>
            )}
            {m.open && (
              <p className="mt-1">
                <a href={m.open} className="text-[12px] text-[#263BAA] underline">Open in app</a>
              </p>
            )}
          </div>
        ))}
        {msgs.map((m, i) => m.role === "assistant" && m.suggestions?.length && i === msgs.length - 1 && !busy ? (
          <div key={`s-${i}`} className="flex flex-wrap gap-1.5">
            {m.suggestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void send(q)}
                className="nova-chip rounded-full border border-[#DDE2EE] bg-white px-2.5 py-1 text-[11.5px] text-[#263BAA] hover:bg-[#EEF1FC]"
              >
                {q}
              </button>
            ))}
          </div>
        ) : null)}
        {busy && (
          <div className="enrich-wait rounded-[10px] border border-[#E7CE96] bg-[#FEFBF3] p-3 text-[12.5px] text-[#B54708]">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-[#B54708]" style={{ animation: "radar-pulse 1.1s ease-in-out infinite" }} />
              <span className="font-medium">Nova is thinking</span>
              <span className="radar-dots" aria-hidden><span /><span /><span /></span>
              <span className="tnum ml-auto text-[12px] text-[#98A2B3]">{elapsed}s</span>
            </div>
            <p key={saying} className="nova-msg mt-2 text-[13px] leading-5 text-[#475467]">
              {NOVA_SAYS[saying]}
            </p>
            <div className="mt-2"><ProgressBar indeterminate size="sm" tone="warm" /></div>
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
  const [corner, setCorner] = useState<"tl" | "tr" | "bl" | "br">("br");
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    try {
      const c = localStorage.getItem("nova-corner");
      if (c === "tl" || c === "tr" || c === "bl" || c === "br") setCorner(c);
    } catch { /* ignore */ }
  }, []);

  function snap(x: number, y: number) {
    const left = x < window.innerWidth / 2;
    const top = y < window.innerHeight / 2;
    const next = (top ? "t" : "b") + (left ? "l" : "r") as "tl" | "tr" | "bl" | "br";
    setCorner(next);
    try { localStorage.setItem("nova-corner", next); } catch { /* ignore */ }
  }

  const box: CSSProperties =
    drag ? { left: drag.x, top: drag.y, right: "auto", bottom: "auto" }
    : corner === "tl" ? { top: 20, left: 20 }
    : corner === "tr" ? { top: 20, right: 20 }
    : corner === "bl" ? { bottom: 20, left: 20 }
    : { bottom: 20, right: 20 };

  const panelAlign =
    corner.startsWith("l") || (drag && drag.x < (typeof window !== "undefined" ? window.innerWidth / 2 : 0))
      ? "items-start"
      : "items-end";

  return (
    <div className={`pointer-events-none fixed z-40 flex flex-col gap-2 ${panelAlign}`} style={box}>
      {open && (
        <div className="pointer-events-auto flex h-[min(560px,74vh)] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[14px] border border-[#DDE2EE] bg-white shadow-[0_12px_40px_rgba(16,24,40,.12)] ui-fade-in">
          <div className="flex items-center justify-between border-b border-[#EEF1F8] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="nova-orb-core h-7 w-7 text-[11px]">✦</span>
              <div>
                <p className="text-[13px] font-semibold text-[#101828]">Nova</p>
                <p className="text-[11px] text-[#98A2B3] capitalize">{page} · drag the bubble to a corner</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-[#98A2B3] hover:text-[#101828]">✕</button>
          </div>
          <NovaThread page={page} compact />
        </div>
      )}
      <button
        type="button"
        className="pointer-events-auto cursor-grab rounded-full bg-[#263BAA] px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_8px_24px_rgba(38,59,170,.35)] hover:bg-[#1D2E86] active:cursor-grabbing"
        onPointerDown={(e) => {
          moved.current = false;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setDrag({ x: e.clientX - 50, y: e.clientY - 18 });
        }}
        onPointerMove={(e) => {
          if (drag == null && !(e.buttons & 1)) return;
          if (e.buttons & 1) {
            moved.current = true;
            setDrag({ x: e.clientX - 50, y: e.clientY - 18 });
          }
        }}
        onPointerUp={(e) => {
          const wasDrag = moved.current;
          setDrag(null);
          snap(e.clientX, e.clientY);
          if (!wasDrag) setOpen((v) => !v);
        }}
      >
        {open ? "Close Nova" : "Ask Nova"}
      </button>
    </div>
  );
}
