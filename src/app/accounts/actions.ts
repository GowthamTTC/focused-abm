"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import {
  enrichShortlistedAccounts,
  toggleShortlist,
} from "@/modules/accounts/shortlist";
import { audit } from "@/lib/security/audit";

export async function setAccountShortlist(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "");
  const name = String(formData.get("name") ?? "");
  const on = String(formData.get("on") ?? "") === "1";
  const view = String(formData.get("view") ?? "");
  await toggleShortlist(user.orgId, key, name, on);
  const qs = new URLSearchParams();
  if (view === "shortlist") qs.set("view", "shortlist");
  if (key) qs.set("a", key);
  redirect(`/accounts?${qs.toString()}`);
}

export async function startEnrichShortlist() {
  const user = await requireUser();
  const result = await enrichShortlistedAccounts(user.orgId);
  await audit(user.orgId, user.email, "enrich.shortlist", result);
  redirect(`/accounts?view=shortlist&enriched=${result.people}`);
}
