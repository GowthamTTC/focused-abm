/** Ledger strip — 1-tick-per-person composition bar (design 1d/1i).
 *  Inset dark track; segments in rank order: bright lime = enriched Top-N,
 *  dim lime = selected-but-pending, slate = pitchable pool, then peers,
 *  off-target, excluded, unclassified fading into the dark. */
const COLORS = {
  topDone: "#263BAA", // spec
  topPending: "rgba(38,59,170,.45)",
  pitchable: "#8B95AE",
  peers: "#667394",
  offIcp: "#98A2B3",
  excluded: "#C6CDDE",
  unclassified: "#C6CDDE",
} as const;

export function LedgerStrip({ counts, className = "" }: {
  counts: Partial<Record<keyof typeof COLORS, number>>;
  className?: string;
}) {
  const order: (keyof typeof COLORS)[] = ["topDone", "topPending", "pitchable", "peers", "offIcp", "excluded", "unclassified"];
  const total = order.reduce((a, k) => a + (counts[k] ?? 0), 0);
  if (total === 0) {
    return <div className={`h-4 rounded-full border border-[#263BAA]/8 bg-[#EEF1F8] ${className}`} />;
  }
  return (
    <div className={`flex h-4 overflow-hidden rounded-full border border-[#263BAA]/8 bg-[#EEF1F8] border border-[#DDE2EE] ${className}`}>
      {order.map((k) => {
        const n = counts[k] ?? 0;
        if (n === 0) return null;
        return (
          <div key={k} style={{
            width: `${(n / total) * 100}%`,
            backgroundImage: `repeating-linear-gradient(90deg, ${COLORS[k]} 0 1px, transparent 1px 3px)`,
          }} />
        );
      })}
    </div>
  );
}
