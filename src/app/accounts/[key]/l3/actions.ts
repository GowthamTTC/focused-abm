"use server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, channelAccount } from "@/db";
import { requireUser } from "@/auth/session";
import { audit } from "@/lib/security/audit";
import { enqueue } from "@/jobs/runner";
import { companyKey } from "@/modules/radar/score";
import { getOrgSettings } from "@/modules/settings/org-settings";
import { DEFAULT_TRIGGERS } from "@/modules/accounts/trigger-vocab";

/** Re-scan LinkedIn for the focused unit. Spends, so it is a deliberate press. */
export async function refreshFocusSignals(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "").trim();
  const focus = String(formData.get("focus") ?? "").trim();
  const back = `/accounts/${encodeURIComponent(key)}/l3?focus=${encodeURIComponent(focus)}`;
  if (!focus) redirect(back);

  const [seat] = await db.select({ id: channelAccount.id }).from(channelAccount).where(and(
    eq(channelAccount.orgId, user.orgId),
    eq(channelAccount.status, "operational"),
  ));
  if (!seat) redirect(`${back}&queued=0`);

  await enqueue(user.orgId, "intel_scan", {
    companyKey: companyKey(focus), companyName: focus, window: "past_month",
  });
  await audit(user.orgId, user.email, "intel.scan", { key, focus, via: "l3" });
  redirect(`${back}&queued=1`);
}


/** Scan LinkedIn once per trigger phrase. The vocabulary that scores an account
 *  is the same one that collects for it — a phrase nobody ever searches cannot
 *  score, and a phrase that scores without being searched is a coincidence. */
export async function scanTriggerVocabulary(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "").trim();
  const focus = String(formData.get("focus") ?? "").trim();
  const back = `/accounts/${encodeURIComponent(key)}/l3?focus=${encodeURIComponent(focus)}`;
  const subject = focus || key;

  const [seat] = await db.select({ id: channelAccount.id }).from(channelAccount).where(and(
    eq(channelAccount.orgId, user.orgId),
    eq(channelAccount.status, "operational"),
  ));
  if (!seat) redirect(`${back}&queued=0`);

  const settings = await getOrgSettings(user.orgId);
  const vocab = settings.triggerSignals ?? DEFAULT_TRIGGERS;
  for (const t of vocab) {
    await enqueue(user.orgId, "intel_scan", {
      companyKey: companyKey(subject),
      companyName: subject,
      keywords: `${subject} ${t.phrase}`,
      window: "past_month",
    });
  }
  await audit(user.orgId, user.email, "intel.scan.vocabulary", { key, focus, phrases: vocab.length });
  redirect(`${back}&queued=${vocab.length}`);
}
