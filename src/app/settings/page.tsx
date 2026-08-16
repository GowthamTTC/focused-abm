import { eq } from "drizzle-orm";
import { db, channelAccount } from "@/db";
import { unipileConfigured } from "@/lib/env";
import { Shell, requirePage } from "@/app/shell";
import { disconnect, refreshStatus, saveClassifyCap, saveEnrichLimit, startConnect } from "./actions";
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

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const user = await requirePage();
  const { saved } = await searchParams;
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
          <form action={startConnect}>
            <button className="rounded-[8px] bg-[#263BAA] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D2E86]">
              Connect LinkedIn
            </button>
          </form>
        </div>
        <ul className="mt-4 divide-y divide-[#EEF1F8] bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          {accounts.length === 0 && <li className="p-4 text-sm text-[#98A2B3]">No account connected yet.</li>}
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
    </Shell>
  );
}
