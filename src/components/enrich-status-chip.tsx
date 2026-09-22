import { type EnrichState, enrichStateLabel, enrichStateOf } from "@/modules/enrich/status";

const CLS: Record<EnrichState, string> = {
  enriched: "bg-[#EEF1FC] text-[#263BAA]",
  researching: "bg-[#FDF6E7] text-[#B54708]",
  failed: "bg-red-500/15 text-[#B42318]",
  skipped: "bg-[#F4F6FB] text-[#475467]",
  "not-enriched": "bg-[#F4F6FB] text-[#475467]",
};

export function EnrichStatusChip({ status, enrichedAt }: {
  status: string; enrichedAt?: Date | null;
}) {
  const state = enrichStateOf({ enrichStatus: status, enrichedAt });
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] ${CLS[state]}`}>{enrichStateLabel(state)}</span>
  );
}
