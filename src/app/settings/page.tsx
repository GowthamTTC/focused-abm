import { eq } from "drizzle-orm";
import { db, channelAccount } from "@/db";
import { unipileConfigured } from "@/lib/env";
import { Shell, requirePage } from "@/app/shell";
import { disconnect, refreshStatus, saveClassifyCap, saveEnrichLimit, startConnect } from "./actions";
import { CLASSIFY_CAP_OPTIONS, ENRICH_LIMIT_OPTIONS, getOrgSettings } from "@/modules/settings/org-settings";
import { env } from "@/lib/env";

export default async function SettingsPage() {
  const user = await requirePage();
  const accounts = await db.select().from(channelAccount)
    .where(eq(channelAccount.orgId, user.orgId));
  const settings = await getOrgSettings(user.orgId);

  return (
    <Shell user={user} active="settings">
      <h1 className="text-xl font-semibold">Settings</h1>
      <section className="mt-6 rounded-[18px] border border-white/10 bg-[#1F2329] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">LinkedIn account</h2>
            <p className="mt-1 text-sm text-white/55">
              The connected account is used to sync your connections and read the Top-N profiles.
              {!unipileConfigured && " Running in MOCK mode — add UNIPILE keys to go live."}
            </p>
          </div>
          <form action={startConnect}>
            <button className="rounded bg-[#B6FF2E] px-3 py-2 text-sm font-medium text-[#16191E] hover:bg-[#9FE51F]">
              Connect LinkedIn
            </button>
          </form>
        </div>
        <ul className="mt-4 divide-y divide-white/5">
          {accounts.length === 0 && <li className="py-3 text-sm text-white/55">No account connected yet.</li>}
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-3 text-sm">
              <div>
                <span className="font-medium">{a.displayName ?? a.unipileAccountId}</span>
                <span className={`ml-3 rounded-full px-2 py-0.5 text-xs ${
                  a.status === "operational" ? "bg-[#B6FF2E]/15 text-[#B6FF2E]"
                  : a.status === "needs_reauth" ? "bg-[#B6FF2E]/15 text-[#CFFF66]"
                  : "bg-white/15 text-white/70"}`}>{a.status}</span>
              </div>
              <div className="flex gap-2">
                <form action={refreshStatus.bind(null, a.unipileAccountId)}>
                  <button className="text-xs text-white/55 hover:text-[#E8EAF0]">Refresh</button>
                </form>
                <form action={disconnect.bind(null, a.unipileAccountId)}>
                  <button className="text-xs text-red-400 hover:text-red-300">Disconnect</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-[18px] border border-white/10 bg-[#1F2329] p-5">
        <h2 className="font-medium">Enrichment guardrail</h2>
        <p className="mt-1 text-sm text-white/55">
          Maximum people ONE deep-enrichment run may process. Each person costs two model
          calls and ~40s of paced LinkedIn reads — this cap is your spend brake.
          The hard daily ceiling of {env.DEEP_ENRICH_DAILY_CAP}/day always applies on top.
        </p>
        <form action={saveEnrichLimit} className="mt-4 flex flex-wrap items-center gap-2">
          {ENRICH_LIMIT_OPTIONS.map((opt) => (
            <label key={String(opt)} className={`cursor-pointer rounded border px-3 py-1.5 text-sm has-[:checked]:border-[#B6FF2E] has-[:checked]:bg-[#B6FF2E] has-[:checked]:text-[#16191E] ${"border-white/15"}`}>
              <input type="radio" name="limit" value={String(opt)} className="sr-only"
                defaultChecked={settings.enrichLimit === opt} />
              {opt === "all" ? "Full list" : opt}
            </label>
          ))}
          <button className="ml-2 rounded bg-[#B6FF2E] px-3 py-1.5 text-sm font-medium text-[#16191E] hover:bg-[#9FE51F]">Save</button>
        </form>
        {settings.enrichLimit === "all" && (
          <p className="mt-3 text-xs text-[#B6FF2E]">
            Full list: runs are bounded only by the {env.DEEP_ENRICH_DAILY_CAP}/day cap — a 4,500-person
            pool means multi-week processing and real model spend. Intended for the endgame, not week one.
          </p>
        )}
      </section>

      <section className="mt-6 rounded-[18px] border border-white/10 bg-[#1F2329] p-5">
        <h2 className="font-medium">Matching guardrail</h2>
        <p className="mt-1 text-sm text-white/55">
          Maximum people ONE matching run may send to the AI. Rule-matched people are
          free and uncapped — this only limits the model pass (~25 people per small
          call). When the cap is reached, the rest stay unclassified and the next
          "Run matching" continues from where it stopped.
        </p>
        <form action={saveClassifyCap} className="mt-4 flex flex-wrap items-center gap-2">
          {CLASSIFY_CAP_OPTIONS.map((opt) => (
            <label key={String(opt)} className={`cursor-pointer rounded border px-3 py-1.5 text-sm has-[:checked]:border-[#B6FF2E] has-[:checked]:bg-[#B6FF2E] has-[:checked]:text-[#16191E] ${"border-white/15"}`}>
              <input type="radio" name="cap" value={String(opt)} className="sr-only"
                defaultChecked={settings.classifyLlmPeopleCap === opt} />
              {opt === "all" ? "Full pool" : opt}
            </label>
          ))}
          <button className="ml-2 rounded bg-[#B6FF2E] px-3 py-1.5 text-sm font-medium text-[#16191E] hover:bg-[#9FE51F]">Save</button>
        </form>
      </section>
    </Shell>
  );
}
