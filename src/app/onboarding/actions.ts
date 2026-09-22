"use server";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, appUser, channelAccount, job as jobTable, service } from "@/db";
import { draftServicesFromUrl } from "@/modules/services/draft-from-site";
import { createBlankService, insertServices } from "@/modules/services/create";
import { orgHasReadyIcp, parseIcp } from "@/modules/services/icp-ready";
import { orgHasSyncedConnections } from "@/modules/connections/sync-ready";
import { updateOrgSettings } from "@/modules/settings/org-settings";
import { enqueue } from "@/jobs/runner";
import { requireSetupUser } from "./guard";
import { CONNECT_STEP, ICP_STEP, LAST_STEP, SERVICES_STEP, SYNC_STEP, VOICE_STEP, resolveMove } from "./progress";

async function markReached(userId: string, current: number, step: number) {
  if (current < step) {
    await db.update(appUser).set({ onboardingStep: step }).where(eq(appUser.id, userId));
  }
}

/** Both wizard buttons post here; resolveMove decides where the press lands. */
export async function moveStep(formData: FormData) {
  const user = await requireSetupUser();
  const move = resolveMove(
    user.onboardingStep,
    String(formData.get("from") ?? 1),
    String(formData.get("dir") ?? "next"),
  );

  // The ICP step is the one step setup will not let anyone walk past: without a
  // usable ICP every later step has nothing to match against. Gated on the
  // clamped `from`, so a hand-edited form body lands here too.
  if (move.from === ICP_STEP && (move.kind === "finish" || move.step > ICP_STEP)) {
    if (!(await orgHasReadyIcp(user.orgId))) redirect(`/onboarding/${ICP_STEP}?err=incomplete`);
  }

  // Step 6 is the step everything downstream depends on, so it is the second
  // hard gate: setup will not let anyone past it without one finished
  // sync+classify(+rank) cycle that actually imported someone. Someone who
  // never connected LinkedIn at all is sent back to step 4 instead of being
  // trapped here with nothing to do.
  if (move.from === SYNC_STEP && (move.kind === "finish" || move.step > SYNC_STEP)) {
    const [seat] = await db.select().from(channelAccount)
      .where(and(eq(channelAccount.orgId, user.orgId), eq(channelAccount.status, "operational")));
    if (!seat) redirect(`/onboarding/${CONNECT_STEP}?err=needseat`);
    if (!(await orgHasSyncedConnections(user.orgId))) redirect(`/onboarding/${SYNC_STEP}?err=incomplete`);
  }

  if (move.kind === "finish") {
    await db.update(appUser)
      .set({ onboardingStep: LAST_STEP, onboardingCompletedAt: new Date() })
      .where(eq(appUser.id, user.userId));
    redirect("/dashboard");
  }

  if (move.persist !== null) {
    await db.update(appUser)
      .set({ onboardingStep: move.persist })
      .where(eq(appUser.id, user.userId));
  }
  redirect(`/onboarding/${move.step}`);
}

/** Step 2 — read the URL the user gave us and draft their offers from it. */
export async function draftFromUrl(formData: FormData) {
  const user = await requireSetupUser();
  const raw = String(formData.get("url") ?? "");
  const outcome = await draftServicesFromUrl(raw);
  if (!outcome.ok) redirect(`/onboarding/${SERVICES_STEP}?err=${outcome.code}`);

  const slugs = await insertServices(user.orgId, outcome.drafts);
  redirect(`/onboarding/${SERVICES_STEP}?drafted=${slugs.length}&pages=${outcome.pages.length}`);
}

/** Step 2's fallback, and step 3's escape hatch when the org has nothing yet:
 *  one empty offer to rename and define by hand. */
export async function startFromBlank() {
  const user = await requireSetupUser();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(service)
    .where(and(eq(service.orgId, user.orgId), eq(service.status, "active")));
  const slug = n > 0 ? null : await createBlankService(user.orgId);
  await markReached(user.userId, user.onboardingStep, SERVICES_STEP);
  redirect(`/onboarding/${ICP_STEP}${slug ? `?s=${slug}` : ""}`);
}

/** Step 3 — the IcpEditor's save, on the same path /offers/[slug] uses. */
export async function saveIcp(slug: string, formData: FormData) {
  const user = await requireSetupUser();
  const icp = parseIcp(String(formData.get("icp") ?? ""));
  if (!icp) redirect(`/onboarding/${ICP_STEP}?s=${slug}&err=badjson`);
  await db.update(service).set({ icpJson: icp })
    .where(and(eq(service.orgId, user.orgId), eq(service.slug, slug)));
  redirect(`/onboarding/${ICP_STEP}?s=${slug}&saved=1`);
}

/** Step 3 — a drafted name is a guess, and the blank one is a placeholder. */
export async function renameService(slug: string, formData: FormData) {
  const user = await requireSetupUser();
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!name) redirect(`/onboarding/${ICP_STEP}?s=${slug}&err=noname`);
  await db.update(service).set({ name })
    .where(and(eq(service.orgId, user.orgId), eq(service.slug, slug)));
  redirect(`/onboarding/${ICP_STEP}?s=${slug}&renamed=1`);
}

/** Step 3 — drop a drafted offer the user does not actually sell. */
export async function dropService(slug: string) {
  const user = await requireSetupUser();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(service)
    .where(and(eq(service.orgId, user.orgId), eq(service.status, "active")));
  if (n <= 1) redirect(`/onboarding/${ICP_STEP}?s=${slug}&err=last`);
  await db.delete(service)
    .where(and(eq(service.orgId, user.orgId), eq(service.slug, slug)));
  redirect(`/onboarding/${ICP_STEP}?dropped=${encodeURIComponent(slug)}`);
}

/** Step 5's fallback when a scan is unavailable or comes back thin: five
 *  short answers stitched into the same free-text shape scanVoice's job
 *  would have written. */
function composeVoiceProfile(a: {
  tone: string; formality: string; phrases: string; avoid: string; audience: string;
}): string {
  return [
    a.tone && `Tone: ${a.tone}.`,
    a.formality && `Formality: ${a.formality}.`,
    a.phrases && `Typical phrases: ${a.phrases}.`,
    a.avoid && `Avoid: ${a.avoid}.`,
    a.audience && `Usually writing to: ${a.audience}.`,
  ].filter(Boolean).join(" ");
}

export async function saveVoiceDiagnostic(formData: FormData) {
  const user = await requireSetupUser();
  const profile = composeVoiceProfile({
    tone: String(formData.get("tone") ?? "").trim().slice(0, 200),
    formality: String(formData.get("formality") ?? "").trim().slice(0, 60),
    phrases: String(formData.get("phrases") ?? "").trim().slice(0, 300),
    avoid: String(formData.get("avoid") ?? "").trim().slice(0, 300),
    audience: String(formData.get("audience") ?? "").trim().slice(0, 200),
  });
  if (profile.length < 20) redirect(`/onboarding/${VOICE_STEP}?err=voicethin`);
  await updateOrgSettings(user.orgId, { voiceProfile: profile, voiceSampledAt: new Date().toISOString() });
  redirect(`/onboarding/${VOICE_STEP}?voicesaved=1`);
}

/** Step 5 — edit the scanned or diagnostic-composed profile before moving on. */
export async function saveVoiceProfileText(formData: FormData) {
  const user = await requireSetupUser();
  const voiceProfile = String(formData.get("voiceProfile") ?? "").trim().slice(0, 4000);
  if (!voiceProfile) redirect(`/onboarding/${VOICE_STEP}?err=voiceempty`);
  await updateOrgSettings(user.orgId, { voiceProfile, voiceSampledAt: new Date().toISOString() });
  redirect(`/onboarding/${VOICE_STEP}?voicesaved=1`);
}

/** Step 6 — same sync trigger `/sources` uses (`syncRelations`), just
 *  parametrized with `returnTo` the way `startConnect`/`scanVoice` are above.
 *  Mapping (classify, which chains rank inside the same job — runner.ts) is
 *  not enqueued here: StepSync enqueues it itself once this sync job lands,
 *  the same render-time pattern step-connect-linkedin.tsx already uses for
 *  claimAccountsForUser. */
export async function startSync(returnTo: string) {
  const user = await requireSetupUser();
  const [seat] = await db.select().from(channelAccount)
    .where(and(eq(channelAccount.orgId, user.orgId), eq(channelAccount.status, "operational")));
  if (!seat) redirect(`${returnTo}?err=noseat`);
  // One import at a time. The button is hidden while a sync runs, but a
  // double-submitted form would otherwise queue a second pull of the same
  // network — two batches, and setup's gate reading the newer one.
  const [inFlight] = await db.select({ id: jobTable.id }).from(jobTable)
    .where(and(
      eq(jobTable.orgId, user.orgId), eq(jobTable.kind, "sync"),
      inArray(jobTable.status, ["queued", "running", "stopping"]),
    )).limit(1);
  if (inFlight) redirect(returnTo);
  await enqueue(user.orgId, "sync", { accountId: seat.unipileAccountId, seatId: seat.id });
  redirect(returnTo);
}

/** Step 6 — resume mapping on an existing batch after a classify that failed
 *  or was stopped, without re-pulling from LinkedIn. A continuation run touches
 *  only still-unclassified rows, so nobody is classified (or billed) twice. */
export async function retryClassifyStep(batchId: string, returnTo: string) {
  const user = await requireSetupUser();
  await enqueue(user.orgId, "classify", { batchId, fullPool: true });
  redirect(returnTo);
}
