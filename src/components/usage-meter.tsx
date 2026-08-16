import { resetsIn } from "@/modules/enrich/usage";

/** Daily enrichment budget: mono readout + tiny bar. Lime while comfortable,
 *  amber past 80%, salmon at the ceiling. */
export function UsageMeter({ used, cap, resetsAt, bar = false }: {
  used: number; cap: number; resetsAt: Date; bar?: boolean;
}) {
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const tone = used >= cap ? "text-[#B42318]" : pct >= 80 ? "text-[#B54708]" : "text-[#98A2B3]";
  const fill = used >= cap ? "#B42318" : pct >= 80 ? "#B54708" : "#263BAA";
  return (
    <span className="inline-flex items-center gap-2.5">
      {bar && (
        <span className="inline-block h-1.5 w-28 rounded bg-[#EEF1FC]">
          <span className="block h-1.5 rounded" style={{ width: `${pct}%`, backgroundColor: fill }} />
        </span>
      )}
      <span className={`tnum ${tone}`}>
        Today {used}/{cap} researched · resets in {resetsIn(resetsAt)}
      </span>
    </span>
  );
}
