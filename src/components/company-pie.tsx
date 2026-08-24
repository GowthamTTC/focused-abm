"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export type PieSlice = { key: string; name: string; count: number };

const COLORS = [
  "#263BAA", "#6B7CFF", "#067647", "#B54708", "#7A5AF8",
  "#0E9384", "#DD2590", "#475467", "#F79009", "#12B76A",
];

function polar(cx: number, cy: number, r: number, angle: number) {
  const a = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
  if (end - start >= 359.9) {
    // full circle
    const p1 = polar(cx, cy, r, 0);
    const p2 = polar(cx, cy, r, 179.9);
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 1 1 ${p2.x} ${p2.y} A ${r} ${r} 0 1 1 ${p1.x} ${p1.y}`;
  }
  const s = polar(cx, cy, r, start);
  const e = polar(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
}

export function CompanyPie({
  slices,
  hrefBase,
  activeKey,
}: {
  slices: PieSlice[];
  /** Base URL without company param; we append &company= */
  hrefBase: string;
  activeKey?: string;
}) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const total = slices.reduce((n, s) => n + s.count, 0);

  const paths = useMemo(() => {
    if (total === 0) return [];
    let angle = 0;
    return slices.map((s, i) => {
      const sweep = (s.count / total) * 360;
      const start = angle;
      const end = angle + sweep;
      angle = end;
      return { ...s, start, end, color: COLORS[i % COLORS.length] };
    });
  }, [slices, total]);

  if (total === 0) return null;

  const tip = paths.find((p) => p.key === (hover || activeKey));

  function go(key: string) {
    const u = new URL(hrefBase, "http://local");
    if (activeKey === key) u.searchParams.delete("company");
    else u.searchParams.set("company", key);
    u.searchParams.delete("page");
    u.searchParams.delete("p");
    router.push(u.pathname + u.search);
  }

  return (
    <div className="ui-fade-in flex flex-wrap items-center gap-4 rounded-[14px] border border-[#DDE2EE] bg-white p-4">
      <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
        {paths.map((p) => (
          <path
            key={p.key}
            d={arcPath(60, 60, 52, p.start, p.end)}
            fill={p.color}
            opacity={activeKey && activeKey !== p.key ? 0.35 : hover && hover !== p.key ? 0.7 : 1}
            className="cursor-pointer transition-opacity duration-150"
            onMouseEnter={() => setHover(p.key)}
            onMouseLeave={() => setHover(null)}
            onClick={() => go(p.key)}
          >
            <title>{`${p.name}: ${p.count}`}</title>
          </path>
        ))}
        <circle cx="60" cy="60" r="28" fill="white" />
        <text x="60" y="56" textAnchor="middle" className="fill-[#101828]" style={{ fontSize: 14, fontWeight: 600 }}>
          {total}
        </text>
        <text x="60" y="72" textAnchor="middle" className="fill-[#98A2B3]" style={{ fontSize: 9 }}>
          people
        </text>
      </svg>

      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wider text-[#98A2B3]">Company mix</p>
        <p className="mt-0.5 text-[12px] text-[#475467]">
          {tip
            ? <><span className="font-medium text-[#101828]">{tip.name}</span> · {tip.count} ({Math.round((tip.count / total) * 100)}%) — click to {activeKey === tip.key ? "clear" : "filter"}</>
            : "Hover a slice · click to filter this list"}
        </p>
        <ul className="mt-2 flex max-h-24 flex-wrap gap-x-3 gap-y-1 overflow-y-auto text-[12px]">
          {paths.slice(0, 12).map((p) => (
            <li key={p.key}>
              <button
                type="button"
                onClick={() => go(p.key)}
                className={`inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-[#F4F6FB] ${
                  activeKey === p.key ? "bg-[#EEF1FC] font-medium text-[#263BAA]" : "text-[#475467]"
                }`}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
                {p.name}
                <span className="tnum text-[#98A2B3]">{p.count}</span>
              </button>
            </li>
          ))}
        </ul>
        {activeKey && (
          <button
            type="button"
            onClick={() => go(activeKey)}
            className="mt-2 text-[12px] text-[#263BAA] underline"
          >
            Clear company filter
          </button>
        )}
      </div>
    </div>
  );
}
