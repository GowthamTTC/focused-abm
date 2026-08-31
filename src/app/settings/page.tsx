import { eq } from "drizzle-orm";
import { db, channelAccount } from "@/db";
import { unipileConfigured } from "@/lib/env";
import { Shell, requirePage } from "@/app/shell";
import { claimLinkedInSeats, disconnect, linkUnipileAccountId, refreshStatus, saveClassifyCap, saveEnrichLimit, scanVoice, startConnect } from "./actions";
import { CLASSIFY_CAP_OPTIONS, ENRICH_LIMIT_OPTIONS, getOrgSettings } from "@/modules/settings/org-settings";
import { getDailyEnrichUsage } from "@/modules/enrich/usage";
import { UsageMeter } from "@/components/usage-meter";
import { env } from "@/lib/env";

function Segmented({ name, options, current, allLabel }: {
  name: string; options: readonly (number | "all")[]; current: number | "all"; allLabel: string;
}) {
  return (
    <div className="inline-flex bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-1">
      {options.map((opt) => (
        <label key={String(opt)}
          className="cursor-pointer rounded-[8px] px-4 py-1.5 text-sm text-[#475467] transition has-[:checked]:bg-[#263BAA] has-[:checked]:font-semibold has-[:checked]:text-white">
          <input type="radio" name={name} value={String(opt)} className="sr-only" defaultChecked={current === opt} />
          {opt === "all" ? allLabel : opt}
        </label>
      ))}
    </div>
  );
}

export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<{ saved?: string; connected?: string; connect_failed?: string; link_err?: string }>;
}) {
  const user = await requirePage();
  const sp = await searchParams;
  const { saved, connected, connect_failed, link_err } = sp;

  // After hosted auth redirect, claim seats even if webhook was missed.
  if (connected === "1") {
    const { claimAccountsForUser } = await import("@/modules/channel/claim");
    await claimAccountsForUser({ orgId: user.orgId, userId: user.userId });
  }

  const accounts = await db.select().from(channelAccount)
    .where(eq(channelAccount.orgId, user.orgId));
  const settings = await getOrgSettings(user.orgId);
  const usage = await getDailyEnrichUsage(user.orgId);

  return (
    <Shell user={user} active="settings">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <h2 className="text-lg font-medium">Run limit</h2>
        <p className="mt-1 max-w-2xl text-sm text-[#98A2B3]">
          Maximum people one deep-enrichment run may process — your spend brake.
          The hard daily ceiling of {env.DEEP_ENRICH_DAILY_CAP}/day always applies on top.
        </p>
        <form action={saveEnrichLimit} className="mt-4 flex flex-wrap items-center gap-3">
          <Segmented name="limit" options={ENRICH_LIMIT_OPTIONS} current={settings.enrichLimit} allLabel="Full list" />
          <button className="rounded-[8px] bg-[#263BAA] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D2E86]">Save</button>
          {saved && <span className="text-sm text-[#98A2B3]">Run limit saved.</span>}
        </form>
        {settings.enrichLimit === "all" && (
          <p className="mt-3 text-sm text-[#B54708]">
            Runs bounded only by the daily cap — intended for the endgame, not week one.
          </p>
        )}
        <p className="mt-4"><UsageMeter used={usage.used} cap={usage.cap} resetsAt={usage.resetsAt} bar /></p>
        <p className="mt-3 text-xs text-[#98A2B3]">
          Echoed in the batch toolbar as a "run limit {settings.enrichLimit === "all" ? "off" : settings.enrichLimit}" tag beside Select top N — links here.
        </p>
      </section>

      <section className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <h2 className="text-lg font-medium">Matching guardrail</h2>
        <p className="mt-1 max-w-2xl text-sm text-[#98A2B3]">
          Maximum people one matching run may send to the AI. Rule-matched people are free and
          uncapped — this only limits the model pass (~25 people per small call). When the cap is
          reached, the rest stay unclassified and the next "Run matching" continues from there.
        </p>
        <form action={saveClassifyCap} className="mt-4 flex flex-wrap items-center gap-3">
          <Segmented name="cap" options={CLASSIFY_CAP_OPTIONS} current={settings.classifyLlmPeopleCap} allLabel="Full pool" />
          <button className="rounded-[8px] bg-[#263BAA] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D2E86]">Save</button>
          {saved && <span className="text-sm text-[#98A2B3]">Run limit saved.</span>}
        </form>
      </section>

      <section className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">LinkedIn account</h2>
            <p className="mt-1 text-sm text-[#98A2B3]">
              The connected account is used to sync your connections and read the Top-N profiles.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={startConnect}>
              <button className="rounded-[8px] bg-[#263BAA] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D2E86]">
                Connect LinkedIn
              </button>
            </form>
            <form action={claimLinkedInSeats}>
              <button type="submit" className="rounded-[8px] border border-[#DDE2EE] bg-white px-4 py-2 text-sm text-[#475467] hover:bg-[#F4F6FB]">
                Refresh from Unipile
              </button>
            </form>
          </div>
        </div>
        {connected === "1" && (
          <p className="mt-3 text-sm text-[#067647]">
            {accounts.length > 0
              ? "LinkedIn seat linked to this workspace."
              : "Connect finished — if the seat is still missing, wait a few seconds and press Refresh from Unipile."}
          </p>
        )}
        {connect_failed === "1" && (
          <p className="mt-3 text-sm text-[#B42318]">LinkedIn connect did not finish. Try Connect LinkedIn again.</p>
        )}
        {link_err === "missing" && (
          <p className="mt-3 text-sm text-[#B42318]">Paste the Unipile account id first.</p>
        )}
        {link_err === "unipile" && (
          <p className="mt-3 text-sm text-[#B42318]">Unipile did not recognize that account id. Check it in the Unipile dashboard.</p>
        )}
        {accounts.length === 0 && (
          <form action={linkUnipileAccountId} className="mt-3 flex flex-wrap items-center gap-2">
            <input
              name="accountId"
              placeholder="Unipile account id (e.g. jmDhZd5GQbCkShVYApi1dw)"
              className="w-72 rounded-[8px] border border-[#DDE2EE] bg-white px-3 py-1.5 text-sm"
            />
            <button className="rounded-[8px] border border-[#DDE2EE] bg-white px-3 py-1.5 text-sm text-[#475467] hover:bg-[#F4F6FB]">
              Link this Unipile seat
            </button>
          </form>
        )}
        <ul className="mt-4 divide-y divide-[#EEF1F8] bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          {accounts.length === 0 && <li className="p-4 text-sm text-[#98A2B3]">No account connected yet. Use Connect LinkedIn, or Refresh from Unipile if the seat already exists in Unipile.</li>}
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4 p-4 text-sm">
              <div className="min-w-0">
                <p className="tnum truncate text-[#101828]">{a.displayName ?? a.unipileAccountId}</p>
                <p className="tnum mt-0.5 text-xs text-[#98A2B3]">connected {a.createdAt.toISOString().slice(0, 10)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className={`rounded px-2 py-0.5 text-xs ${
                  a.status === "operational" ? "bg-[#EEF1FC] text-[#263BAA]"
                  : a.status === "needs_reauth" ? "bg-[#FDF6E7] text-[#B54708]"
                  : "bg-[#EEF1FC] text-[#98A2B3]"}`}>
                  {a.status === "needs_reauth" ? "needs re-auth" : a.status}
                </span>
                {a.status === "needs_reauth" && (
                  <form action={startConnect}>
                    <button className="rounded-[8px] border border-[#DDE2EE] px-3 py-1 text-xs hover:bg-[#F4F6FB]">Reconnect</button>
                  </form>
                )}
                <form action={refreshStatus.bind(null, a.unipileAccountId)}>
                  <button className="text-xs text-[#98A2B3] hover:text-[#101828]">Refresh</button>
                </form>
                <form action={disconnect.bind(null, a.unipileAccountId)}>
                  <button className="text-xs text-[#B42318] hover:text-[#B42318]">Disconnect</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
        {!unipileConfigured && (
          <p className="mt-3 text-sm text-[#98A2B3]">Running in mock mode — add Unipile keys to go live.</p>
        )}
      </section>
      <section className="mt-6 rounded-[14px] border border-[#DDE2EE] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <h2 className="font-medium">Your voice</h2>
        <p className="mt-1 max-w-2xl text-sm text-[#475467]">
          The system reads your last six months of posts and your profile (About, headline) once, distils how you actually write — tone, rhythm,
          phrases, sign-offs — and every drafted message then follows it. Prospects hear you, not a template.
        </p>
        {settings.voiceProfile ? (
          <div className="mt-4 rounded-[10px] border border-[#DDE2EE] bg-[#F4F6FB] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#98A2B3]">
              Current profile · sampled {settings.voiceSampledAt?.slice(0, 10)}
            </p>
            <p className="mt-2 text-sm text-[#475467]">{settings.voiceProfile}</p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[#B54708]">No voice sampled yet — drafts use the house style until you scan.</p>
        )}
        <form action={scanVoice} className="mt-4 flex flex-wrap items-center gap-3">
          <input name="profileUrl" placeholder="optional — leave blank to use your connected account"
            className="w-96 rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-2.5 text-sm" />
          <button className="rounded-[10px] bg-[#263BAA] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
            {settings.voiceProfile ? "Re-scan my voice" : "Scan my voice"}
          </button>
          <span className="text-xs text-[#98A2B3]">Reads your last 6 months of posts + your About section from your connected seat · one light touch</span>
        </form>
      </section>
      <section className="mt-6 rounded-[14px] border border-[#DDE2EE] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <h2 className="font-medium">Password</h2>
        <p className="mt-1 text-sm text-[#475467]">Change the password you sign in with.</p>
        <a href="/change-password"
          className="mt-3 inline-block rounded-[10px] border border-[#DDE2EE] px-4 py-2.5 text-sm text-[#475467] hover:bg-[#F4F6FB]">
          Change password
        </a>
      </section>
    </Shell>
  );
}
