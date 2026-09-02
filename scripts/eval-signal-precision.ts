/**
 * Per-signal precision for the competitor-company and off-target-title lists.
 *
 * A signal that fires mostly on real peers is earning its place. One that
 * fires mostly on people the human kept in the target pool is discarding
 * business. No LLM calls, no database writes.
 */
import "dotenv/config";
import ExcelJS from "exceljs";
import {
  DEFAULT_OFF_ICP_TITLE_SIGNALS,
  DEFAULT_PEER_COMPANY_SIGNALS,
} from "../src/modules/matching/rule-pass";
import { normalizeTitle } from "../src/modules/matching/normalize";

const WORKBOOK = process.env.GROUND_TRUTH
  ?? "/Users/gowtham/Downloads/TTC-LinkedIn-ABM-Batch1-completed.xlsx";

function cell(row: ExcelJS.Row, i: number): string {
  const v = (row.values as unknown[])[i];
  if (v == null) return "";
  if (typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text ?? "").trim();
  return String(v).trim();
}

function read(wb: ExcelJS.Workbook, name: string, co: number, pos: number) {
  const ws = wb.getWorksheet(name);
  const out: { company: string; position: string }[] = [];
  ws?.eachRow((row, i) => {
    if (i === 1) return;
    const company = cell(row, co), position = cell(row, pos);
    if ((!company && !position) || /\(example/i.test(company)) return;
    out.push({ company, position });
  });
  return out;
}

/** First matching signal wins, exactly as the rule pass evaluates it. */
function firstHit(text: string, signals: readonly string[]): string | null {
  const t = normalizeTitle(text);
  if (!t) return null;
  for (const s of signals) if (s && t.includes(s)) return s;
  return null;
}

function table(
  label: string,
  signals: readonly string[],
  field: "company" | "position",
  keep: { company: string; position: string }[],
  drop: { company: string; position: string }[],
) {
  const stats = new Map<string, { right: number; wrong: number }>();
  for (const s of signals) stats.set(s, { right: 0, wrong: 0 });
  for (const r of drop) { const h = firstHit(r[field], signals); if (h) stats.get(h)!.right += 1; }
  for (const r of keep) { const h = firstHit(r[field], signals); if (h) stats.get(h)!.wrong += 1; }

  console.log(`\n${label}`);
  console.log("  signal                fires  correct  WRONGLY DROPPED  precision");
  const rows = [...stats].map(([s, v]) => ({ s, ...v, fires: v.right + v.wrong }))
    .filter((r) => r.fires > 0)
    .sort((a, b) => b.wrong - a.wrong);
  for (const r of rows) {
    const prec = r.fires ? `${((r.right / r.fires) * 100).toFixed(0)}%` : "—";
    const flag = r.wrong > r.right ? "  <-- costs more than it saves" : "";
    console.log(
      `  ${r.s.padEnd(20)} ${String(r.fires).padStart(5)} ${String(r.right).padStart(8)}` +
      ` ${String(r.wrong).padStart(16)} ${prec.padStart(10)}${flag}`,
    );
  }
  const tot = rows.reduce((a, r) => ({ right: a.right + r.right, wrong: a.wrong + r.wrong }), { right: 0, wrong: 0 });
  const all = tot.right + tot.wrong;
  console.log(`  ${"TOTAL".padEnd(20)} ${String(all).padStart(5)} ${String(tot.right).padStart(8)}` +
    ` ${String(tot.wrong).padStart(16)} ${(all ? `${((tot.right / all) * 100).toFixed(0)}%` : "—").padStart(10)}`);
  const never = signals.filter((s) => (stats.get(s)?.right ?? 0) + (stats.get(s)?.wrong ?? 0) === 0);
  if (never.length) console.log(`  never fires: ${never.join(", ")}`);
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK);
  const pitchable = read(wb, "Target Pool (ranked)", 5, 6);
  const offIcp = read(wb, "Review — off-ICP", 3, 4);
  const peers = read(wb, "Peers & Competitors", 3, 4);

  console.log(`Ground truth: ${pitchable.length} pitchable · ${offIcp.length} off-ICP · ${peers.length} peers`);
  console.log('"correct" = fired on someone the human put in that bucket.');
  console.log('"wrongly dropped" = fired on someone the human KEPT in the target pool.');

  table("COMPETITOR COMPANY SIGNALS (vs the Peers sheet)",
    DEFAULT_PEER_COMPANY_SIGNALS, "company", pitchable, peers);
  table("OFF-TARGET TITLE SIGNALS (vs the off-ICP sheet)",
    DEFAULT_OFF_ICP_TITLE_SIGNALS, "position", pitchable, offIcp);
}

main().catch((e) => { console.error(e); process.exit(1); });
