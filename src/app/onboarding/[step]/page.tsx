import { redirect } from "next/navigation";
import { moveStep } from "../actions";
import { requireSetupUser } from "../guard";
import { CONNECT_STEP, DASHBOARD_STEP, ENRICH_STEP, ICP_STEP, LAST_STEP, SERVICES_STEP, STEPS, SYNC_STEP, VOICE_STEP, clampStep } from "../progress";
import { StepIndicator } from "../steps";
import { StepServices, type StepQuery } from "../step-services";
import { StepIcp } from "../step-icp";
import { StepConnectLinkedin } from "../step-connect-linkedin";
import { StepVoice } from "../step-voice";
import { StepSync } from "../step-sync";
import { StepDashboard } from "../step-dashboard";
import { StepEnrich } from "../step-enrich";

export default async function OnboardingStepPage({ params, searchParams }: {
  params: Promise<{ step: string }>;
  searchParams: Promise<StepQuery>;
}) {
  const user = await requireSetupUser();
  const { step } = await params;
  const sp = await searchParams;
  const n = clampStep(step);
  const reached = user.onboardingStep;
  if (n > reached + 1) redirect(`/onboarding/${clampStep(reached + 1)}`);

  const meta = STEPS[n - 1];
  const isLast = n === LAST_STEP;

  return (
    <div>
      <StepIndicator current={n} reached={reached} />
      <h2 className="mt-8 text-xl font-semibold text-[#101828]">{meta.title}</h2>
      <p className="mt-2 text-sm text-[#475467]">{meta.blurb}</p>

      <div className="mt-6">
        {n === SERVICES_STEP ? (
          <StepServices orgId={user.orgId} sp={sp} />
        ) : n === ICP_STEP ? (
          <StepIcp orgId={user.orgId} sp={sp} />
        ) : n === CONNECT_STEP ? (
          <StepConnectLinkedin orgId={user.orgId} userId={user.userId} sp={sp} />
        ) : n === VOICE_STEP ? (
          <StepVoice orgId={user.orgId} sp={sp} />
        ) : n === SYNC_STEP ? (
          <StepSync orgId={user.orgId} sp={sp} />
        ) : n === DASHBOARD_STEP ? (
          <StepDashboard orgId={user.orgId} />
        ) : n === ENRICH_STEP ? (
          <StepEnrich orgId={user.orgId} />
        ) : (
          <div className="rounded-[10px] border border-[#DDE2EE] bg-[#F6F7FB] p-6 text-sm text-[#475467]">
            {n === 1 ? (
              <>
                <p className="font-medium text-[#101828]">You&apos;re in, {user.name}.</p>
                <p className="mt-2">
                  The next steps teach the system what you sell, who you sell to, and how you write —
                  so the daily list it hands you is yours rather than generic. Nothing here is
                  irreversible; everything stays editable in Settings afterwards.
                </p>
              </>
            ) : (
              <p>Coming in a later phase.</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between gap-4">
        <form action={moveStep}>
          <input type="hidden" name="from" value={n} />
          <input type="hidden" name="dir" value="back" />
          <button disabled={n === 1}
            className="rounded-[10px] border border-[#DDE2EE] bg-white px-5 py-2.5 text-sm font-medium text-[#475467] hover:text-[#101828] disabled:opacity-40">
            Back
          </button>
        </form>
        <form action={moveStep}>
          <input type="hidden" name="from" value={n} />
          <input type="hidden" name="dir" value="next" />
          <button className="rounded-[10px] bg-[#263BAA] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
            {isLast ? "Finish setup" : "Next"}
          </button>
        </form>
      </div>

      <p className="mt-4 text-xs text-[#98A2B3]">Step {n} of {LAST_STEP}</p>
    </div>
  );
}
