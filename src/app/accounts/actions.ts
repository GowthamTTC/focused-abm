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
