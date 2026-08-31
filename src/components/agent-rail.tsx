"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string; open?: string };

export function AgentRail({ page }: { page: "accounts" | "radar" | "review" }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{
    role: "assistant",
    content: page === "radar"
      ? "Radar desk. Name an event and I’ll scan posts — or ask who already showed up."
      : page === "review"
        ? "Review desk. I can list ready drafts or find someone to open."
        : "Account desk. Ask who to shortlist, who still needs research, or enrich a company.",
  }]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open]);

  async function send() {
    const message = text.trim();
    if (!message || busy) return;
    setText("");
    const history = msgs.filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, page, history }),
      });
      const data = await res.json().catch(() => null) as { reply?: string; open?: string; error?: string } | null;
      if (!res.ok && data?.error === "rate") {
        setMsgs((m) => [...m, { role: "assistant", content: "Slow down a moment — too many asks." }]);
      } else {
        setMsgs((m) => [...m, {
          role: "assistant",
          content: data?.reply ?? "No reply.",
          open: data?.open,
        }]);
      }
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Network error. Try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="pointer-events-auto flex h-[min(520px,70vh)] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[14px] border border-[#DDE2EE] bg-white shadow-[0_12px_40px_rgba(16,24,40,.12)]">
          <div className="flex items-center justify-between border-b border-[#EEF1F8] px-4 py-3">
            <div>
              <p className="text-[13px] font-semibold text-[#101828]">Workspace assistant</p>
              <p className="text-[11px] text-[#98A2B3] capitalize">{page} · this workspace only</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-[#98A2B3] hover:text-[#101828]">✕</button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13px] leading-5">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : ""}>
                <div className={`inline-block max-w-[95%] rounded-[10px] px-3 py-2 whitespace-pre-wrap text-left ${
                  m.role === "user" ? "bg-[#263BAA] text-white" : "bg-[#F4F6FB] text-[#101828]"
                }`}>
                  {m.content}
                </div>
                {m.open && (
                  <p className="mt-1">
                    <a href={m.open} className="text-[12px] text-[#263BAA] underline">Open in app</a>
                  </p>
                )}
              </div>
            ))}
            {busy && <p className="text-[12px] text-[#98A2B3]">Working…</p>}
            <div ref={bottom} />
          </div>
          <form
            className="flex gap-2 border-t border-[#EEF1F8] p-3"
            onSubmit={(e) => { e.preventDefault(); void send(); }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={page === "radar" ? "e.g. Scan SaaStr last 7 days US" : "e.g. Enrich all at Capital One"}
              className="min-w-0 flex-1 rounded-[8px] border border-[#DDE2EE] px-3 py-2 text-[13px]"
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="rounded-[8px] bg-[#263BAA] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        className="pointer-events-auto rounded-full bg-[#263BAA] px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_8px_24px_rgba(38,59,170,.35)] hover:bg-[#1D2E86]"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Close assistant" : "Ask assistant"}
      </button>
    </div>
  );
}
