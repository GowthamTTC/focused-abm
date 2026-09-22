/**
 * Load the real Allergan Aesthetics signals into a LOCAL workspace so the L3
 * page can be looked at without holding a client's password.
 *
 *   npx tsx scripts/local-demo-fixture.ts < signals.csv
 *
 * Local only — the guard refuses anything else. The rows are a read-only copy
 * of what the production scan already found; nothing here invents a signal.
 */
import "./require-local-db";
import { readFileSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { db, accountSignal, org } from "../src/db";
import { parseUnitLines, saveAccountMap } from "../src/modules/accounts/org-map";

const UNITS = `
* Medical Affairs & HEOR | HEOR, Health Economics, Medical Affairs
* Data & Statistical Sciences | Biostatistics
* Clinical Data Strategy | Clinical Data
* Dermatology
* Customer Excellence
* IRA Strategy
* Patient Services Leadership | Patient Services
* Operations Transformation
* Commercial Operations
Immunology
Oncology
Neuroscience
Eye Care
Allergan Aesthetics | Allergan, Botox, Juvederm, SkinMedica, DiamondGlow
Established Brands
Virology
Regulatory Affairs
Quality Assurance
Manufacturing & Supply Chain
Market Access & Pricing
Legal & Compliance
Finance
Business Technology
Discovery Research
Clinical Development
Pharmacovigilance
Human Resources
Corporate Affairs
Business Development
Procurement
Patient Advocacy
`;

/** Minimal CSV reader for the columns dumped by the export — quoted fields,
 *  doubled quotes, embedded newlines and commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 3);
}

async function main() {
  const orgId = (process.env.ORG_ID ?? "").trim();
  if (!orgId) throw new Error("ORG_ID required");
  const [w] = await db.select().from(org).where(eq(org.id, orgId));
  if (!w) throw new Error("no such workspace");

  const csv = parseCsv(readFileSync(process.env.CSV!, "utf8"));
  await db.delete(accountSignal).where(and(
    eq(accountSignal.orgId, orgId),
    inArray(accountSignal.companyKey, ["allergan aesthetics", "allergan"]),
  ));

  let n = 0;
  for (const r of csv) {
    const [kind, companyKey, companyName, sourceId, source, title, url, body, publishedAt, sentiment, theme, evidence, judgedAt, authorLocation, authorCountry, capturedBy] = r;
    if (!sourceId) continue;
    await db.insert(accountSignal).values({
      orgId, companyKey, companyName, kind, sourceId,
      source: source || null, title: title || null, url: url || null, body: body || null,
      publishedAt: publishedAt ? new Date(publishedAt) : null,
      sentiment: sentiment ? Number(sentiment) : null,
      theme: theme || null, evidence: evidence || null,
      judgedAt: judgedAt ? new Date(judgedAt) : null,
      authorLocation: authorLocation || null,
      authorCountry: authorCountry || null,
      capturedBy: capturedBy || null,
    }).onConflictDoNothing();
    n += 1;
  }

  await saveAccountMap(orgId, {
    companyKey: "abbvie", name: "AbbVie",
    aliases: ["Allergan Aesthetics", "Allergan"],
    units: parseUnitLines(UNITS), source: "drafted",
  });

  console.log(JSON.stringify({ workspace: w.name, signals: n }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
