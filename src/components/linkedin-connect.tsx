import { unipileConfigured } from "@/lib/env";

export interface LinkedInAccountRow {
  id: string;
  unipileAccountId: string;
  displayName: string | null;
  status: string;
  createdAt: Date;
}

/** Shared "LinkedIn account" UI for /settings and the onboarding wizard.
 *  `friendly` swaps raw status codes and the manual-account-id fallback for
 *  plain-language copy and a security reassurance line — the technical detail
 *  stays available on the settings page, which always renders `friendly=false`. */
export function LinkedInConnect({
  accounts, friendly = false, connected, connectFailed, linkErr,
  connect, claim, link, refresh, disconnect,
}: {
  accounts: LinkedInAccountRow[];
  friendly?: boolean;
  connected?: string;
  connectFailed?: string;
  linkErr?: string;
  connect: () => Promise<void>;
  claim: () => Promise<void>;
  link?: (formData: FormData) => Promise<void>;
  refresh: (accountId: string) => Promise<void>;
  disconnect: (accountId: string) => Promise<void>;
}) {
  const statusLabel = (s: string) =>
    friendly
      ? s === "operational" ? "Connected" : s === "needs_reauth" ? "Needs reauth" : "Connecting…"
      : s === "needs_reauth" ? "needs re-auth" : s;

  return (
    <section className="rounded-[14px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">LinkedIn account</h2>
          <p className="mt-1 text-sm text-[#98A2B3]">
            {friendly
              ? "This is the LinkedIn seat we'll read your network from."
              : "The connected account is used to sync your connections and read the Top-N profiles."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={connect}>
            <button className="rounded-[8px] bg-[#263BAA] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D2E86]">
              Connect LinkedIn
            </button>
          </form>
          {!friendly && (
            <form action={claim}>
              <button type="submit" className="rounded-[8px] border border-[#DDE2EE] bg-white px-4 py-2 text-sm text-[#475467] hover:bg-[#F4F6FB]">
                Refresh from Unipile
              </button>
            </form>
          )}
        </div>
      </div>

      {friendly && (
        <p className="mt-3 text-xs text-[#98A2B3]">
          This uses LinkedIn&apos;s own secure sign-in page — we never see or store your LinkedIn password.
        </p>
      )}

      {connected === "1" && (
        <p className="mt-3 text-sm text-[#067647]">
          {accounts.length > 0
            ? friendly ? "LinkedIn connected." : "LinkedIn seat linked to this workspace."
            : friendly ? "Almost there — give it a few seconds and this page will update." : "Connect finished — if the seat is still missing, wait a few seconds and press Refresh from Unipile."}
        </p>
      )}
      {connectFailed === "1" && (
        <p className="mt-3 text-sm text-[#B42318]">
          {friendly ? "That didn't finish — give Connect LinkedIn another try." : "LinkedIn connect did not finish. Try Connect LinkedIn again."}
        </p>
      )}
      {!friendly && linkErr === "missing" && (
        <p className="mt-3 text-sm text-[#B42318]">Paste the Unipile account id first.</p>
      )}
      {!friendly && linkErr === "unipile" && (
        <p className="mt-3 text-sm text-[#B42318]">Unipile did not recognize that account id. Check it in the Unipile dashboard.</p>
      )}
      {!friendly && accounts.length === 0 && link && (
        <form action={link} className="mt-3 flex flex-wrap items-center gap-2">
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
        {accounts.length === 0 && (
          <li className="p-4 text-sm text-[#98A2B3]">
            {friendly
              ? "Not connected yet. Press Connect LinkedIn above."
              : "No account connected yet. Use Connect LinkedIn, or Refresh from Unipile if the seat already exists in Unipile."}
          </li>
        )}
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-4 p-4 text-sm">
            <div className="min-w-0">
              <p className="tnum truncate text-[#101828]">{a.displayName ?? a.unipileAccountId}</p>
              {!friendly && (
                <p className="tnum mt-0.5 text-xs text-[#98A2B3]">connected {a.createdAt.toISOString().slice(0, 10)}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className={`rounded px-2 py-0.5 text-xs ${
                a.status === "operational" ? "bg-[#EEF1FC] text-[#263BAA]"
                : a.status === "needs_reauth" ? "bg-[#FDF6E7] text-[#B54708]"
                : "bg-[#EEF1FC] text-[#98A2B3]"}`}>
                {statusLabel(a.status)}
              </span>
              {a.status === "needs_reauth" && (
                <form action={connect}>
                  <button className="rounded-[8px] border border-[#DDE2EE] px-3 py-1 text-xs hover:bg-[#F4F6FB]">Reconnect</button>
                </form>
              )}
              {!friendly && (
                <>
                  <form action={refresh.bind(null, a.unipileAccountId)}>
                    <button className="text-xs text-[#98A2B3] hover:text-[#101828]">Refresh</button>
                  </form>
                  <form action={disconnect.bind(null, a.unipileAccountId)}>
                    <button className="text-xs text-[#B42318] hover:text-[#B42318]">Disconnect</button>
                  </form>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!friendly && !unipileConfigured && (
        <p className="mt-3 text-sm text-[#98A2B3]">Running in mock mode — add Unipile keys to go live.</p>
      )}
    </section>
  );
}
