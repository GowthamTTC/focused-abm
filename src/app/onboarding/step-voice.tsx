import { and, desc, eq } from "drizzle-orm";
import { db, channelAccount, job as jobTable } from "@/db";
import { getOrgSettings } from "@/modules/settings/org-settings";
import { scanVoice } from "@/app/settings/actions";
import { LiveJob } from "@/components/live-job";
import { saveVoiceDiagnostic, saveVoiceProfileText } from "./actions";
import { VOICE_STEP } from "./progress";
import type { StepQuery } from "./step-services";

const RETURN_TO = `/onboarding/${VOICE_STEP}`;
// A real sample reads as a couple of sentences; anything shorter is not
// enough for the drafter to imitate, whether it came from a short scan or
// was never written at all.
const THIN_WORD_MIN = 12;

function isThin(profile: string | undefined | null): boolean {
  if (!profile) return true;
  return profile.trim().split(/\s+/).filter(Boolean).length < THIN_WORD_MIN;
}

export async function StepVoice({ orgId, sp }: { orgId: string; sp: StepQuery }) {
  const settings = await getOrgSettings(orgId);
  const accounts = await db.select().from(channelAccount).where(eq(channelAccount.orgId, orgId));
  const hasSeat = accounts.some((a) => a.status === "operational");
  const [latest] = await db.select().from(jobTable)
    .where(and(eq(jobTable.orgId, orgId), eq(jobTable.kind, "voice_scan")))
    .orderBy(desc(jobTable.createdAt)).limit(1);
  const running = latest && ["queued", "running", "stopping"].includes(latest.status) ? latest : null;
  const scanFailed = latest?.status === "failed";
  const thin = isThin(settings.voiceProfile);

  return (
    <div className="space-y-5">
      {sp.err === "voicethin" && (
        <p className="rounded-[8px] border border-[#FDA29B] bg-[#FFFBFA] px-3 py-2 text-sm text-[#B42318]">
          Answer a couple more of the questions below — there is not enough there yet to draft from.
        </p>
      )}
      {sp.err === "voiceempty" && (
        <p className="rounded-[8px] border border-[#FDA29B] bg-[#FFFBFA] px-3 py-2 text-sm text-[#B42318]">
          That box cannot be saved empty.
        </p>
      )}
      {sp.voicesaved === "1" && (
        <p className="rounded-[8px] border border-[#A6E9C2] bg-[#F2FBF6] px-3 py-2 text-sm text-[#067647]">
          Saved.
        </p>
      )}

      <div className="rounded-[10px] border border-[#DDE2EE] bg-[#F6F7FB] p-6">
        <p className="text-sm text-[#475467]">
          We read your last six months of LinkedIn posts and your About section once, and distil
          how you actually write — tone, rhythm, phrases, sign-offs. Every drafted outreach message
          then follows it, so prospects hear you, not a template.
        </p>
      </div>

      {running && (
        <div className="rounded-[10px] border border-[#DDE2EE] bg-white p-4">
          <LiveJob label="Sampling voice"
            initial={{ id: latest.id, kind: latest.kind, status: latest.status, progress: latest.progress, total: latest.total }} />
        </div>
      )}

      {!running && settings.voiceProfile && (
        <div className="rounded-[10px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#98A2B3]">
            Current profile{settings.voiceSampledAt ? ` · sampled ${settings.voiceSampledAt.slice(0, 10)}` : ""}
          </p>
          <form action={saveVoiceProfileText} className="mt-2">
            <textarea name="voiceProfile" rows={4} defaultValue={settings.voiceProfile}
              className="w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-2.5 text-sm text-[#475467]" />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button className="rounded-[10px] bg-[#263BAA] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
                Save edits
              </button>
              {thin && (
                <span className="text-xs text-[#B54708]">
                  This reads thin — a re-scan or the 5 questions below will sharpen it.
                </span>
              )}
            </div>
          </form>
        </div>
      )}

      {!running && (
        <div className="rounded-[10px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[#101828]">
                {hasSeat ? "Scan your posts" : "LinkedIn is not connected"}
              </p>
              <p className="mt-1 text-sm text-[#475467]">
                {hasSeat
                  ? "One light read of your own profile — no posting, liking, or connecting."
                  : "Scanning needs the LinkedIn seat from the previous step. Connect it, or answer the questions below instead."}
              </p>
            </div>
            {hasSeat && (
              <form action={scanVoice.bind(null, RETURN_TO)}>
                <button className="rounded-[10px] bg-[#263BAA] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
                  {settings.voiceProfile ? "Re-scan my voice" : "Scan my voice"}
                </button>
              </form>
            )}
          </div>
          {scanFailed && (
            <p className="mt-3 text-sm text-[#B42318]">
              The last scan did not finish. Try again, or use the 5 questions below.
            </p>
          )}
        </div>
      )}

      {!running && (thin || scanFailed) && (
        <details className="rounded-[10px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]"
          open={!hasSeat || scanFailed}>
          <summary className="cursor-pointer text-sm font-medium text-[#101828]">
            Answer 5 quick questions instead
          </summary>
          <form action={saveVoiceDiagnostic} className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#98A2B3]">
                1. How would you describe your tone?
              </label>
              <input name="tone" placeholder="e.g. warm, direct, a little dry"
                className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#98A2B3]">
                2. Casual, neutral, or formal?
              </label>
              <input name="formality" placeholder="e.g. neutral, leans casual"
                className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#98A2B3]">
                3. Phrases or sign-offs you actually use
              </label>
              <input name="phrases" placeholder="e.g. opens with a specific compliment, signs off 'Cheers,'"
                className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#98A2B3]">
                4. What should drafts avoid?
              </label>
              <input name="avoid" placeholder="e.g. exclamation marks, corporate jargon, emoji"
                className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#98A2B3]">
                5. Who are you usually writing to?
              </label>
              <input name="audience" placeholder="e.g. VP-level buyers who don't know me yet"
                className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-2.5 text-sm" />
            </div>
            <button className="rounded-[10px] bg-[#263BAA] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
              Save these as my voice profile
            </button>
          </form>
        </details>
      )}

      <p className="text-sm text-[#98A2B3]">
        Not ready? Press Next to keep going — outreach drafts use a generic tone until this is
        done, which you can finish any time from Settings.
      </p>
    </div>
  );
}
