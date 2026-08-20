"use client";
import { useRef, useState } from "react";

/** Manual selection on the Matched table.
 *
 *  The checkboxes are plain uncontrolled inputs rendered by the server — this
 *  wrapper counts them by event delegation, so a 400-row table costs nothing to
 *  serialise. The (max+1)th tick is refused on the spot rather than silently
 *  clipped later; the server clamps to the same number regardless.
 *
 *  Per-row Enrich buttons live INSIDE this one form via `formAction` — nested
 *  <form> elements are illegal HTML, and one form keeps the checkbox payload
 *  intact for the "Enrich selected" submit.
 */
export function SelectRows({ action, max, enabled, children }: {
  action: (fd: FormData) => void | Promise<void>;
  max: number;
  enabled: boolean;
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [n, setN] = useState(0);
  const [refused, setRefused] = useState(false);

  const boxes = () =>
    Array.from(formRef.current?.querySelectorAll<HTMLInputElement>('input[name="ids"]') ?? []);

  function onChange(e: React.FormEvent<HTMLFormElement>) {
    const t = e.target as HTMLInputElement;
    if (t.name !== "ids") return;
    const checked = boxes().filter((b) => b.checked);
    if (checked.length > max) {
      t.checked = false;
      setRefused(true);
      return;
    }
    setRefused(false);
    setN(checked.length);
  }

  function clear() {
    for (const b of boxes()) b.checked = false;
    setN(0);
    setRefused(false);
  }

  // Off-target / Peers tables carry their own per-row forms; never wrap those.
  if (!enabled) return <>{children}</>;

  return (
    <form ref={formRef} action={action} onChange={onChange}
      onSubmit={() => { setN(0); setRefused(false); }}>
      <div className="sticky top-0 z-30 mt-4 flex flex-wrap items-center gap-3 rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <span className="tnum text-sm text-[#101828]">{n} selected</span>
        <span className="text-xs text-[#98A2B3]">tick up to {max} per run · or use Enrich on any single row</span>
        {refused && (
          <span className="text-xs text-[#B54708]">{max} is the cap — untick someone first.</span>
        )}
        <button type="button" onClick={clear} disabled={n === 0}
          className={n === 0
            ? "ml-auto cursor-default text-xs text-[#C6CDDE]"
            : "ml-auto text-xs text-[#475467] underline decoration-[#DDE2EE] hover:text-[#263BAA]"}>
          Clear
        </button>
        <button type="submit" disabled={n === 0}
          className={n === 0
            ? "cursor-not-allowed rounded-[8px] bg-[#F4F6FB] px-3 py-1.5 text-xs font-semibold text-[#98A2B3]"
            : "rounded-[8px] bg-[#263BAA] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D2E86]"}>
          Enrich selected{n > 0 ? ` (${n})` : ""}
        </button>
      </div>
      {children}
    </form>
  );
}
