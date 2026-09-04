"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { enqueue } from "@/jobs/runner";
import { planSocialScan, SOCIAL_SCAN_MAX_RUN, socialDays } from "@/modules/posts/feed";

/** Check the next batch of connections nobody has looked at yet.
 *
 *  Same job kind Today uses — activity_scan is bucket-blind, it takes a list of
 *  connection ids and fetches each one's recent posts. Only the PICKER differs
 *  (workspace-wide, 1st degree, any bucket), which is why this needed no runner
 *  change at all. */
export async function scanConnections(formData: FormData) {
  const user = await requireUser();
  const days = socialDays(String(formData.get("days") ?? ""));
  const plan = await planSocialScan(user.orgId, SOCIAL_SCAN_MAX_RUN);
  if (!plan.ok) redirect(`/social?days=${days}&err=${plan.reason}`);
  await enqueue(user.orgId, "activity_scan", { connectionIds: plan.ids });
  redirect(`/social?days=${days}&scanning=1`);
}
