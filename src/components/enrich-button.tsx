"use client";

import { useState, useTransition } from "react";

/**
 * Optimistic Enrich control — wait panel appears immediately with motion.
 */
export function EnrichButton({
  action,
  label = "Enrich",
  pendingLabel = "Starting research…",
}: {
  action: () => Promise<void>;
  label?: string;
  pendingLabel?: string;
}) {
  const [started, setStarted] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = started || pending;

  if (busy) {
    return (
      <div className="enrich-wait rounded-[10px] border border-[#E7CE96] bg-[#FEFBF3] p-4 text-sm text-[#B54708]">
        <p className="font-medium radar-banner-text">{pendingLabel}</p>
        <p className="mt-1 text-[#475467]">
          Usually about a minute. Watch the top bar — this card updates when research finishes.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-[#B54708]" style={{ animation: "radar-pulse 1.2s ease-in-out infinite" }} />
          <span className="radar-dots" aria-hidden><span /><span /><span /></span>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-fade-in rounded-[10px] border border-[#E7CE96] bg-[#FEFBF3] p-4 text-sm">
      <p className="font-medium text-[#B54708]">Research not run yet</p>
      <p className="mt-1 text-[#475467]">
        Posts, pain points, and outreach draft appear after enrich.
      </p>
      <button
        type="button"
        className="btn-press mt-3 rounded-[8px] bg-[#263BAA] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#1D2E86] disabled:opacity-60"
        disabled={busy}
        onClick={() => {
          setStarted(true);
          startTransition(() => {
            void action();
          });
        }}
      >
        {label}
      </button>
    </div>
  );
}

export function EnrichRowButton({
  action,
  label = "Enrich",
  failed = false,
}: {
  action: () => Promise<void>;
  label?: string;
  failed?: boolean;
}) {
  const [started, setStarted] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = started || pending;

  return (
    <button
      type="button"
      disabled={busy}
      title={failed ? "Retry research for this person" : "Research this person"}
      className={`text-[12px] transition-all duration-150 ${
        busy
          ? "text-[#98A2B3] no-underline"
          : "text-[#263BAA] underline hover:text-[#1D2E86]"
      }`}
      onClick={() => {
        setStarted(true);
        startTransition(() => {
          void action();
        });
      }}
    >
      {busy ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#263BAA]" style={{ animation: "radar-pulse 1s ease-in-out infinite" }} />
          Starting…
        </span>
      ) : failed ? "Retry" : label}
    </button>
  );
}


/** Compact account-card control: enrich top seats here. */
export function AccountEnrichButton({
  action,
  count,
  alreadyQueued = false,
}: {
  action: () => Promise<void>;
  count: number;
  alreadyQueued?: boolean;
}) {
  const [started, setStarted] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = started || pending || alreadyQueued;

  if (busy) {
    return (
      <div className="enrich-wait mt-3 rounded-[10px] border border-[#E7CE96] bg-[#FEFBF3] p-3 text-[12.5px] text-[#B54708]">
        <p className="font-medium">Research started</p>
        <p className="mt-0.5 text-[#475467]">Watch the top bar. This card updates when it finishes.</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-[#B54708]" style={{ animation: "radar-pulse 1.2s ease-in-out infinite" }} />
          <span className="radar-dots" aria-hidden><span /><span /><span /></span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={count === 0}
      className="btn-press mt-3 w-full rounded-[8px] bg-[#263BAA] px-3 py-2 text-[12.5px] font-medium text-white hover:bg-[#1D2E86] disabled:opacity-50"
      onClick={() => {
        setStarted(true);
        startTransition(() => { void action(); });
      }}
    >
      {count === 0 ? "Everyone researched" : `Enrich contacts here (${count})`}
    </button>
  );
}
