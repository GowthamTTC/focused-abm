"use client";
import { useState } from "react";

/** Export confirmation card (design 1h): tab-count preview, provenance legend,
 *  Ops-tab toggle with its warning, then the actual download. */
export function ExportCard({ batchId, topN, targetPool, review, peers }: {
  batchId: string; topN: number; targetPool: number; review: number; peers: number;
}) {
  const [open, setOpen] = useState(false);
  const [ops, setOps] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-emerald-400/50 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20">
        Export workbook
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl glass border-0 p-5"
            onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Export workbook</h2>
            <div className="mt-4 rounded-xl glass border-0 p-4 text-sm">
              {([["Instructions", "—"], [`Top ${topN || "N"}`, topN || "—"], ["Target Pool", targetPool.toLocaleString()], ["Review", review.toLocaleString()], ["Peers", peers.toLocaleString()]] as const)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1">
                    <span className="text-[#46506E]/70">{k}</span>
                    <span className="tnum text-[#14204A]">{v}</span>
                  </div>
                ))}
              {ops && (
                <div className="flex justify-between py-1">
                  <span className="text-[#46506E]/70">Ops</span>
                  <span className="tnum text-[#46506E]/55">full diagnostics</span>
                </div>
              )}
            </div>
            <p className="mt-3 flex items-center gap-4 text-xs text-[#46506E]/55">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-white/25" /> Grey = matched from metadata</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#B54708]" /> Amber = read from profile</span>
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm">
              <input type="checkbox" checked={ops} onChange={(e) => setOps(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#263BAA]" />
              <span>
                Include Ops tab (internal diagnostics)
                <span className="mt-0.5 block text-xs text-[#46506E]/45">
                  Score breakdowns, confidence, provenance, enrichment status. For internal QA — remove before sharing externally.
                </span>
              </span>
            </label>
            <a href={`/api/export/${batchId}${ops ? "?ops=1" : ""}`} onClick={() => setOpen(false)}
              className="mt-5 block rounded-xl bg-emerald-400 py-3 text-center text-sm font-semibold text-[#14204A] hover:bg-emerald-300">
              Download .xlsx
            </a>
          </div>
        </div>
      )}
    </>
  );
}
