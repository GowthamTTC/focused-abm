"use client";

/** Shared progress UI — determinate, indeterminate, and compact job strip. */
export function ProgressBar({
  value,
  max,
  indeterminate = false,
  size = "md",
  tone = "brand",
}: {
  value?: number;
  max?: number;
  indeterminate?: boolean;
  size?: "sm" | "md";
  tone?: "brand" | "warm";
}) {
  const total = max ?? 0;
  const prog = value ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((prog / total) * 100)) : 0;
  const h = size === "sm" ? "h-1.5" : "h-2";
  const fill = tone === "warm" ? "bg-[#B54708]" : "bg-[#263BAA]";
  const track = tone === "warm" ? "bg-[#F5E6B8]" : "bg-[#EEF1F8]";

  return (
    <div className={`relative w-full overflow-hidden rounded-full ${h} ${track}`} role="progressbar"
      aria-valuemin={0} aria-valuemax={total || 100} aria-valuenow={indeterminate ? undefined : pct}>
      {indeterminate || total <= 0 ? (
        <div className={`banner-indeterminate absolute ${h} w-1/3 rounded-full ${fill}`} />
      ) : (
        <div
          className={`radar-bar-glow ${h} rounded-full transition-[width] duration-500 ${fill}`}
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}

export function JobProgress({
  label,
  stage,
  value,
  max,
  status,
}: {
  label: string;
  stage: string;
  value: number;
  max: number;
  status?: string;
}) {
  const live = !status || ["queued", "running", "stopping"].includes(status);
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : null;
  return (
    <div className="radar-live flex min-w-0 flex-1 items-center gap-3">
      <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-[#263BAA]"
        style={{ animation: live ? "radar-pulse 1.4s ease-in-out infinite" : undefined }} />
      <span className="tnum min-w-0 text-[12px] text-[#475467]">
        {label}
        {" · "}
        {stage}
        {live && <span className="radar-dots" aria-hidden><span /><span /><span /></span>}
        {status && !live ? ` · ${status}` : ""}
        {" · "}
        {value.toLocaleString()}
        {max > 0 ? ` / ${max.toLocaleString()}` : ""}
        {pct != null ? ` · ${pct}%` : ""}
      </span>
      <ProgressBar value={value} max={max} indeterminate={max <= 0 && live} size="sm" />
    </div>
  );
}
