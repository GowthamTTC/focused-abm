/**
 * How much of the ground truth does the FREE rule pass already resolve?
 *
 * The prompt evaluation deliberately bypasses the rule pass to isolate the
 * model. This measures what the rules catch first in production, which is
 * what decides how much a prompt's weakness on a class actually costs.
 * No LLM calls, no database writes.
 */
import "dotenv/config";
import ExcelJS from "exceljs";
import { companyPeerSignal, offIcpTitleSignal } from "../src/modules/matching/rule-pass";
import { detectSeniority } from "../src/modules/matching/normalize";

const WORKBOOK = process.env.GROUND_TRUTH
  ?? "/Users/gowtham/Downloads/TTC-LinkedIn-ABM-Batch1-completed.xlsx";

function cell(row: ExcelJS.Row, i: number): string {
  const v = (row.values as unknown[])[i];
  if (v == null) return "";
  if (typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text ?? "").trim();
  return String(v).trim();
}

type Row = { company: string; position: string };

async function sheet(wb: ExcelJS.Workbook, name: string, co: number, pos: number, skipHeader = true): Promise<Row[]> {
  const ws = wb.getWorksheet(name);
  const out: Row[] = [];
  ws?.eachRow((row, i) => {
    if (skipHeader && i === 1) return;
    const company = cell(row, co), position = cell(row, pos);
    if (!company && !position) return;
    if (/\(example/i.test(company)) return;
    out.push({ company, position });
  });
  return out;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK);

  const pitchable = await sheet(wb, "Target Pool (ranked)", 5, 6);
  const offIcp = await sheet(wb, "Review — off-ICP", 3, 4);
  const peers = await sheet(wb, "Peers & Competitors", 3, 4);

  const report = (label: string, rows: Row[]) => {
    let peer = 0, off = 0, junior = 0, none = 0;
    for (const r of rows) {
      if (companyPeerSignal(r.company)) { peer += 1; continue; }
      if (offIcpTitleSignal(r.position)) { off += 1; continue; }
      if (detectSeniority(r.position) === "junior") { junior += 1; continue; }
      none += 1;
    }
    const n = rows.length;
    const p = (x: number) => `${((x / n) * 100).toFixed(1)}%`;
    console.log(`\n${label}  (${n} people) — what the free rule pass does FIRST:`);
    console.log(`  -> peer_competitor (company signal)  ${String(peer).padStart(5)}  ${p(peer)}`);
    console.log(`  -> off_icp         (title signal)    ${String(off).padStart(5)}  ${p(off)}`);
    console.log(`  -> excluded        (junior title)    ${String(junior).padStart(5)}  ${p(junior)}`);
    console.log(`  -> falls through to the model        ${String(none).padStart(5)}  ${p(none)}`);
    return { peer, off, junior, none, n };
  };

  const P = report("GROUND TRUTH: pitchable", pitchable);
  const O = report("GROUND TRUTH: off-ICP", offIcp);
  const R = report("GROUND TRUTH: peers & competitors", peers);

  console.log("\n" + "=".repeat(66));
  console.log("What this means for the prompt choice");
  console.log("=".repeat(66));
  console.log(`Off-ICP people the rules catch before the model:  ${O.off}/${O.n} (${((O.off / O.n) * 100).toFixed(1)}%)`);
  console.log(`Peers the rules catch before the model:           ${R.peer}/${R.n} (${((R.peer / R.n) * 100).toFixed(1)}%)`);
  console.log(`Genuine prospects the rules WRONGLY divert:       ${P.peer + P.off + P.junior}/${P.n}` +
    ` (${(((P.peer + P.off + P.junior) / P.n) * 100).toFixed(1)}%)`);
  console.log(`  of which by the competitor-company list:        ${P.peer}`);
  console.log(`  of which by the off-target-title list:          ${P.off}`);
  console.log(`  of which by the junior-title rule:              ${P.junior}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
