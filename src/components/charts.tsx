/** Tiny server-rendered SVG charts — no client JS, no libraries. */

export function StatCard({ label, value, sub, delta }: {
  label: string; value: string; sub?: string; delta?: { v: string; up: boolean };
}) {
  return (
    <div className="bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
      <p className="text-xs text-[#98A2B3]">{label}</p>
      <p className="tnum mt-2 text-[26px] font-semibold text-[#101828]">{value}</p>
      {(sub || delta) && (
        <p className="mt-1.5 text-xs">
          {delta && <span className={delta.up ? "text-[#067647]" : "text-[#B42318]"}>{delta.up ? "↑" : "↓"} {delta.v} </span>}
          <span className="text-[#98A2B3]">{sub}</span>
        </p>
      )}
    </div>
  );
}

const PALETTE = ["#263BAA", "#4358D4", "#8B95AE", "#B54708", "#067647", "#667394", "#C6CDDE"];

export function Donut({ items, total, size = 168 }: {
  items: { label: string; n: number }[]; total: number; size?: number;
}) {
  const R = 60, C = 2 * Math.PI * R;
  let offset = 0;
  const segs = items.filter((i) => i.n > 0).map((i, idx) => {
    const frac = total > 0 ? i.n / total : 0;
    const seg = (
      <circle key={i.label} r={R} cx={size / 2} cy={size / 2} fill="none"
        stroke={PALETTE[idx % PALETTE.length]} strokeWidth={22}
        strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-offset * C}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    );
    offset += frac;
    return seg;
  });
  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} className="shrink-0">
        {segs}
        <text x="50%" y="47%" textAnchor="middle" className="fill-[#101828]" fontSize="24" fontWeight="600">{total.toLocaleString()}</text>
        <text x="50%" y="60%" textAnchor="middle" className="fill-[#475467]" fontSize="11" opacity="0.5">total</text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {items.map((i, idx) => (
          <li key={i.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[idx % PALETTE.length] }} />
            <span className="min-w-0 flex-1 truncate text-[#475467]">{i.label}</span>
            <span className="tnum text-[#98A2B3]">{total > 0 ? Math.round((i.n / total) * 100) : 0}% ({i.n.toLocaleString()})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HBars({ items, max }: { items: { label: string; n: number }[]; max?: number }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.n));
  return (
    <ul className="space-y-2.5 text-sm">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between">
            <span className="truncate text-[#475467]">{i.label}</span>
            <span className="tnum ml-3 text-[#98A2B3]">{i.n.toLocaleString()}</span>
          </div>
          <div className="mt-1 h-1.5 rounded bg-[#EEF1FC]">
            <div className="h-1.5 rounded bg-[#263BAA]" style={{ width: `${(i.n / m) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function LineChart({ points, w = 560, h = 180 }: {
  points: { x: string; y: number }[]; w?: number; h?: number;
}) {
  if (points.length === 0) return (
    <div className="flex h-[180px] items-center justify-center rounded-[10px] border border-dashed border-[#DDE2EE] text-sm text-[#98A2B3]">
      History begins today — this chart fills in as snapshots accumulate.
    </div>
  );
  const ys = points.map((p) => p.y);
  const yMax = Math.max(...ys) * 1.08 || 1, yMin = Math.min(...ys, 0);
  const px = (i: number) => points.length === 1 ? w / 2 : 24 + (i / (points.length - 1)) * (w - 48);
  const py = (y: number) => h - 24 - ((y - yMin) / (yMax - yMin || 1)) * (h - 44);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(p.y)}`).join(" ");
  const area = `${path} L${px(points.length - 1)},${h - 24} L${px(0)},${h - 24} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <path d={area} fill="#263BAA" opacity="0.08" />
      <path d={path} fill="none" stroke="#263BAA" strokeWidth="2" />
      {points.map((p, i) => <circle key={i} cx={px(i)} cy={py(p.y)} r="3" fill="#fff" stroke="#263BAA" strokeWidth="2" />)}
      <text x={24} y={h - 8} fontSize="10" className="fill-[#475467]" opacity="0.5">{points[0].x}</text>
      <text x={w - 24} y={h - 8} fontSize="10" textAnchor="end" className="fill-[#475467]" opacity="0.5">{points[points.length - 1].x}</text>
    </svg>
  );
}
