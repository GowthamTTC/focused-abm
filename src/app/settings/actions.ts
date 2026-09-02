"use server";
import { redirect } from "next/navigation";
import { updateOrgSettings } from "@/modules/settings/org-settings";
import { eq } from "drizzle-orm";
import { db, channelAccount } from "@/db";
import { env } from "@/lib/env";
import { requireUser } from "@/auth/session";
import { enqueue } from "@/jobs/runner";
import { getChannelProvider } from "@/providers/channel";

export async function startConnect() {
  const user = await requireUser();
  const { markConnectStarted } = await import("@/modules/channel/claim");
  await markConnectStarted(user.orgId, user.userId);
  // Put token in query — Unipile notify often cannot send custom headers.
  const secret = env.WEBHOOK_SECRET;
  const notifyUrl = secret
    ? `${env.APP_URL}/api/webhooks/unipile?token=${encodeURIComponent(secret)}`
    : `${env.APP_URL}/api/webhooks/unipile`;
  const { url } = await getChannelProvider().createHostedAuthLink({
    userRef: user.userId,
    successRedirectUrl: `${env.APP_URL}/settings?connected=1`,
    failureRedirectUrl: `${env.APP_URL}/settings?connect_failed=1`,
    notifyUrl,
  });
  redirect(url);
}

/** Post-connect / recovery: pull Unipile seats and attach to this org. */
export async function claimLinkedInSeats() {
  const user = await requireUser();
  const { claimAccountsForUser } = await import("@/modules/channel/claim");
  await claimAccountsForUser({ orgId: user.orgId, userId: user.userId });
  redirect("/settings?connected=1");
}

/** Restore a seat that already exists in Unipile (deleted FABM user / missed webhook). */
export async function linkUnipileAccountId(formData: FormData) {
  const user = await requireUser();
  const raw = String(formData.get("accountId") ?? "").trim();
  if (!raw) redirect("/settings?link_err=missing");
  const { upsertChannelAccount } = await import("@/modules/channel/claim");
  let displayName: string | null = null;
  try {
    displayName = (await getChannelProvider().getAccountStatus(raw)).displayName;
  } catch {
    redirect("/settings?link_err=unipile");
  }
  await upsertChannelAccount({
    orgId: user.orgId,
    unipileAccountId: raw,
    displayName,
    status: "operational",
  });
  redirect("/settings?connected=1");
}

export async function refreshStatus(accountId: string) {
  await requireUser();
  const { status, displayName } = await getChannelProvider().getAccountStatus(accountId);
  await db.update(channelAccount)
    .set({ status, displayName: displayName ?? undefined })
    .where(eq(channelAccount.unipileAccountId, accountId));
}

export async function disconnect(accountId: string) {
  await requireUser();
  await db.update(channelAccount).set({ status: "disconnected" })
    .where(eq(channelAccount.unipileAccountId, accountId));
}

export async function saveEnrichLimit(formData: FormData) {
  const user = await requireUser();
  const raw = String(formData.get("limit") ?? "10");
  const enrichLimit = raw === "all" ? ("all" as const) : Math.max(1, Number(raw) || 10);
  await updateOrgSettings(user.orgId, { enrichLimit });
  redirect("/settings?saved=1");
}

/** How many people one day of post scanning may touch. Lower for a fresh or
 *  fragile LinkedIn seat; the env value is the default. */
export async function savePostScanCap(formData: FormData) {
  const user = await requireUser();
  const raw = Number(formData.get("postScanDailyCap") ?? 0);
  const postScanDailyCap = Number.isFinite(raw) && raw > 0
    ? Math.min(2000, Math.round(raw)) : undefined;
  await updateOrgSettings(user.orgId, { postScanDailyCap });
  redirect("/settings?saved=scan");
}

export async function saveClassifyCap(formData: FormData) {
  const user = await requireUser();
  const raw = String(formData.get("cap") ?? "1000");
  const classifyLlmPeopleCap = raw === "all" ? ("all" as const) : Math.max(1, Number(raw) || 1000);
  await updateOrgSettings(user.orgId, { classifyLlmPeopleCap });
  redirect("/settings?saved=1");
}

/** Who this workspace sells as. sellerName drives the "works at our own
 *  company" exclusion in matching; sellerContext is what the message drafter
 *  is told it represents. Both blank-safe: an empty name turns the exclusion
 *  off, an empty context falls back to the built-in default. */
export async function saveSeller(formData: FormData) {
  const user = await requireUser();
  const sellerName = String(formData.get("sellerName") ?? "").trim().slice(0, 120);
  const sellerContext = String(formData.get("sellerContext") ?? "").trim().slice(0, 2000);
  await updateOrgSettings(user.orgId, { sellerName, sellerContext });
  // Apply the exclusion NOW rather than waiting for the next matching run.
  // It is a deterministic string test, so there is nothing to pay for and no
  // reason to make the user reclassify a whole workspace to enact it.
  const { applyOwnCompanyRule } = await import("@/modules/matching/own-company");
  const { excluded, released } = await applyOwnCompanyRule(user.orgId, sellerName);
  redirect(`/settings?saved=seller&excluded=${excluded}&released=${released}`);
}

/** Who ranks highest. functionTerms decides which titles earn the buyer bonus;
 *  serviceWeights maps each offer to what a match with it is worth. Ranking is
 *  free to re-run, so this applies to the whole pool immediately. */
export async function saveRanking(formData: FormData) {
  const user = await requireUser();
  const functionTerms = parseSignals(String(formData.get("functionTerms") ?? ""));

  const { db, service, connectionBatch } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const offers = await db.select({ slug: service.slug }).from(service)
    .where(and(eq(service.orgId, user.orgId), eq(service.status, "active")));

  const serviceWeights: Record<string, number> = {};
  for (const o of offers) {
    const raw = Number(formData.get(`w_${o.slug}`) ?? 0);
    serviceWeights[o.slug] = Number.isFinite(raw) ? Math.min(40, Math.max(0, Math.round(raw))) : 0;
  }
  await updateOrgSettings(user.orgId, { functionTerms, serviceWeights });

  // Re-rank every batch: scoring costs nothing, and a stale rank is worse than
  // no rank because it looks authoritative.
  const { rankBatch } = await import("@/modules/scoring/rank");
  const batches = await db.select({ id: connectionBatch.id }).from(connectionBatch)
    .where(eq(connectionBatch.orgId, user.orgId));
  let ranked = 0;
  for (const b of batches) ranked += await rankBatch(user.orgId, b.id);
  redirect(`/settings?saved=ranking&ranked=${ranked}`);
}

/** The slug the classifier falls back to when nothing else fits. Validated
 *  against the live catalog so a renamed or deleted service cannot leave a
 *  dangling marker in the digest. */
export async function saveCatchAll(formData: FormData) {
  const user = await requireUser();
  const raw = String(formData.get("catchAllSlug") ?? "").trim();
  const { db, service } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  let catchAllSlug = "";
  if (raw) {
    const [hit] = await db.select({ slug: service.slug }).from(service)
      .where(and(eq(service.orgId, user.orgId), eq(service.slug, raw)));
    if (!hit) redirect("/settings?err=catchall");
    catchAllSlug = hit.slug;
  }
  await updateOrgSettings(user.orgId, { catchAllSlug });
  redirect("/settings?saved=catchall");
}

/** One signal per line, commas tolerated. Lowercased because both matchers
 *  compare against normalised text. An EMPTY list is meaningful — it turns the
 *  rule off — so it is stored as [], never left undefined (which means
 *  "use the built-in defaults"). */
function parseSignals(raw: string): string[] {
  return [...new Set(
    raw.split(/[\n,]/).map((s) => s.trim().toLowerCase()).filter(Boolean).map((s) => s.slice(0, 60)),
  )].slice(0, 200);
}

export async function saveSignals(formData: FormData) {
  const user = await requireUser();
  const peerSignals = parseSignals(String(formData.get("peerSignals") ?? ""));
  const offIcpSignals = parseSignals(String(formData.get("offIcpSignals") ?? ""));
  await updateOrgSettings(user.orgId, { peerSignals, offIcpSignals });
  const { applySignalRules } = await import("@/modules/matching/signal-rules");
  const r = await applySignalRules(user.orgId, peerSignals, offIcpSignals);
  redirect(`/settings?saved=signals&peered=${r.peered}&offt=${r.offTarget}&released=${r.released}`);
}

/** Sample the seat owner's own posts and distill a voice profile the
 *  message drafter follows. One light seat touch. */
export async function scanVoice(formData: FormData) {
  const user = await requireUser();
  const raw = String(formData.get("profileUrl") ?? "").trim();
  const m = raw.match(/linkedin\.com\/in\/([^/?#]+)/i);
  const identifier = m ? m[1] : raw.replace(/^@/, "");
  // blank is fine — the worker resolves the connected account itself
  await enqueue(user.orgId, "voice_scan", { identifier: identifier || "me" });
  redirect("/settings?ok=voice");
}
