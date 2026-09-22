/** Copy production's intel_scan job rows into a LOCAL workspace so the query
 *  provenance panel can be looked at. Local only; the rows are a faithful copy,
 *  nothing here is invented. */
import "./require-local-db";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, job, org } from "../src/db";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length >= 4);
}

async function main() {
  const orgId = process.env.ORG_ID!;
  const [w] = await db.select().from(org).where(eq(org.id, orgId));
  if (!w) throw new Error("no such workspace");
  await db.delete(job).where(and(eq(job.orgId, orgId), eq(job.kind, "intel_scan")));
  let n = 0;
  for (const [kind, status, payload, updatedAt] of parseCsv(readFileSync(process.env.CSV!, "utf8"))) {
    await db.insert(job).values({
      orgId, kind, status,
      payloadJson: JSON.parse(payload),
      updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
    });
    n += 1;
  }
  console.log(JSON.stringify({ workspace: w.name, jobs: n }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
