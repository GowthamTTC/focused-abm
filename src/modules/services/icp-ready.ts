/**
 * What makes an ICP usable rather than merely present.
 *
 * The setup wizard's ICP step is non-skippable, and "non-skippable" has to mean
 * something the server can check on its own: a summary the classifier can read,
 * and at least one persona carrying title patterns for the free rule pass. Both
 * are the fields everything downstream actually consumes, so an ICP that passes
 * here is an ICP that produces a real daily list.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, service, type IcpJson } from "@/db";

const MIN_SUMMARY = 25;

const personaSchema = z.object({
  slug: z.string().default("persona"),
  name: z.string().default("Persona"),
  title_include: z.array(z.string()).default([]),
  title_exclude: z.array(z.string()).default([]),
  seniority: z.array(z.string()).default([]),
  function_tags: z.array(z.string()).default([]),
});

/** The editor can post hand-written JSON, and icp_json is a not-null typed
 *  column every downstream reader trusts — so nothing lands in it unparsed. */
export const icpSchema = z.object({
  summary: z.string().default(""),
  fit_signals: z.array(z.string()).default([]),
  pain_points: z.array(z.string()).default([]),
  disqualifiers: z.array(z.string()).default([]),
  personas: z.array(personaSchema).default([]),
});

export function parseIcp(raw: string): IcpJson | null {
  try {
    return icpSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function icpGaps(icp: IcpJson): string[] {
  const gaps: string[] = [];
  if ((icp.summary ?? "").trim().length < MIN_SUMMARY)
    gaps.push(`a summary of who buys this (at least ${MIN_SUMMARY} characters)`);
  const withTitles = (icp.personas ?? []).filter((p) => (p.title_include ?? []).some((t) => t.trim()));
  if (withTitles.length === 0)
    gaps.push("at least one persona with buyer job titles under “title include”");
  return gaps;
}

export const isIcpReady = (icp: IcpJson) => icpGaps(icp).length === 0;

export async function orgHasReadyIcp(orgId: string): Promise<boolean> {
  const rows = await db.select({ icpJson: service.icpJson }).from(service)
    .where(and(eq(service.orgId, orgId), eq(service.status, "active")));
  return rows.some((r) => isIcpReady(r.icpJson));
}
