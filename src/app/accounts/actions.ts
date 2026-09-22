"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import {
  enrichOneAccount,
  enrichOnePerson,
  enrichShortlistedAccounts,
  toggleShortlist,
} from "@/modules/accounts/shortlist";
import { audit } from "@/lib/security/audit";
import { enqueue } from "@/jobs/runner";
import { db, job } from "@/db";
import { and, eq, inArray } from "drizzle-orm";

function accountsReturn(opts: { view?: string; a?: string; extra?: Record<string, string> }) {
  const qs = new URLSearchParams();
  if (opts.view === "shortlist") qs.set("view", "shortlist");
  if (opts.a) qs.set("a", opts.a);
  for (const [k, v] of Object.entries(opts.extra ?? {})) {
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `/accounts?${s}` : "/accounts";
}

export async function setAccountShortlist(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "");
  const name = String(formData.get("name") ?? "");
  const on = String(formData.get("on") ?? "") === "1";
  const view = String(formData.get("view") ?? "");
  await toggleShortlist(user.orgId, key, name, on);
  redirect(accountsReturn({ view, a: key }));
}

/** Client-friendly shortlist toggle (optimistic UI). */
export async function setAccountShortlistState(
  key: string,
  name: string,
  view: string,
  on: boolean,
) {
  const user = await requireUser();
  await toggleShortlist(user.orgId, key, name, on);
  redirect(accountsReturn({ view, a: key }));
}

export async function startEnrichShortlist() {
  const user = await requireUser();
  const result = await enrichShortlistedAccounts(user.orgId);
  await audit(user.orgId, user.email, "enrich.shortlist", result);
  redirect(`/accounts?view=shortlist&enriched=${result.people}`);
}

/** Enrich top seats on this one account. Shortlists it if it is not already. */
export async function enrichThisAccount(key: string, name: string, view: string) {
  const user = await requireUser();
  await toggleShortlist(user.orgId, key, name, true);
  const result = await enrichOneAccount(user.orgId, key);
  await audit(user.orgId, user.email, "enrich.account", { key, ...result });
  redirect(accountsReturn({ view, a: key, extra: { enriched: String(result.people) } }));
}

/** Enrich one contact from the account card. */
export async function enrichThisPerson(connId: string, key: string, view: string) {
  const user = await requireUser();
  const ok = await enrichOnePerson(user.orgId, connId);
  await audit(user.orgId, user.email, "enrich.person", { connId, ok });
  redirect(accountsReturn({
    view,
    a: key,
    extra: { enriched: ok ? "1" : "0", p: connId },
  }));
}

/** Queue a Pulse refresh for one account.
 *
 *  Shortlisting first is not a convenience: a refresh fetches the web and makes
 *  two model calls, so it should follow a deliberate act rather than a stray
 *  click on a list of several thousand companies. Starring is that act, and
 *  enrichThisAccount above already sets the same precedent.
 */
export async function refreshAccountPulse(key: string, name: string, view: string) {
  const user = await requireUser();
  await toggleShortlist(user.orgId, key, name, true);
  // One at a time, workspace-wide. The queue is shared and a Pulse run is short,
  // so a queue of them would mostly be a way to spend the model budget by
  // holding down a button.
  const [busy] = await db.select({ id: job.id }).from(job)
    .where(and(eq(job.orgId, user.orgId), inArray(job.status, ["queued", "running", "stopping"])))
    .limit(1);
  if (busy) redirect(accountsReturn({ view, a: key, extra: { pulse: "busy" } }));
  await enqueue(user.orgId, "account_pulse", { companyKey: key, companyName: name });
  await audit(user.orgId, user.email, "pulse.refresh", { key });
  redirect(accountsReturn({ view, a: key, extra: { pulse: "queued" } }));
}
