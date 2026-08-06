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
