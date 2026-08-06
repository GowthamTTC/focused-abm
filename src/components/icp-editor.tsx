"use client";
import { useState } from "react";

/** Structured ICP editor (design 1f): tag groups for signals/pains/
 *  disqualifiers, persona cards with pattern + seniority chips, and an
 *  Edit-as-JSON escape hatch. Serialized ICP rides a hidden input into the
 *  existing server action. */
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

function TagList({ label, values, onChange, accent = false }: {
  label: string; values: string[]; onChange: (v: string[]) => void; accent?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().toLowerCase();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div>
      <p className="text-xs text-white/45">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <span key={v} className={`group inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
            accent ? "bg-[#B6FF2E]/15 text-[#CFFF66]" : "bg-white/10 text-white/80"}`}>
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-white/35 hover:text-red-300">×</button>
          </span>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="+ add" size={6}
          className="rounded border border-dashed border-white/15 bg-transparent px-2 py-0.5 text-xs text-white/70 placeholder:text-white/30" />
      </div>
    </div>
  );
}

export function IcpEditor({ initialJson, action }: {
  initialJson: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const [icp, setIcp] = useState<Icp>(() => JSON.parse(initialJson));
  const [jsonMode, setJsonMode] = useState(false);
  const [raw, setRaw] = useState("");
  const [jsonErr, setJsonErr] = useState("");

  const patch = (part: Partial<Icp>) => setIcp({ ...icp, ...part });
  const patchPersona = (i: number, part: Partial<Persona>) =>
    patch({ personas: icp.personas.map((p, j) => (j === i ? { ...p, ...part } : p)) });

  return (
    <form action={action}>
      <input type="hidden" name="icp" value={JSON.stringify(icp)} />

      {!jsonMode ? (
        <div className="space-y-6">
          <div>
            <p className="text-xs text-white/45">Summary</p>
            <textarea value={icp.summary} onChange={(e) => patch({ summary: e.target.value })} rows={3}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm" />
          </div>
          <TagList label="Fit signals" values={icp.fit_signals} onChange={(v) => patch({ fit_signals: v })} />
          <TagList label="Pain points" values={icp.pain_points} onChange={(v) => patch({ pain_points: v })} />
          <TagList label="Disqualifiers" values={icp.disqualifiers} onChange={(v) => patch({ disqualifiers: v })} />

          <div>
            <p className="text-xs text-white/45">Personas</p>
            <div className="mt-2 space-y-3">
              {icp.personas.map((p, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-black/25 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <input value={p.name} onChange={(e) => patchPersona(i, { name: e.target.value })}
                      className="flex-1 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium hover:border-white/10" />
                    <button type="button" onClick={() => patch({ personas: icp.personas.filter((_, j) => j !== i) })}
                      className="text-xs text-white/30 hover:text-red-300">remove</button>
                  </div>
                  <div className="mt-3 space-y-3">
                    <TagList label="title include — these patterns drive the free rule pass" accent
                      values={p.title_include} onChange={(v) => patchPersona(i, { title_include: v })} />
                    <TagList label="title exclude" values={p.title_exclude}
                      onChange={(v) => patchPersona(i, { title_exclude: v })} />
                    <div>
                      <p className="text-xs text-white/45">seniority — a rule hit only counts inside these bands</p>
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
                                ? "bg-[#B6FF2E]/20 text-[#B6FF2E]" : "bg-white/5 text-white/40 hover:text-white/70"}`}>
                              {sv}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <TagList label="function tags" values={p.function_tags ?? []}
                      onChange={(v) => patchPersona(i, { function_tags: v })} />
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
                className="w-full rounded-xl border border-dashed border-white/15 py-2.5 text-sm text-white/45 hover:border-white/30 hover:text-white/70">
                + Add persona
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={24}
            className="w-full rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs" />
          {jsonErr && <p className="mt-2 text-sm text-red-400">{jsonErr}</p>}
          <button type="button"
            onClick={() => {
              try { setIcp(JSON.parse(raw)); setJsonErr(""); setJsonMode(false); }
              catch (e) { setJsonErr(`Invalid JSON: ${e instanceof Error ? e.message : ""}`); }
            }}
            className="mt-3 rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5">
            Apply JSON
          </button>
        </div>
      )}

      <div className="mt-6 flex items-center gap-4">
        <button className="rounded-lg bg-[#B6FF2E] px-5 py-2 text-sm font-semibold text-[#16191E] hover:bg-[#9FE51F]">Save</button>
        <button type="button"
          onClick={() => {
            if (!jsonMode) { setRaw(JSON.stringify(icp, null, 2)); setJsonErr(""); }
            setJsonMode(!jsonMode);
          }}
          className="text-sm text-[#B6FF2E] underline decoration-[#B6FF2E]/40 hover:text-[#9FE51F]">
          {jsonMode ? "Back to form" : "Edit as JSON"}
        </button>
      </div>
    </form>
  );
}
