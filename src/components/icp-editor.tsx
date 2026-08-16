"use client";
import { useRef, useState } from "react";

/** Structured ICP editor — v1.3.3 fixes:
 *  · drafts commit on blur/comma/Enter AND at Save time (nothing typed is ever lost)
 *  · multi-add: "a, b, c" or pasted lines become separate tags
 *  · click a chip to edit it (moves back into the input)
 *  · Save builds the payload at submit time — no hidden-field race */
type Persona = {
  slug: string; name: string;
  title_include: string[]; title_exclude: string[];
  seniority?: string[]; function_tags?: string[];
};
type Icp = {
  summary: string;
  fit_signals: string[]; pain_points: string[]; disqualifiers: string[];
  personas: Persona[];
};
const SENIORITY_VOCAB = ["junior", "founder", "cxo", "vp", "head", "director", "manager", "ic"];

const splitDraft = (s: string) =>
  s.split(/[,\n;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

function TagList({ label, values, onChange, accent = false, flushRegistry }: {
  label: string; values: string[]; onChange: (v: string[]) => void; accent?: boolean;
  flushRegistry: Map<string, () => string[]>;
}) {
  const [draft, setDraft] = useState("");
  const keyRef = useRef(`${label}-${Math.random()}`);

  const commit = (raw: string): string[] => {
    const parts = splitDraft(raw);
    if (parts.length === 0) return values;
    const merged = [...values];
    for (const p of parts) if (!merged.includes(p)) merged.push(p);
    onChange(merged);
    setDraft("");
    return merged;
  };
  // Registered so Save can flush any un-committed draft synchronously.
  flushRegistry.set(keyRef.current, () => commit(draft));

  return (
    <div>
      <p className="text-xs text-[#46506E]/45">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <span key={v} className={`group inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
            accent ? "bg-[#263BAA]/15 text-[#263BAA]" : "bg-[#263BAA]/10 text-[#46506E]/80"}`}>
            <button type="button" title="Click to edit"
              onClick={() => { onChange(values.filter((x) => x !== v)); setDraft(v); }}
              className="hover:underline">{v}</button>
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-[#46506E]/35 hover:text-red-600">×</button>
          </span>
        ))}
        <input value={draft}
          onChange={(e) => {
            const val = e.target.value;
            // Comma/semicolon typed → commit everything before it instantly.
            if (/[,;]/.test(val)) commit(val); else setDraft(val);
          }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(draft); } }}
          onBlur={() => commit(draft)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[,\n;]/.test(text)) { e.preventDefault(); commit(`${draft} ${text}`); }
          }}
          placeholder="+ add (comma = several)" size={18}
          className="rounded border border-dashed border-[#D0D5E4] bg-transparent px-2 py-0.5 text-xs text-[#46506E]/70 placeholder:text-[#46506E]/30" />
      </div>
    </div>
  );
}

export function IcpEditor({ initialJson, action }: {
  initialJson: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const [icp, setIcp] = useState<Icp>(() => {
    // Normalize whatever is stored — a partial or empty ICP must never crash the editor.
    const raw = (() => { try { return JSON.parse(initialJson); } catch { return {}; } })() as Partial<Icp>;
    return {
      summary: raw.summary ?? "",
      fit_signals: raw.fit_signals ?? [],
      pain_points: raw.pain_points ?? [],
      disqualifiers: raw.disqualifiers ?? [],
      personas: (raw.personas ?? []).map((pp) => ({
        slug: pp.slug ?? "persona", name: pp.name ?? "Persona",
        title_include: pp.title_include ?? [], title_exclude: pp.title_exclude ?? [],
        seniority: pp.seniority ?? [], function_tags: pp.function_tags ?? [],
      })),
    };
  });
  const [savedFlash, setSavedFlash] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [raw, setRaw] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const flushRegistry = useRef(new Map<string, () => string[]>()).current;

  const patch = (part: Partial<Icp>) => setIcp((cur) => ({ ...cur, ...part }));
  const patchPersona = (i: number, part: Partial<Persona>) =>
    setIcp((cur) => ({ ...cur, personas: cur.personas.map((p, j) => (j === i ? { ...p, ...part } : p)) }));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    let payload: Icp;
    if (jsonMode) {
      try { payload = JSON.parse(raw); setIcp(payload); }
      catch (ex) { setErr(`Invalid JSON: ${ex instanceof Error ? ex.message : ""}`); return; }
    } else {
      // Flush every pending "+ add" draft synchronously into a working copy —
      // nothing typed-but-not-entered is ever dropped by Save again.
      for (const flush of flushRegistry.values()) flush();
      payload = await new Promise<Icp>((res) => setIcp((cur) => { res(cur); return cur; }));
    }
    setSaving(true);
    const fd = new FormData();
    fd.set("icp", JSON.stringify(payload));
    try {
      await action(fd);
    } finally {
      // The redirect lands on this same page, so the component instance
      // survives — reset the button and flash confirmation ourselves.
      setSaving(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    }
  }

  return (
    <form onSubmit={handleSave}>
      {!jsonMode ? (
        <div className="space-y-6">
          <div>
            <p className="text-xs text-[#46506E]/45">Summary</p>
            <textarea value={icp.summary} onChange={(e) => patch({ summary: e.target.value })} rows={3}
              className="mt-1.5 w-full rounded-xl glass border-0 p-3 text-sm" />
          </div>
          <TagList label="Fit signals" values={icp.fit_signals} onChange={(v) => patch({ fit_signals: v })} flushRegistry={flushRegistry} />
          <TagList label="Pain points" values={icp.pain_points} onChange={(v) => patch({ pain_points: v })} flushRegistry={flushRegistry} />
          <TagList label="Disqualifiers" values={icp.disqualifiers} onChange={(v) => patch({ disqualifiers: v })} flushRegistry={flushRegistry} />

          <div>
            <p className="text-xs text-[#46506E]/45">Personas</p>
            <div className="mt-2 space-y-3">
              {icp.personas.map((p, i) => (
                <div key={i} className="rounded-xl glass border-0 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <input value={p.name} onChange={(e) => patchPersona(i, { name: e.target.value })}
                      className="flex-1 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium hover:border-[#E4E7F2]" />
                    <button type="button" onClick={() => patch({ personas: icp.personas.filter((_, j) => j !== i) })}
                      className="text-xs text-[#46506E]/30 hover:text-red-600">remove</button>
                  </div>
                  <div className="mt-3 space-y-3">
                    <TagList label="title include — these patterns drive the free rule pass" accent
                      values={p.title_include} onChange={(v) => patchPersona(i, { title_include: v })} flushRegistry={flushRegistry} />
                    <TagList label="title exclude" values={p.title_exclude}
                      onChange={(v) => patchPersona(i, { title_exclude: v })} flushRegistry={flushRegistry} />
                    <div>
                      <p className="text-xs text-[#46506E]/45">seniority — a rule hit only counts inside these bands</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {SENIORITY_VOCAB.map((sv) => {
                          const on = (p.seniority ?? []).includes(sv);
                          return (
                            <button key={sv} type="button"
                              onClick={() => patchPersona(i, {
                                seniority: on ? (p.seniority ?? []).filter((x) => x !== sv)
                                  : [...(p.seniority ?? []), sv],
                              })}
                              className={`rounded px-2 py-0.5 text-xs ${on
                                ? "bg-[#263BAA]/20 text-[#263BAA]" : "bg-[#263BAA]/5 text-[#46506E]/40 hover:text-[#46506E]/70"}`}>
                              {sv}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <TagList label="function tags" values={p.function_tags ?? []}
                      onChange={(v) => patchPersona(i, { function_tags: v })} flushRegistry={flushRegistry} />
                  </div>
                </div>
              ))}
              <button type="button"
                onClick={() => patch({
                  personas: [...icp.personas, {
                    slug: `persona-${icp.personas.length + 1}`, name: "New persona",
                    title_include: [], title_exclude: [], seniority: [], function_tags: [],
                  }],
                })}
                className="w-full rounded-xl border border-dashed border-[#D0D5E4] py-2.5 text-sm text-[#46506E]/45 hover:border-[#263BAA]/40 hover:text-[#46506E]/70">
                + Add persona
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={24}
            className="w-full rounded-xl glass border-0 p-3 font-mono text-xs" />
        </div>
      )}

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-6 flex items-center gap-4">
        <button type="submit" disabled={saving}
          className="rounded-lg bg-[#263BAA] px-5 py-2 text-sm font-semibold text-[#14204A] hover:bg-[#1D2E86] disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {savedFlash && <span className="text-sm text-[#263BAA]">Saved ✓ — re-run matching to apply.</span>}
        <button type="button"
          onClick={() => {
            if (!jsonMode) { setRaw(JSON.stringify(icp, null, 2)); setErr(""); }
            setJsonMode(!jsonMode);
          }}
          className="text-sm text-[#263BAA] underline decoration-[#263BAA]/40 hover:text-[#1D2E86]">
          {jsonMode ? "Back to form" : "Edit as JSON"}
        </button>
      </div>
    </form>
  );
}
