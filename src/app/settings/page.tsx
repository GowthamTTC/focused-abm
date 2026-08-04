import { eq } from "drizzle-orm";
import { db, channelAccount } from "@/db";
import { unipileConfigured } from "@/lib/env";
import { Shell, requirePage } from "@/app/shell";
import { disconnect, refreshStatus, saveEnrichLimit, startConnect } from "./actions";
import { ENRICH_LIMIT_OPTIONS, getOrgSettings } from "@/modules/settings/org-settings";
import { env } from "@/lib/env";

export default async function SettingsPage() {
  const user = await requirePage();
  const accounts = await db.select().from(channelAccount)
    .where(eq(channelAccount.orgId, user.orgId));
  const settings = await getOrgSettings(user.orgId);

  return (
    <Shell user={user} active="settings">
      <h1 className="text-xl font-semibold">Settings</h1>
      <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">LinkedIn account</h2>
            <p className="mt-1 text-sm text-neutral-500">
              The connected account is used to sync your connections and read the Top-N profiles.
              {!unipileConfigured && " Running in MOCK mode — add UNIPILE keys to go live."}
            </p>
          </div>
          <form action={startConnect}>
            <button className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700">
              Connect LinkedIn
            </button>
          </form>
        </div>
        <ul className="mt-4 divide-y divide-neutral-100">
          {accounts.length === 0 && <li className="py-3 text-sm text-neutral-500">No account connected yet.</li>}
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-3 text-sm">
              <div>
                <span className="font-medium">{a.displayName ?? a.unipileAccountId}</span>
                <span className={`ml-3 rounded-full px-2 py-0.5 text-xs ${
                  a.status === "operational" ? "bg-green-100 text-green-800"
                  : a.status === "needs_reauth" ? "bg-amber-100 text-amber-800"
                  : "bg-neutral-200 text-neutral-600"}`}>{a.status}</span>
              </div>
              <div className="flex gap-2">
                <form action={refreshStatus.bind(null, a.unipileAccountId)}>
                  <button className="text-xs text-neutral-500 hover:text-neutral-900">Refresh</button>
                </form>
                <form action={disconnect.bind(null, a.unipileAccountId)}>
                  <button className="text-xs text-red-500 hover:text-red-700">Disconnect</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="font-medium">Enrichment guardrail</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Maximum people ONE deep-enrichment run may process. Each person costs two model
          calls and ~40s of paced LinkedIn reads — this cap is your spend brake.
          The hard daily ceiling of {env.DEEP_ENRICH_DAILY_CAP}/day always applies on top.
        </p>
        <form action={saveEnrichLimit} className="mt-4 flex flex-wrap items-center gap-2">
          {ENRICH_LIMIT_OPTIONS.map((opt) => (
            <label key={String(opt)} className={`cursor-pointer rounded border px-3 py-1.5 text-sm has-[:checked]:border-neutral-900 has-[:checked]:bg-neutral-900 has-[:checked]:text-white ${"border-neutral-300"}`}>
              <input type="radio" name="limit" value={String(opt)} className="sr-only"
                defaultChecked={settings.enrichLimit === opt} />
              {opt === "all" ? "Full list" : opt}
            </label>
          ))}
          <button className="ml-2 rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700">Save</button>
        </form>
        {settings.enrichLimit === "all" && (
          <p className="mt-3 text-xs text-amber-700">
            Full list: runs are bounded only by the {env.DEEP_ENRICH_DAILY_CAP}/day cap — a 4,500-person
            pool means multi-week processing and real model spend. Intended for the endgame, not week one.
          </p>
        )}
      </section>
    </Shell>
  );
}
