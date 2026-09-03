/**
 * LinkedIn Connections.csv parser. Real exports open with a 3-line
 * "Notes:" preamble before the header row:
 *   First Name,Last Name,URL,Email Address,Company,Position,Connected On
 * RFC-4180-ish tokenizer (quoted fields, doubled quotes, embedded newlines),
 * per-row errors with row numbers — no silent failures.
 */
export interface ParsedConnectionRow {
  firstName: string;
  lastName: string;
  linkedinUrl: string | null;
  company: string | null;
  position: string | null;
  connectedOn: string | null;
}
export interface ParsedConnectionsCsv {
  rows: ParsedConnectionRow[];
  errors: string[];
}

function tokenize(text: string): string[][] {
  const records: string[][] = [];
  let field = ""; let record: string[] = []; let inQuotes = false; let i = 0;
  const pushField = () => { record.push(field); field = ""; };
  const pushRecord = () => { pushField(); records.push(record); record = []; };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"' && field === "") { inQuotes = true; i += 1; continue; }
    if (ch === ",") { pushField(); i += 1; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      pushRecord(); i += 1; continue;
    }
    field += ch; i += 1;
  }
  if (field !== "" || record.length > 0) pushRecord();
  return records;
}

const H = {
  first: "first name", last: "last name", url: "url",
  company: "company", position: "position", connected: "connected on",
};

export function parseConnectionsCsv(text: string): ParsedConnectionsCsv {
  const errors: string[] = [];
  const rows: ParsedConnectionRow[] = [];
  const records = tokenize(text.replace(/^\uFEFF/, ""));

  // Header = first record containing both "first name" and "last name"
  // (skips LinkedIn's Notes preamble of arbitrary length).
  let headerIdx = -1;
  for (let r = 0; r < records.length; r += 1) {
    const cells = records[r].map((c) => c.trim().toLowerCase());
    if (cells.includes(H.first) && cells.includes(H.last)) { headerIdx = r; break; }
  }
  if (headerIdx === -1) {
    return { rows, errors: ['Could not find the header row ("First Name, Last Name, …"). Is this a LinkedIn connections export?'] };
  }

  const header = records[headerIdx].map((c) => c.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const cFirst = col(H.first), cLast = col(H.last), cUrl = col(H.url),
        cCompany = col(H.company), cPosition = col(H.position), cConnected = col(H.connected);

  for (let r = headerIdx + 1; r < records.length; r += 1) {
    const rec = records[r];
    if (rec.every((c) => c.trim() === "")) continue;
    const rowNo = r + 1;
    const firstName = (rec[cFirst] ?? "").trim();
    const lastName = (rec[cLast] ?? "").trim();
    if (!firstName && !lastName) {
      errors.push(`Row ${rowNo}: no name — skipped.`);
      continue;
    }
    const url = cUrl >= 0 ? (rec[cUrl] ?? "").trim() : "";
    rows.push({
      firstName: firstName || lastName,
      lastName: firstName ? lastName : "",
      linkedinUrl: url || null,
      company: cCompany >= 0 ? (rec[cCompany] ?? "").trim() || null : null,
      position: cPosition >= 0 ? (rec[cPosition] ?? "").trim() || null : null,
      connectedOn: cConnected >= 0 ? (rec[cConnected] ?? "").trim() || null : null,
    });
  }
  return { rows, errors };
}

/** "VP Marketing at Cobalt Fintech" → { position, company } — for synced relations. */
/** Everything after the company name on a LinkedIn headline: awards, taglines,
 *  hiring notices, emoji. "CEO @ Mediaplus North America | 2026 AdWeek 50 |
 *  2026 AdAge Best Places to Work" is one company and two accolades, and
 *  keeping all three made company_raw useless for reading, grouping or matching
 *  a competitor name against. Cut at the first separator. */
const HEADLINE_TAIL = /\s*[|·•‧∙►▪]\s*.*$|\s+[—–]\s+.*$/u;

export function splitHeadline(headline: string | null): { position: string | null; company: string | null } {
  if (!headline) return { position: null, company: null };
  // "at" and "@" both, and "@" is the common one in the wild — Radar's own copy
  // of this function handled only "at" and found a company for 30% of an event
  // search's authors where this finds one for most of them.
  const m = headline.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
  if (!m) return { position: headline.trim() || null, company: null };
  const company = m[2].replace(HEADLINE_TAIL, "").trim();
  return { position: m[1].trim() || null, company: company || null };
}
