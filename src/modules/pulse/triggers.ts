/**
 * Triggers — a theme at this company, and the offer it opens.
 *
 * The one deepdive call in the whole cost model (§7), so it runs once per
 * refresh and never in a loop. Everything it returns is checked back against
 * the input before the caller sees it: a trigger citing a signal that does not
 * exist, or an offer this workspace does not sell, is worse than no trigger,
 * because the panel's whole claim is that you can go and read what it read.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db, accountSignal, service } from "@/db";
import { complete } from "@/llm/client";
import { servicesDigest } from "@/modules/matching/service-fit";
import { getOrgSettings } from "@/modules/settings/org-settings";
import type { Trigger } from "@/modules/pulse/types";

/** Signals per call. Well above what one account accumulates in a window, and
 *  the cap exists so a long-lived account cannot quietly grow the one expensive
 *  call in the feature until it is the whole bill. */
const MAX_SIGNALS = 60;

const returned = z.array(z.object({
  theme: z.string().min(1),
  service_slug: z.string().nullable(),
  why: z.string().min(1),
  evidence_ids: z.array(z.string()),
  confidence: z.number().int().min(0).max(100),
}));

export async function deriveTriggers(
  orgId: string,
  companyKey: string,
  companyName: string,
): Promise<Trigger[]> {
  const signals = await db.select({
    id: accountSignal.id,
    kind: accountSignal.kind,
    title: accountSignal.title,
    body: accountSignal.body,
    theme: accountSignal.theme,
    sentiment: accountSignal.sentiment,
    evidence: accountSignal.evidence,
    publishedAt: accountSignal.publishedAt,
  }).from(accountSignal)
    .where(and(
      eq(accountSignal.orgId, orgId),
      eq(accountSignal.companyKey, companyKey),
      isNotNull(accountSignal.judgedAt),
    ))
    .limit(MAX_SIGNALS);

  // Spending a Sonnet call to be told there is nothing to say is the easiest
  // waste in the feature, and an account with no signals is the common case.
  if (signals.length === 0) return [];

  const services = (await db.select().from(service)
    .where(and(eq(service.orgId, orgId), eq(service.status, "active"))))
    .map((s) => ({ slug: s.slug, name: s.name, icp: s.icpJson }));
  if (services.length === 0) return [];

  const settings = await getOrgSettings(orgId);
  const digest = servicesDigest(services, settings.catchAllSlug);
  const known = new Set(signals.map((s) => s.id));
  const slugs = new Set(services.map((s) => s.slug));

  const signalsJson = JSON.stringify(signals.map((s) => ({
    id: s.id,
    kind: s.kind,
    theme: s.theme,
    sentiment: s.sentiment,
    published: s.publishedAt ? s.publishedAt.toISOString().slice(0, 10) : "",
    title: s.title ?? "",
    evidence: s.evidence ?? "",
    text: (s.body ?? "").slice(0, 600),
  })));

  const out = await complete({
    stage: "deepdive",
    prompt: "account-triggers",
    vars: {
      signals_json: signalsJson,
      company_name: companyName,
      seller_context: settings.sellerContext ?? "",
    },
    cachedContext: digest,
    schema: returned,
    maxTokens: 4000,
  });

  return out
    // A citation that does not resolve means the model produced the trigger and
    // then decorated it, which is the failure this panel cannot survive: the
    // user is invited to click through and check, and a dead reference teaches
    // them not to trust any of it.
    .filter((t) => t.evidence_ids.length > 0 && t.evidence_ids.every((id) => known.has(id)))
    // An offer this workspace does not sell is a trigger nobody can act on.
    // Dropped rather than nulled, because a null slug is supposed to mean the
    // model considered the catalogue and found nothing — a different claim.
    .filter((t) => t.service_slug === null || slugs.has(t.service_slug))
    .map((t): Trigger => ({
      theme: t.theme.trim(),
      serviceSlug: t.service_slug,
      why: t.why.trim(),
      evidenceIds: t.evidence_ids,
      confidence: t.confidence,
    }))
    .sort((a, b) => b.confidence - a.confidence);
}
