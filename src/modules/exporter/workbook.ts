/**
 * The deliverable: a five-tab .xlsx mirroring the TTC Batch-1 workbook.
 * Grey = Stage A columns · Amber = Stage B columns (kept for visual parity).
 */
import ExcelJS from "exceljs";
import { and, asc, eq } from "drizzle-orm";
import { db, connection, connectionBatch } from "@/db";

const GREY = "FFF2F2F2";
const AMBER = "FFFFF2CC";
const HEAD = "FF1F2937";

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
  row.height = 22;
}

/** FLAG is outreach-critical — fold it into the Service-to-Pitch cell like the
 *  original TTC workbook did, so it can never be missed in the deliverable. */
function serviceCell(c: { serviceConfirmed: string | null; flag: string | null }): string {
  const base = c.serviceConfirmed ?? "";
  if (!c.flag) return base;
  return base ? `${base} · FLAG — ${c.flag}` : `FLAG — ${c.flag}`;
}

export async function buildWorkbook(
  orgId: string,
  batchId: string,
  opts: { includeOps?: boolean } = {},
): Promise<Buffer> {
  const [batch] = await db.select().from(connectionBatch)
    .where(and(eq(connectionBatch.id, batchId), eq(connectionBatch.orgId, orgId)));
  if (!batch) throw new Error("Batch not found");

  const rows = await db.select().from(connection)
    .where(eq(connection.batchId, batchId))
    .orderBy(asc(connection.rank), asc(connection.createdAt));

  const pitchable = rows.filter((r) => r.bucket === "pitchable");
  const enriched = pitchable.filter((r) => r.selectedForEnrich)
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const offIcp = rows.filter((r) => r.bucket === "off_icp");
  const peers = rows.filter((r) => r.bucket === "peer_competitor");
  const excluded = rows.filter((r) => r.bucket === "excluded");

  const wb = new ExcelJS.Workbook();
  wb.creator = "Focused ABM";

  // ── Instructions ────────────────────────────────────────────────────
  const info = wb.addWorksheet("Instructions");
  info.columns = [{ width: 110 }];
  const lines = [
    `Focused ABM — ${batch.label}`,
    `Generated ${new Date().toISOString().slice(0, 10)} · source: ${batch.source}`,
    "",
    "TABS",
    `• Top ${enriched.length} — Batch: fully enriched (grey = metadata match, amber = profile-scanned).`,
    `• Target Pool (ranked): all ${pitchable.length} pitchable targets — your source for the next batches.`,
    `• Review — off-ICP: ${offIcp.length} demoted (coaches / personal-brand / B2C). Scan in case any belong back in.`,
    `• Peers & Competitors: ${peers.length} marketing people AT agencies — partnership / referral candidates, not buyers.`,
    `• Excluded silently: ${excluded.length} (own team, students, blank rows).`,
    "",
    "REALITIES BAKED IN",
    "• Many people don't post — pains are inferred from role + company + About and marked as inferred.",
    "• 'Last 5 posts' = one activity-feed link + a summary, not five URLs.",
    "• Messages are strong DRAFTS — polish the top handful before sending.",
    ...(opts.includeOps ? ["", "OPS (internal) — full diagnostics per row: bucket, score breakdown, confidence, rule/model provenance, enrichment status, flags. Remove this tab before sharing externally."] : []),
  ];
  for (const l of lines) info.addRow([l]);
  info.getRow(1).font = { bold: true, size: 14 };

  // ── Top N — Batch ──────────────────────────────────────────────────
  const top = wb.addWorksheet(`Top ${enriched.length} — Batch`);
  const topHeaders = [
    "Rank", "First Name", "Last Name", "Company", "Position", "LinkedIn URL",
    "Provisional Service", "Why (from role + company)",
    "LinkedIn About — Summary", "Last 5 Posts (activity-feed link)",
    "Pain Points / Notes (from posts or inferred)",
    "Service to Pitch (confirm/correct)", "Personalized Outreach Message",
  ];
  styleHeader(top.addRow(topHeaders));
  top.columns = topHeaders.map((h, i) => ({
    header: h, key: String(i),
    width: i < 6 ? 18 : i < 8 ? 30 : 55,
  }));
  for (const c of enriched) {
    const row = top.addRow([
      c.rank, c.firstName, c.lastName, c.companyRaw, c.positionRaw, c.linkedinUrl,
      c.serviceSlug, c.matchWhy,
      c.aboutSummary,
      c.activityUrl ? `${c.activityUrl}\n${c.postsSummary ?? ""}` : c.postsSummary,
      c.painPoints, serviceCell(c), c.outreachMessage,
    ]);
    row.alignment = { vertical: "top", wrapText: true };
    for (let col = 1; col <= 8; col += 1)
      row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
    for (let col = 9; col <= 13; col += 1)
      row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER } };
  }

  // ── Target Pool (ranked) ───────────────────────────────────────────
  const pool = wb.addWorksheet("Target Pool (ranked)");
  const poolHeaders = ["Rank", "Tier", "First Name", "Last Name", "Company", "Position", "LinkedIn URL", "Provisional Service", "Why"];
  styleHeader(pool.addRow(poolHeaders));
  pool.columns = poolHeaders.map((h, i) => ({ width: i < 2 ? 8 : i === 8 ? 60 : 24 }));
  for (const c of pitchable.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))) {
    pool.addRow([
      c.rank, c.tier ? `T${c.tier}` : "", c.firstName, c.lastName,
      c.companyRaw, c.positionRaw, c.linkedinUrl, c.serviceSlug, c.matchWhy,
    ]).alignment = { vertical: "top", wrapText: true };
  }

  // ── Review — off-ICP ───────────────────────────────────────────────
  const rev = wb.addWorksheet("Review — off-ICP");
  styleHeader(rev.addRow(["First Name", "Last Name", "Company", "Position", "LinkedIn URL", "Why flagged"]));
  rev.columns = [{ width: 16 }, { width: 16 }, { width: 28 }, { width: 34 }, { width: 40 }, { width: 50 }];
  for (const c of offIcp)
    rev.addRow([c.firstName, c.lastName, c.companyRaw, c.positionRaw, c.linkedinUrl, c.matchWhy]);

  // ── Peers & Competitors ────────────────────────────────────────────
  const peersWs = wb.addWorksheet("Peers & Competitors");
  styleHeader(peersWs.addRow(["First Name", "Last Name", "Company", "Position", "LinkedIn URL"]));
  peersWs.columns = [{ width: 16 }, { width: 16 }, { width: 30 }, { width: 36 }, { width: 44 }];
  for (const c of peers)
    peersWs.addRow([c.firstName, c.lastName, c.companyRaw, c.positionRaw, c.linkedinUrl]);

  // ── Ops (internal) — optional full-diagnostics tab, default OFF ────
  if (opts.includeOps) {
    const ops = wb.addWorksheet("Ops (internal)");
    const opsHeaders = [
      "Rank", "First Name", "Last Name", "Company", "Position", "Bucket",
      "Service (slug)", "Confidence", "Method", "Score",
      "Seniority", "Function", "Conf pts", "Founder", "Company pts", "Svc bonus", "Tier",
      "Selected", "Enrich status", "Enrich error", "Flag", "Pain inferred",
      "Correction reason", "LinkedIn URL",
    ];
    styleHeader(ops.addRow(opsHeaders));
    ops.columns = opsHeaders.map((h) => ({
      width: h === "Enrich error" || h === "Correction reason" ? 40
        : h === "LinkedIn URL" ? 40
        : h.length > 12 ? 16 : 11,
    }));
    for (const c of rows) {
      const b = c.scoreBreakdownJson;
      const row = ops.addRow([
        c.rank, c.firstName, c.lastName, c.companyRaw, c.positionRaw ?? c.headlineRaw,
        c.bucket, c.serviceSlug, c.matchConfidence, c.matchMethod, c.score,
        b?.seniority ?? null, b?.function_fit ?? null, b?.confidence ?? null,
        b?.founder_bonus ?? null, b?.company_present ?? null, b?.service_bonus ?? null,
        c.tier ? `T${c.tier}` : null,
        c.selectedForEnrich ? "yes" : "", c.selectedForEnrich ? c.enrichStatus : "",
        c.enrichError, c.flag, c.painInferred == null ? "" : c.painInferred ? "yes" : "no",
        c.correctionReason, c.linkedinUrl,
      ]);
      row.alignment = { vertical: "top", wrapText: true };
      if (c.enrichStatus === "failed")
        row.getCell(19).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E0" } };
      if (c.flag)
        row.getCell(21).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E0" } };
    }
    ops.views = [{ state: "frozen", ySplit: 1 }];
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
