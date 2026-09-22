import { eq } from "drizzle-orm";
import { db, channelAccount } from "@/db";
import { LinkedInConnect } from "@/components/linkedin-connect";
import { claimLinkedInSeats, disconnect, refreshStatus, startConnect } from "@/app/settings/actions";
import { CONNECT_STEP } from "./progress";
import type { StepQuery } from "./step-services";

const RETURN_TO = `/onboarding/${CONNECT_STEP}`;

export async function StepConnectLinkedin({ orgId, userId, sp }: { orgId: string; userId: string; sp: StepQuery }) {
  // Hosted auth's redirect can beat the webhook back here — claim now so the
  // connected account shows up immediately instead of after a manual refresh.
  if (sp.connected === "1") {
    const { claimAccountsForUser } = await import("@/modules/channel/claim");
    await claimAccountsForUser({ orgId, userId });
  }

  const accounts = await db.select().from(channelAccount).where(eq(channelAccount.orgId, orgId));

  return (
    <div className="space-y-4">
      {sp.err === "needseat" && (
        <p className="rounded-[8px] border border-[#FDA29B] bg-[#FFFBFA] px-3 py-2 text-sm text-[#B42318]">
          Connect LinkedIn here first — the sync step a couple pages ahead reads your network
          through this seat and cannot run without it.
        </p>
      )}
      <LinkedInConnect
        accounts={accounts}
        friendly
        connected={sp.connected}
        connectFailed={sp.connect_failed}
        connect={startConnect.bind(null, RETURN_TO)}
        claim={claimLinkedInSeats.bind(null, RETURN_TO)}
        refresh={refreshStatus}
        disconnect={disconnect}
      />
      <p className="text-sm text-[#98A2B3]">
        Not ready? Press Next to keep going — you can connect LinkedIn any time from Settings.
      </p>
    </div>
  );
}
