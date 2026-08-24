"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";

type ToggleFn = (key: string, name: string, view: string, on: boolean) => Promise<void>;

/** Star toggles immediately with a pop animation. */
export function ShortlistStar({
  starred,
  companyKey,
  companyName,
  view,
  action,
}: {
  starred: boolean;
  companyKey: string;
  companyName: string;
  view: string;
  action: ToggleFn;
}) {
  const [optimistic, setOptimistic] = useOptimistic(starred);
  const [pending, startTransition] = useTransition();
  const [pop, setPop] = useState(false);

  useEffect(() => {
    if (!pop) return;
    const t = setTimeout(() => setPop(false), 320);
    return () => clearTimeout(t);
  }, [pop]);

  return (
    <button
      type="button"
      disabled={pending}
      title={optimistic ? "Remove from shortlist" : "Add to shortlist"}
      className={`rounded px-2 py-1 text-[16px] leading-none transition-colors duration-150 ${
        optimistic ? "text-[#263BAA]" : "text-[#D0D5DD] hover:text-[#263BAA]"
      } disabled:opacity-70 ${pop ? "star-pop" : ""}`}
      onClick={() => {
        const next = !optimistic;
        setPop(true);
        startTransition(async () => {
          setOptimistic(next);
          await action(companyKey, companyName, view, next);
        });
      }}
    >
      {optimistic ? "★" : "☆"}
    </button>
  );
}

export function ShortlistTextButton({
  starred,
  companyKey,
  companyName,
  view,
  action,
}: {
  starred: boolean;
  companyKey: string;
  companyName: string;
  view: string;
  action: ToggleFn;
}) {
  const [optimistic, setOptimistic] = useOptimistic(starred);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      className={`btn-press rounded-[8px] px-3 py-1.5 text-[12px] transition-all duration-150 ${
        optimistic
          ? "border border-[#DDE2EE] text-[#475467]"
          : "bg-[#263BAA] text-white hover:bg-[#1D2E86]"
      } disabled:opacity-70`}
      onClick={() => {
        const next = !optimistic;
        startTransition(async () => {
          setOptimistic(next);
          await action(companyKey, companyName, view, next);
        });
      }}
    >
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="radar-dots" aria-hidden><span /><span /><span /></span>
          Saving…
        </span>
      ) : optimistic ? "Remove from shortlist" : "Add to shortlist"}
    </button>
  );
}
