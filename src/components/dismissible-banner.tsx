"use client";
/** A banner the user can close. Hides instantly on click, then records the
 *  dismissal so it stays gone after a refresh. */
import { useState } from "react";

export function DismissibleBanner({ jobId, tone = "error", children, title }: {
  jobId: string; tone?: "error" | "neutral"; children: React.ReactNode; title?: string;
}) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const skin = tone === "error"
    ? "border-[#FDA29B] bg-[#FFFBFA] text-[#B42318]"
    : "border-[#DDE2EE] bg-white text-[#475467]";
  return (
    <div className={`flex shrink-0 items-center gap-3 border-b px-5 py-2 text-[12px] ${skin}`}>
      <span className="min-w-0 flex-1 truncate" title={title}>{children}</span>
      <button
        aria-label="Dismiss"
        onClick={() => {
          setGone(true);
          void fetch("/api/job-dismiss", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: jobId }),
          }).catch(() => {});
        }}
        className="shrink-0 rounded-[6px] px-1.5 text-[14px] leading-none opacity-60 transition-opacity duration-[130ms] hover:opacity-100">
        ×
      </button>
    </div>
  );
}
