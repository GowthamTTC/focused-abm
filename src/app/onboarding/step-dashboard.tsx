import Link from "next/link";
import { orgReasonSummary } from "@/modules/posts/feed";

/** Step 7 — not a second dashboard. Everything this step needs already lives
 *  on /dashboard; this is a preview of what setup handed off, plus the door
 *  to walk through. Nothing here is a gate — Next moves on regardless. */
export async function StepDashboard({ orgId }: { orgId: string }) {
  const reasons = await orgReasonSummary(orgId);

  return (
    <div className="space-y-5">
      <div className="rounded-[10px] border border-[#DDE2EE] bg-[#F6F7FB] p-6">
        <p className="text-sm text-[#475467]">
          This is what the rest of setup was for. Every day, the dashboard opens on people who said
          something in public you can genuinely reply to — matched against the ICPs you defined,
          ranked by how strong the post is and how fresh it still is. Below that sits a queue to
          research more people at once, and the raw pipeline numbers if you want them. Nothing here
          needs any more setup from you.
        </p>
      </div>

      <div className="rounded-[10px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <p className="text-sm font-medium text-[#101828]">Where things stand right now</p>
        <p className="tnum mt-2 text-sm text-[#475467]">
          {reasons.pitchable.toLocaleString()} {reasons.pitchable === 1 ? "person matches" : "people match"} your
          ICPs so far
          {reasons.everScanned > 0 && `, ${reasons.everScanned.toLocaleString()} already scanned for posts`}.{" "}
          {reasons.people > 0
            ? `${reasons.people.toLocaleString()} of them already ${reasons.people === 1 ? "has" : "have"} a fresh reason to reach out waiting for you there.`
            : reasons.everScanned > 0
              ? "None of them have a fresh, on-target post right now — that fills in as scans run and people post."
              : "Scans haven't started yet — the dashboard has a button for that, and this fills in from there."}
        </p>
        <Link href="/dashboard" target="_blank" rel="noreferrer"
          className="mt-4 inline-block rounded-[10px] bg-[#263BAA] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
          Open the dashboard ↗
        </Link>
        <p className="mt-2 text-xs text-[#98A2B3]">Opens in a new tab — Next below still moves you through setup.</p>
      </div>
    </div>
  );
}
