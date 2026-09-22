"use server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, channelAccount } from "@/db";
import { requireUser } from "@/auth/session";
import { audit } from "@/lib/security/audit";
import { enqueue } from "@/jobs/runner";
import { companyKey } from "@/modules/radar/score";

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
