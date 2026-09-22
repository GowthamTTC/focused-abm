"use server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, channelAccount } from "@/db";
import { requireUser } from "@/auth/session";
import { audit } from "@/lib/security/audit";
import { enqueue } from "@/jobs/runner";
import { companyKey } from "@/modules/radar/score";

const WINDOWS = new Set(["past_day", "past_week", "past_month"]);

/** Queue a scan. The worker does the work — this only decides that it is worth
 *  doing, because the scan spends LinkedIn requests and model calls. */
export async function startIntelScan(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("company") ?? "").trim();
  if (!name) redirect("/intel?err=Enter+a+company+name");

  const key = companyKey(name);
  if (key === "_none") redirect("/intel?err=That+is+not+a+company+name");

  // Fail here rather than inside the worker: a job that dies on "no seat" looks
  // like a broken feature, and the person who can fix it is reading this page.
  const [seat] = await db.select({ id: channelAccount.id }).from(channelAccount).where(and(
    eq(channelAccount.orgId, user.orgId),
    eq(channelAccount.status, "operational"),
  ));
  if (!seat) redirect("/intel?err=Connect+a+LinkedIn+account+in+Settings+first");

  const windowRaw = String(formData.get("window") ?? "past_month");
  const window = WINDOWS.has(windowRaw) ? windowRaw : "past_month";

  await enqueue(user.orgId, "intel_scan", { companyKey: key, companyName: name, window });
  await audit(user.orgId, user.email, "intel.scan", { key, window });
  redirect(`/intel?c=${encodeURIComponent(key)}&n=${encodeURIComponent(name)}&queued=1`);
}
