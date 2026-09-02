/**
 * Per-workspace health for the admin console.
 *
 * Org isolation means an admin cannot open a client's workspace, so problems
 * inside one are invisible from outside it — 180 people in a client workspace
 * carried a blank service for weeks because nothing surfaced it. This is the
 * view that would have caught it, and every number here is a problem someone
 * has actually had.
 *
 * Four grouped queries regardless of how many workspaces exist, never one per
 * workspace: the console is the one page guaranteed to load every org.
 */
import { desc, sql } from "drizzle-orm";
import { db, appUser, channelAccount, connection, job, org, service } from "@/db";
import type { OrgSettings } from "@/db/schema";

export interface WorkspaceHealth {
  orgId: string;
  workspace: string;
  users: string[];
  /** People */
  total: number;
  pitchable: number;
  offIcp: number;
  peers: number;
  excluded: number;
  unclassified: number;
  /** The quiet failures */
  pitchableNoService: number;
  unknownSlug: number;
  /** Pipeline */
  enriched: number;
  draftsWaiting: number;
  enrichFailed: number;
  /** Setup */
  services: number;
  seatStatus: string | null;
  settings: OrgSettings | null;
  lastJobAt: Date | null;
  lastJobKind: string | null;
  lastJobStatus: string | null;
}

export type Severity = "ok" | "warn" | "crit";
export interface Issue { severity: Severity; label: string }

/** What is actually wrong, in the order it costs money. */
export function issuesFor(w: WorkspaceHealth): Issue[] {
  const out: Issue[] = [];
  if (w.services === 0) out.push({ severity: "crit", label: "No offers defined" });
  if (w.total > 0 && !w.settings?.sellerName) {
    out.push({ severity: "crit", label: "No company name — own staff are targets" });
  }
  // These count the same people when the cause is a bad slug: the classifier
  // named an offer this workspace does not have, the guard cleared it, and the
  // row is left blank. Report the cause once, not the symptom as well.
  if (w.unknownSlug > 0) {
    out.push({ severity: "crit", label: `${w.unknownSlug} matched to an offer not in their catalog` });
    const extra = w.pitchableNoService - w.unknownSlug;
    if (extra > 0) out.push({ severity: "warn", label: `${extra} more pitchable with no offer` });
  } else if (w.pitchableNoService > 0) {
    out.push({ severity: "warn", label: `${w.pitchableNoService} pitchable with no offer` });
  }
  if (w.unclassified > 0) {
    out.push({ severity: "warn", label: `${w.unclassified} unmatched — run matching` });
  }
  if (w.total > 0 && !w.settings?.sellerContext?.trim()) {
    out.push({ severity: "warn", label: "No sender description — drafts use the default firm" });
  }
  if (w.total > 0 && !w.settings?.catchAllSlug) {
    out.push({ severity: "warn", label: "No fallback offer" });
  }
  if (w.seatStatus && w.seatStatus !== "operational") {
    out.push({ severity: "crit", label: `LinkedIn seat ${w.seatStatus}` });
  }
  if (!w.seatStatus && w.total > 0) out.push({ severity: "warn", label: "No LinkedIn seat" });
  if (w.enrichFailed > 0) out.push({ severity: "warn", label: `${w.enrichFailed} research failures` });
  if (w.lastJobStatus === "failed") out.push({ severity: "warn", label: "Last run failed" });
  return out;
}

export function worstSeverity(issues: Issue[]): Severity {
  if (issues.some((i) => i.severity === "crit")) return "crit";
  if (issues.some((i) => i.severity === "warn")) return "warn";
  return "ok";
}

export async function loadWorkspaceHealth(): Promise<WorkspaceHealth[]> {
  const orgs = await db.select({
    id: org.id,
    name: org.name,
    settings: org.settingsJson,
  }).from(org);

  // Grouped, not a correlated subquery: interpolating a table into a raw sql
  // subquery does not correlate against the outer row — it returns 0 for
  // everyone, silently, which is exactly how this shipped broken once.
  const catalog = await db.select({
    orgId: service.orgId,
    n: sql<number>`count(*) filter (where status = 'active')::int`,
  }).from(service).groupBy(service.orgId);

  const people = await db.select({
    orgId: connection.orgId,
    total: sql<number>`count(*)::int`,
    pitchable: sql<number>`count(*) filter (where bucket = 'pitchable')::int`,
    offIcp: sql<number>`count(*) filter (where bucket = 'off_icp')::int`,
    peers: sql<number>`count(*) filter (where bucket = 'peer_competitor')::int`,
    excluded: sql<number>`count(*) filter (where bucket = 'excluded')::int`,
    unclassified: sql<number>`count(*) filter (where bucket is null)::int`,
    pitchableNoService: sql<number>`count(*) filter (where bucket = 'pitchable' and service_slug is null)::int`,
    unknownSlug: sql<number>`count(*) filter (where match_why like 'Unknown service slug%')::int`,
    enriched: sql<number>`count(*) filter (where enrich_status = 'done')::int`,
    enrichFailed: sql<number>`count(*) filter (where enrich_status = 'failed')::int`,
    draftsWaiting: sql<number>`count(*) filter (
      where enrich_status = 'done' and outreach_message is not null and sent_at is null)::int`,
  }).from(connection).groupBy(connection.orgId);

  const users = await db.select({ orgId: appUser.orgId, email: appUser.email }).from(appUser);

  const seats = await db.select({ orgId: channelAccount.orgId, status: channelAccount.status })
    .from(channelAccount);

  // One row per org: the most recent job, whatever it was.
  const jobs = await db.selectDistinctOn([job.orgId], {
    orgId: job.orgId, kind: job.kind, status: job.status, updatedAt: job.updatedAt,
  }).from(job).orderBy(job.orgId, desc(job.updatedAt));

  const byOrg = <T extends { orgId: string }>(rows: T[]) =>
    new Map(rows.map((r) => [r.orgId, r]));
  const p = byOrg(people);
  const cat = byOrg(catalog);
  const s = byOrg(seats);
  const j = byOrg(jobs);
  const u = new Map<string, string[]>();
  for (const row of users) {
    if (!u.has(row.orgId)) u.set(row.orgId, []);
    u.get(row.orgId)!.push(row.email);
  }

  return orgs.map((o): WorkspaceHealth => {
    const c = p.get(o.id);
    const lastJob = j.get(o.id);
    return {
      orgId: o.id,
      workspace: o.name,
      users: u.get(o.id) ?? [],
      total: c?.total ?? 0,
      pitchable: c?.pitchable ?? 0,
      offIcp: c?.offIcp ?? 0,
      peers: c?.peers ?? 0,
      excluded: c?.excluded ?? 0,
      unclassified: c?.unclassified ?? 0,
      pitchableNoService: c?.pitchableNoService ?? 0,
      unknownSlug: c?.unknownSlug ?? 0,
      enriched: c?.enriched ?? 0,
      draftsWaiting: c?.draftsWaiting ?? 0,
      enrichFailed: c?.enrichFailed ?? 0,
      services: cat.get(o.id)?.n ?? 0,
      seatStatus: s.get(o.id)?.status ?? null,
      settings: o.settings ?? null,
      lastJobAt: lastJob?.updatedAt ?? null,
      lastJobKind: lastJob?.kind ?? null,
      lastJobStatus: lastJob?.status ?? null,
    };
  }).sort((a, b) => b.total - a.total);
}
