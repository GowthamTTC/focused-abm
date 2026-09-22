/** Presentational pieces for the L3 page. Kept apart from the page so the
 *  layout reads as layout, and so each one states what its number IS. */

export const CARD = "rounded-[14px] border border-[#E9EAEE] bg-white";

/** Half-dial, 180°. Takes a 0–100 value and a caption that must say what the
 *  number means — a dial without a definition is the fastest way to lose a
 *  room that asks how it was calculated. */
export function HalfGauge({ value, color, big, small }: {
  value: number | null; color: string; big: string; small: string;
}) {
  const w = 200, h = 110, cx = 100, cy = 100, r = 78;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const a = Math.PI * (1 - pct / 100);
  const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
  const arc = (sx: number, sy: number, ex: number, ey: number, large = 0) =>
    `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
  return (
    <div className="flex flex-col items-center">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <path d={arc(cx - r, cy, cx + r, cy, 1)} fill="none" stroke="#EDEFF3" strokeWidth="14" strokeLinecap="round" />
        {value !== null && (
          <path d={arc(cx - r, cy, x, y, pct > 50 ? 1 : 0)} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" />
        )}
        <text x={cx} y={cy - 24} textAnchor="middle" style={{ fontSize: 30, fontWeight: 600 }} className="fill-[#101828]">
          {value === null ? "—" : value}
        </text>
        <text x={cx} y={cy - 6} textAnchor="middle" style={{ fontSize: 11 }} className="fill-[#98A2B3]">
          {value === null ? "" : "/100"}
        </text>
      </svg>
      <div className="-mt-1 text-center">
        <div className="text-[13px] font-semibold" style={{ color }}>{big}</div>
        <div className="text-[11px] text-[#667085]">{small}</div>
      </div>
    </div>
  );
}

/** Line chart with a y-axis and dated ticks, so the shape can be checked
 *  against the numbers instead of admired. */
export function VolumeChart({ points }: { points: { week: string; n: number }[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-[120px] items-center justify-center rounded-[10px] bg-[#FAFBFC] text-[12px] text-[#98A2B3]">
        Not enough dated posts to plot a trend
      </div>
    );
  }
  const w = 460, h = 120, padL = 26, padB = 18, padT = 8;
  const max = Math.max(...points.map((p) => p.n), 4);
  const step = Math.max(1, Math.ceil(max / 4));
  const ticks = [0, step, step * 2, step * 3, step * 4].filter((t) => t <= step * 4);
  const top = step * 4;
  const px = (i: number) => padL + (i / (points.length - 1)) * (w - padL - 8);
  const py = (n: number) => padT + (1 - n / top) * (h - padT - padB);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(p.n).toFixed(1)}`).join(" ");
  const label = (wk: string) => {
    const dt = new Date(wk);
    return `${dt.toLocaleString("en", { month: "short" })} ${dt.getUTCDate()}`;
  };
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} y1={py(t)} x2={w - 8} y2={py(t)} stroke="#F0F1F5" strokeWidth="1" />
          <text x={padL - 6} y={py(t) + 3} textAnchor="end" style={{ fontSize: 9 }} className="fill-[#98A2B3]">{t}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="#4F46E5" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => <circle key={p.week} cx={px(i)} cy={py(p.n)} r="2.2" fill="#4F46E5" />)}
      {[0, points.length - 1].map((i) => (
        <text key={i} x={px(i)} y={h - 4} textAnchor={i === 0 ? "start" : "end"}
          style={{ fontSize: 9 }} className="fill-[#98A2B3]">{label(points[i].week)}</text>
      ))}
    </svg>
  );
}

/** A confidence bar. Null renders as an empty track with an em dash, never as
 *  a zero-width bar that could read as "low" rather than "not measured". */
export function Meter({ value, color }: { value: number | null; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#EDEFF3]">
        {value !== null && (
          <div className="h-full rounded-full" style={{ width: `${Math.max(4, value)}%`, background: color }} />
        )}
      </div>
      <span className="text-[11px] text-[#667085]">{value === null ? "—" : `${value}%`}</span>
    </div>
  );
}

/** The org tree: a root, one horizontal rail, and a box per unit. CSS borders
 *  rather than SVG so the boxes can wrap on a narrow screen and keep their
 *  connectors, which an absolutely-positioned diagram cannot. */
export function OrgTree({ root, nodes }: {
  root: string;
  nodes: { name: string; state: "engaged" | "whitespace" | "focus"; sub?: string }[];
}) {
  const style = {
    engaged: "border-[#ABEFC6] bg-[#F6FEF9] text-[#027A48]",
    whitespace: "border-[#E4E7EC] bg-[#FAFBFC] text-[#475467]",
    focus: "border-[#F97066] bg-[#FFFBFA] text-[#B42318] ring-1 ring-[#FEE4E2]",
  } as const;
  return (
    <div className="mt-4">
      <div className="flex justify-center">
        <div className="rounded-[10px] bg-[#1D2939] px-5 py-2.5 text-center">
          <div className="text-[14px] font-semibold text-white">{root}</div>
          <div className="text-[10px] text-[#98A2B3]">Global leadership</div>
        </div>
      </div>
      <div className="mx-auto h-4 w-px bg-[#D0D5DD]" />
      <div className="border-t border-[#D0D5DD]" />
      <div className="flex flex-wrap justify-center gap-2 pt-4">
        {nodes.map((n) => (
          <div key={n.name} className="relative">
            <div className="absolute -top-4 left-1/2 h-4 w-px bg-[#D0D5DD]" />
            <div className={`rounded-[8px] border px-2.5 py-1.5 text-center text-[11.5px] ${style[n.state]}`}>
              <div className="font-medium">{n.name}</div>
              {n.sub && <div className="text-[9.5px] opacity-80">{n.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[#667085]">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}
    </span>
  );
}
