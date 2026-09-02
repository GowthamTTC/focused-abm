import { and, eq } from "drizzle-orm";
import { db, channelAccount, service } from "@/db";
import { unipileConfigured } from "@/lib/env";
import { Shell, requirePage } from "@/app/shell";
import { claimLinkedInSeats, disconnect, linkUnipileAccountId, refreshStatus, saveClassifyCap, saveEnrichLimit, saveCatchAll, saveRanking, saveSeller, saveSignals, scanVoice, startConnect } from "./actions";
import { DEFAULT_OFF_ICP_TITLE_SIGNALS, DEFAULT_PEER_COMPANY_SIGNALS } from "@/modules/matching/rule-pass";
import { DEFAULT_FUNCTION_TERMS } from "@/modules/scoring/rank";
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
  searchParams: Promise<{
    saved?: string; connected?: string; connect_failed?: string; link_err?: string; err?: string;
    excluded?: string; released?: string; peered?: string; offt?: string; ranked?: string;
  }>;
}) {
  const user = await requirePage();
  const sp = await searchParams;
  const { saved, connected, connect_failed, link_err } = sp;
  const errCode = sp.err;
  const nExcluded = Number(sp.excluded ?? 0) || 0;
  const nReleased = Number(sp.released ?? 0) || 0;
  const nPeered = Number(sp.peered ?? 0) || 0;
  const nOffT = Number(sp.offt ?? 0) || 0;
  const nRanked = Number(sp.ranked ?? 0) || 0;

  // After hosted auth redirect, claim seats even if webhook was missed.
  if (connected === "1") {
    const { claimAccountsForUser } = await import("@/modules/channel/claim");
    await claimAccountsForUser({ orgId: user.orgId, userId: user.userId });
  }

  const accounts = await db.select().from(channelAccount)
    .where(eq(channelAccount.orgId, user.orgId));
  const settings = await getOrgSettings(user.orgId);
  // undefined means "never configured" — show the defaults that are actually
  // in force, so the box always reflects live behaviour. [] stays empty: off.
  const fnTerms = settings.functionTerms ?? DEFAULT_FUNCTION_TERMS;
  const peerList = settings.peerSignals ?? DEFAULT_PEER_COMPANY_SIGNALS;
  const offList = settings.offIcpSignals ?? DEFAULT_OFF_ICP_TITLE_SIGNALS;
  const services = await db.select({ slug: service.slug, name: service.name }).from(service)
    .where(and(eq(service.orgId, user.orgId), eq(service.status, "active")));
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
          {saved === "1" && <span className="text-sm text-[#98A2B3]">Saved.</span>}
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
          {saved === "1" && <span className="text-sm text-[#98A2B3]">Saved.</span>}
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
        <h2 className="font-medium">Who you are</h2>
        <p className="mt-1 max-w-2xl text-sm text-[#475467]">
          Your firm, in your own words. The company name is used to keep your own colleagues out
          of the target pool, and the description tells the message drafter what it is offering —
          so drafts pitch your services, not somebody else&apos;s.
        </p>
        <form action={saveSeller} className="mt-4 max-w-2xl">
          <label className="block text-xs font-semibold uppercase tracking-wide text-[#98A2B3]">
            Company name
          </label>
          <input name="sellerName" defaultValue={settings.sellerName ?? ""}
            placeholder="e.g. Acme Logistics"
            className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-2.5 text-sm" />
          <p className="mt-1.5 text-xs text-[#98A2B3]">
            Anyone whose company contains this is excluded from matching. Leave blank to exclude nobody.
          </p>

          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[#98A2B3]">
            What you sell
          </label>
          <textarea name="sellerContext" rows={3} defaultValue={settings.sellerContext ?? ""}
            placeholder="e.g. Acme Logistics — fleet telematics for mid-market distributors (route optimisation, driver safety, fuel analytics). Warm, specific, senior voice."
            className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-2.5 text-sm" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="rounded-[10px] bg-[#263BAA] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
              Save
            </button>
            {saved === "seller" && (
              <span className="text-sm text-[#067647]">
                {nExcluded === 0 && nReleased === 0
                  ? "Saved. Nobody matched that company name."
                  : [
                      nExcluded > 0 && `${nExcluded} ${nExcluded === 1 ? "person" : "people"} excluded`,
                      nReleased > 0 && `${nReleased} released for re-matching`,
                    ].filter(Boolean).join(" · ")}
              </span>
            )}
            {!settings.sellerName && (
              <span className="text-xs text-[#B54708]">
                Not set — your own colleagues will show up as targets.
              </span>
            )}
          </div>
        </form>
        <p className="mt-3 text-xs text-[#98A2B3]">
          Saving applies straight away — matching people are excluded on the spot, no reclassify
          needed. Change the name and the previous firm&apos;s staff are released back for
          re-matching. Matching is by substring, so keep the name specific: &ldquo;Ace&rdquo; would
          also catch &ldquo;Aceso Pharma&rdquo;.
        </p>
      </section>

      <section className="mt-6 rounded-[14px] border border-[#DDE2EE] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <h2 className="font-medium">Who ranks highest</h2>
        <p className="mt-1 max-w-2xl text-sm text-[#475467]">
          Ranking decides the order of your whole pool — the top of it is what you actually work.
          Tell it which job titles belong to a buyer, and what a match with each offer is worth.
        </p>
        <form action={saveRanking} className="mt-4 max-w-3xl">
          <label className="block text-xs font-semibold uppercase tracking-wide text-[#98A2B3]">
            Words that mark a buyer&apos;s job title
          </label>
          <p className="mt-1 text-xs text-[#98A2B3]">
            A title containing any of these earns the buyer bonus. The defaults describe a
            marketing firm&apos;s buyer — replace them with yours.
          </p>
          <textarea name="functionTerms" rows={4} defaultValue={fnTerms.join("\n")}
            className="mt-2 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2 font-mono text-xs" />

          <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-[#98A2B3]">
            What each offer is worth
          </label>
          <p className="mt-1 text-xs text-[#98A2B3]">
            0&ndash;40 points added when someone is matched to that offer. Raise the ones you most
            want to sell.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {services.map((s) => (
              <label key={s.slug} className="flex items-center justify-between gap-3 rounded-[10px] border border-[#DDE2EE] px-3 py-2">
                <span className="min-w-0 truncate text-sm text-[#475467]">{s.name}</span>
                <input type="number" name={`w_${s.slug}`} min={0} max={40}
                  defaultValue={settings.serviceWeights?.[s.slug] ?? 0}
                  className="tnum w-16 shrink-0 rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1 text-right text-sm" />
              </label>
            ))}
            {services.length === 0 && (
              <p className="text-sm text-[#B54708]">No offers yet — add some on the ICPs page first.</p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="rounded-[10px] bg-[#263BAA] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
              Save and re-rank
            </button>
            {saved === "ranking" && (
              <span className="text-sm text-[#067647]">{nRanked.toLocaleString()} people re-ranked.</span>
            )}
            <span className="text-xs text-[#98A2B3]">Re-ranking is free — no AI calls.</span>
          </div>
        </form>
      </section>

      <section className="mt-6 rounded-[14px] border border-[#DDE2EE] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <h2 className="font-medium">Fallback service</h2>
        <p className="mt-1 max-w-2xl text-sm text-[#475467]">
          Which offer to suggest when someone is worth pitching but no ICP is a clear match.
          Without one, those people arrive with the Service column blank for you to decide by hand.
        </p>
        <form action={saveCatchAll} className="mt-4 flex flex-wrap items-center gap-3">
          <select name="catchAllSlug" defaultValue={settings.catchAllSlug ?? ""}
            className="rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2.5 text-sm">
            <option value="">No fallback — leave the service blank</option>
            {services.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
          </select>
          <button className="rounded-[10px] bg-[#263BAA] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
            Save
          </button>
          {saved === "catchall" && <span className="text-sm text-[#067647]">Saved.</span>}
          {errCode === "catchall" && (
            <span className="text-sm text-[#B42318]">That offer is no longer in your catalog.</span>
          )}
        </form>
        <p className="mt-3 text-xs text-[#98A2B3]">
          Applies to the next matching run. People already classified keep their service.
        </p>
      </section>

      <section className="mt-6 rounded-[14px] border border-[#DDE2EE] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <h2 className="font-medium">Who is not a prospect</h2>
        <p className="mt-1 max-w-2xl text-sm text-[#475467]">
          Two lists that run <em>before</em> anyone is matched against your ICPs, so they have the
          final say. Keep them describing <strong>your</strong> market — the defaults describe a
          marketing agency&apos;s competitors and will discard good prospects if that is not you.
        </p>
        <form action={saveSignals} className="mt-4 grid gap-5 md:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#98A2B3]">
              Competitor company names
            </label>
            <p className="mt-1 text-xs text-[#98A2B3]">
              A company containing any of these is filed as a peer, not a buyer.
            </p>
            <textarea name="peerSignals" rows={9} defaultValue={peerList.join("\n")}
              className="mt-2 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2 font-mono text-xs" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#98A2B3]">
              Off-target job titles
            </label>
            <p className="mt-1 text-xs text-[#98A2B3]">
              A title containing any of these is an audience, not a buyer.
            </p>
            <textarea name="offIcpSignals" rows={9} defaultValue={offList.join("\n")}
              className="mt-2 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2 font-mono text-xs" />
          </div>
          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <button className="rounded-[10px] bg-[#263BAA] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
              Save and apply
            </button>
            {saved === "signals" && (
              <span className="text-sm text-[#067647]">
                {nPeered === 0 && nOffT === 0 && nReleased === 0
                  ? "Saved. No verdicts changed."
                  : [
                      nPeered > 0 && `${nPeered} filed as peers`,
                      nOffT > 0 && `${nOffT} filed off-target`,
                      nReleased > 0 && `${nReleased} released for re-matching`,
                    ].filter(Boolean).join(" · ")}
              </span>
            )}
            <span className="text-xs text-[#98A2B3]">
              One per line. Matched as substrings of the normalised text, so &ldquo;advertis&rdquo;
              catches advertising and advertisement. Empty box = rule off.
            </span>
          </div>
        </form>
        <p className="mt-3 text-xs text-[#98A2B3]">
          Applies straight away, both ways: people who now match are re-filed, and people these
          rules previously filed who no longer match are released for the next matching run.
          Verdicts the model made on other grounds are left alone.
        </p>
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
