"use client";
/** ⌘K command palette — screens + debounced people search (README §4). */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const SCREENS: { label: string; hint: string; href: string }[] = [
  { label: "Today", hint: "numbers and the next action", href: "/review?tab=decisions" },
  { label: "Review — Decisions", hint: "flags awaiting a verdict", href: "/review?tab=decisions" },
  { label: "Review — Ready to send", hint: "drafted openers", href: "/review?tab=ready" },
  { label: "Review — Sent", hint: "sent, with undo", href: "/review?tab=sent" },
  { label: "People", hint: "the full matched list", href: "/people" },
  { label: "Network — Composition", hint: "how the network graded", href: "/network?view=composition" },
  { label: "Network — Activity", hint: "who posts, and when", href: "/network?view=activity" },
  { label: "Network — Recency", hint: "who is going quiet", href: "/network?view=recency" },
  { label: "Alerts", hint: "real pipeline events", href: "/alerts" },
  { label: "Sources", hint: "imports and syncs", href: "/sources" },
  { label: "Offers", hint: "what you sell, one ICP each", href: "/offers" },
  { label: "Exports", hint: "the workbook", href: "/exports" },
];

type Person = { id: string; firstName: string; lastName: string; company: string | null; tier: number | null; score: number | null; batchId: string | null };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [hi, setHi] = useState(0);
  const router = useRouter();
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); setQ(""); setHi(0); }
      else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (deb.current) clearTimeout(deb.current);
    if (q.trim().length < 2) { setPeople([]); return; }
    deb.current = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      setPeople(j.people ?? []);
    }, 180);
  }, [q]);

  const screens = SCREENS.filter((s) => s.label.toLowerCase().includes(q.toLowerCase()));
  const rows: { kind: string; label: string; hint: string; href: string }[] = [
    ...screens.map((s) => ({ kind: "screen", ...s })),
    ...people.map((p) => ({
      kind: "person", label: `${p.firstName} ${p.lastName}`,
      hint: `${p.tier ? `T${p.tier}` : "—"} · score ${p.score ?? "—"}`,
      href: `/review?tab=ready&p=${p.id}${p.batchId ? `&c=${p.batchId}` : ""}`,
    })),
  ].slice(0, 12);

  const go = useCallback((href: string) => { setOpen(false); router.push(href); }, [router]);

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && rows[hi]) go(rows[hi].href);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-[rgba(16,24,40,.24)]" onClick={() => setOpen(false)}>
      <div className="mx-auto mt-[92px] w-[540px] max-w-[calc(100vw-40px)] overflow-hidden rounded-[16px] border border-[#DDE2EE] bg-white shadow-[0_24px_60px_rgba(16,24,40,.18)]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-[#EEF1F8] px-[15px] py-[13px]">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#98A2B3" strokeWidth="1.35" strokeLinecap="round"><path d="M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM10.5 10.5l3 3" /></svg>
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={onInputKey}
            placeholder="Search screens or people…"
            className="flex-1 bg-transparent text-[14px] text-[#101828] outline-none placeholder:text-[#98A2B3]" />
          <span className="tnum rounded bg-[#F4F6FB] px-1.5 py-0.5 text-[10px] text-[#475467]">esc</span>
        </div>
        <div className="max-h-[380px] overflow-y-auto">
          {rows.map((r, i) => (
            <button key={r.href + i} onClick={() => go(r.href)} onMouseEnter={() => setHi(i)}
              className={`flex w-full items-center gap-3 border-b border-[#EEF1F8] px-[15px] py-[10px] text-left transition-colors duration-[120ms] ${i === hi ? "bg-[#EEF1FC]" : "bg-white"}`}>
              <span className="w-[58px] shrink-0 text-[9.5px] uppercase tracking-[.1em] text-[#98A2B3]">{r.kind}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-[#101828]">{r.label}</span>
              <span className="shrink-0 text-[11.5px] text-[#98A2B3]">{r.hint}</span>
            </button>
          ))}
          {rows.length === 0 && <p className="p-[26px] text-center text-[12.5px] text-[#98A2B3]">Nothing matches that.</p>}
        </div>
        <div className="flex items-center justify-between border-t border-[#EEF1F8] bg-[#F4F6FB] px-[15px] py-[9px] text-[11px] text-[#98A2B3]">
          <span>↑↓ move · ↵ open</span><span>⌘K anywhere</span>
        </div>
      </div>
    </div>
  );
}

export function PaletteTrigger() {
  return (
    <button aria-label="Search or jump to" title="Search or jump to (⌘K)"
      onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
      className="flex items-center gap-2 rounded-[10px] border border-[#DDE2EE] px-[9px] py-[6px] transition-colors duration-[130ms] hover:border-[#98A2B3]">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#475467" strokeWidth="1.35" strokeLinecap="round"><path d="M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM10.5 10.5l3 3" /></svg>
      <span className="tnum rounded bg-[#F4F6FB] px-1 py-px text-[10px] text-[#475467]">⌘K</span>
    </button>
  );
}
