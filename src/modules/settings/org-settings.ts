/**
 * Enrichment guardrail. One knob today, room for more later.
 * Enforced in the selectTopN action AND the deep_enrich job — the UI is a
 * convenience, the server is the guardrail.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, org, DEFAULT_ORG_SETTINGS, type OrgSettings } from "@/db";

export const ENRICH_LIMIT_OPTIONS = [5, 10, 15, 25, 50, 80, "all"] as const;
export const CLASSIFY_CAP_OPTIONS = [250, 500, 1000, 2500, "all"] as const;

const settingsSchema = z.object({
  enrichLimit: z.union([z.literal("all"), z.number().int().positive().max(10000)]),
  classifyLlmPeopleCap: z
    .union([z.literal("all"), z.number().int().positive().max(100000)])
    .default(1000),
  /** "managed"  — TTC-run seat; the admin catalog sync may overwrite services.
   *  "own"      — client-defined offers; sync NEVER touches this workspace. */
  catalogMode: z.enum(["managed", "own"]).default("managed"),
  /** Optional on purpose. safeParse failure here returns DEFAULT_ORG_SETTINGS
   *  for the WHOLE object, so a required field would silently wipe every
   *  existing workspace's voice profile and guardrails. Never make one required. */
  sellerName: z.string().max(120).optional(),
  sellerContext: z.string().max(2000).optional(),
  peerSignals: z.array(z.string().max(60)).max(200).optional(),
  triggerSignals: z.array(z.object({
    phrase: z.string().min(2).max(60),
    label: z.string().min(1).max(80),
    weight: z.number().int().min(1).max(5),
    why: z.string().max(400).optional(),
    offer: z.string().max(80).nullish(),
  })).max(60).optional(),
  offIcpSignals: z.array(z.string().max(60)).max(200).optional(),
  postScanDailyCap: z.number().int().min(1).max(2000).optional(),
  functionTerms: z.array(z.string().max(60)).max(200).optional(),
  icpFitBonus: z.number().int().min(0).max(40).optional(),
  serviceWeights: z.record(z.number().int().min(0).max(40)).optional(),
  catchAllSlug: z.string().max(120).optional(),
  /** Hostnames only — no scheme, no path. Validated here rather than at fetch
   *  time so a bad entry is rejected when it is saved, not silently skipped on
   *  every run afterwards. */
  pulseDomains: z.array(z.string().max(120)).max(50).optional(),
  voiceProfile: z.string().optional(),
  voiceSampledAt: z.string().optional(),
  pickN: z.number().int().positive().max(80).optional(),
  pickCountry: z.string().optional(),
  pickPosted: z.string().optional(),
});

export async function getOrgSettings(orgId: string): Promise<OrgSettings> {
  const [row] = await db.select({ s: org.settingsJson }).from(org).where(eq(org.id, orgId));
  const parsed = settingsSchema.safeParse(row?.s);
  return parsed.success ? parsed.data : DEFAULT_ORG_SETTINGS;
}

export async function updateOrgSettings(orgId: string, patch: Partial<OrgSettings>): Promise<void> {
  const current = await getOrgSettings(orgId);
  const next = settingsSchema.parse({ ...current, ...patch });
  await db.update(org).set({ settingsJson: next }).where(eq(org.id, orgId));
}

/** Clamp a requested selection size to the guardrail. */
export function clampToLimit(requested: number, limit: OrgSettings["enrichLimit"]): number {
  const sane = Math.max(1, Math.min(requested, 10000));
  return limit === "all" ? sane : Math.min(sane, limit);
}
