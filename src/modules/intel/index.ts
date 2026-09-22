/**
 * ABM Intelligence — the orchestrator.
 *
 * Two steps, and they are separate on purpose: the search costs LinkedIn
 * requests and the judge costs model calls, so a scan that finds nothing never
 * reaches the model, and a re-judge never re-hits LinkedIn.
 */
import { judgeSignals } from "@/modules/pulse/judge";
import { scanCompanyPosts, type IntelWindow } from "@/modules/intel/scan";

export interface IntelRunResult {
  seen: number;
  stored: number;
  pages: number;
  capped: boolean;
  judged: number;
  calls: number;
  failed: number;
}

/** Called only from the worker — it talks to LinkedIn and bills the model, so
 *  nothing in the request path may call it. */
export async function runIntelScan(
  orgId: string,
  companyKey: string,
  companyName: string,
  opts: { window?: IntelWindow; limit?: number; keywords?: string } = {},
  onProgress?: (done: number, total: number) => Promise<void>,
): Promise<IntelRunResult> {
  const scan = await scanCompanyPosts(orgId, companyKey, companyName, opts, onProgress);

  // Nothing stored means nothing to read. Returning here keeps a dry scan free.
  if (scan.stored === 0) {
    return { ...scan, judged: 0, calls: 0, failed: 0 };
  }

  const judged = await judgeSignals(orgId, companyKey, { kind: "linkedin" });
  return { ...scan, judged: judged.judged, calls: judged.calls, failed: judged.failed };
}
