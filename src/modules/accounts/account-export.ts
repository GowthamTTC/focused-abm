/**
 * The account brief as a spreadsheet — one flat sheet, the way a salesperson
 * reads a list.
 *
 * Nine columns in the order the eye wants them: the person, what kind of signal
 * it is, how to reach them, when, the links, then the note. Grouped by category
 * so the sheet reads in blocks rather than as an undifferentiated feed, and
 * within a block newest first.
 *
 * Columns this cannot fill are left EMPTY rather than guessed. LinkedIn's post
 * search does not return an author's location, so that column is blank and the
 * subtitle says so — a spreadsheet that quietly invents a column is worse than
 * one that admits a gap, because nobody checks a cell that looks filled.
 */
import ExcelJS from "exceljs";
import { loadL3, type VoicePost } from "@/modules/accounts/l3";

export const ACCOUNT_EXPORT_HEADER = [
  "Name", "Category", "Title", "Company", "Location",
  "Posted date", "LinkedIn Profile", "LinkedIn post link", "Notes", "Found via",
] as const;

/**
 * Category from the judge's own theme, not from pattern-matching the post.
 *
 * An earlier version tried to split "joined" from "left" by reading the text,
 * and it was wrong in both directions across three attempts: a woman who had
 * just joined read as a departure because she thanked a previous employer, and
 * a manager hosting a sales conference read as a joiner because the paragraph
 * mentioned when she had joined. A move announcement names two companies and
 * thanks one of them, and neither a character window nor a sentence boundary
 * reliably tells you which is which.
 *
 * On a sheet where a reader takes the blocks at face value, "Departure" against
 * someone who has just arrived is worse than no split at all. So the column
 * reports the theme a model assigned after reading the whole post, and the
 * direction of a move is left to the Notes, where the person's own words are.
 */
export function categoryOf(p: VoicePost): string {
  if (p.voice === "company") return "Company announcement";
  switch (p.theme) {
    case "restructuring": return "Restructuring";
    case "leadership":
    case "channel": return "People & leadership move";
    case "expansion": return "Hiring / expansion";
    case "marketing": return "Event / training";
    case "product": return "Product & launch";
    case "financial": return "Financial";
    case "legal": return "Legal & compliance";
    default: return "Company activity";
  }
}

/** Grouping order, so the blocks a reader acts on come first and the ones that
 *  are merely context come last. */
const ORDER = [
  "Restructuring", "People & leadership move", "Hiring / expansion",
  "Event / training", "Company announcement", "Product & launch",
  "Financial", "Legal & compliance", "Company activity",
];

function note(p: VoicePost): string {
  const raw = (p.evidence ?? p.body ?? "").replace(/\s+/g, " ").trim();
  return raw.length > 300 ? `${raw.slice(0, 297)}…` : raw;
}

export async function buildAccountWorkbook(
  orgId: string,
  key: string,
  opts: { focus?: string; aliases?: string[] } = {},
): Promise<{ buffer: Buffer; filename: string; rows: number }> {
  const v = await loadL3(orgId, key, key, opts.aliases ?? []);
  const subject = opts.focus || v.companyName;

  const rows = [...v.voicePosts].sort((a, b) => {
    const ca = ORDER.indexOf(categoryOf(a)), cb = ORDER.indexOf(categoryOf(b));
    if (ca !== cb) return (ca < 0 ? 99 : ca) - (cb < 0 ? 99 : cb);
    return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Focused ABM";
  const ws = wb.addWorksheet("Signals & Contacts");

  ws.mergeCells(1, 1, 1, ACCOUNT_EXPORT_HEADER.length);
  ws.getCell(1, 1).value = `${subject} — account signals & contacts`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };

  ws.mergeCells(2, 1, 2, ACCOUNT_EXPORT_HEADER.length);
  ws.getCell(2, 1).value =
    `Posts by people who say they work here and by the company's own pages. `
    + `Searched with: ${v.queries.filter((q) => q.stored > 0).map((q) => q.keywords).join("; ") || "—"}. `
    + `Phrases that returned nothing: ${v.queries.filter((q) => q.stored === 0).map((q) => q.keywords).join("; ") || "none"}. `
    + `Location is blank because LinkedIn's post search does not return it.`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: "FF667085" } };
  ws.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 30;

  const head = ws.getRow(3);
  ACCOUNT_EXPORT_HEADER.forEach((h, i) => { head.getCell(i + 1).value = h; });
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F4F7" } };
  });

  for (const p of rows) {
    const r = ws.addRow([
      p.who,
      categoryOf(p),
      p.role,
      v.companyName,
      "",
      p.publishedAt ? p.publishedAt.toISOString().slice(0, 10) : "",
      "", "",
      note(p),
      p.capturedBy ?? "company name scan",
    ]);
    // Link cells carry the words a reader clicks, not a raw URL — and stay
    // empty when there is nothing to point at, rather than linking somewhere
    // that is not the thing the column names.
    if (p.profileUrl) {
      r.getCell(7).value = { text: "View Profile", hyperlink: p.profileUrl };
      r.getCell(7).font = { color: { argb: "FF4F46E5" }, underline: true };
    }
    if (p.url) {
      r.getCell(8).value = { text: "View Post", hyperlink: p.url };
      r.getCell(8).font = { color: { argb: "FF4F46E5" }, underline: true };
    }
    r.getCell(9).alignment = { wrapText: true, vertical: "top" };
  }

  ws.columns = [
    { width: 24 }, { width: 20 }, { width: 38 }, { width: 20 }, { width: 14 },
    { width: 13 }, { width: 15 }, { width: 15 }, { width: 70 }, { width: 28 },
  ];
  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: ACCOUNT_EXPORT_HEADER.length } };

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { buffer, filename: `${slug}-signals.xlsx`, rows: rows.length };
}
