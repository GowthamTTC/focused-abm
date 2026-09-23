/**
 * The account brief as a PDF, built server-side.
 *
 * Not a screenshot of the page and not a print dialog: the document is drawn
 * from the same view the screen renders, so it can be downloaded by anyone
 * with the link to the route, on any browser, without a printer step. Every
 * profile, post, filing and article is a live annotation — a brief whose
 * evidence cannot be opened is a brief nobody can check.
 */
import PDFDocument from "pdfkit";
import { loadL3, type L3View } from "@/modules/accounts/l3";

const INK = "#101828";
const MUTED = "#667085";
const LINK = "#3538CD";
const RULE = "#E4E7EC";

/** One text run that is also a hyperlink, laid out inline. */
function link(doc: PDFKit.PDFDocument, label: string, url: string | null, opts: { size?: number } = {}) {
  doc.fontSize(opts.size ?? 9).fillColor(url ? LINK : MUTED);
  if (url) doc.text(label, { link: url, underline: false });
  else doc.text(label);
  doc.fillColor(INK);
}

function heading(doc: PDFKit.PDFDocument, text: string, sub?: string) {
  if (doc.y > 700) doc.addPage();
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(text);
  if (sub) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(sub);
  doc.moveDown(0.3);
  doc.strokeColor(RULE).lineWidth(0.5)
    .moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(9.5).fillColor(INK);
}

function para(doc: PDFKit.PDFDocument, text: string, opts: { size?: number; colour?: string; indent?: number } = {}) {
  doc.font("Helvetica").fontSize(opts.size ?? 9.5).fillColor(opts.colour ?? INK)
    .text(text, { indent: opts.indent ?? 0, align: "left" });
  doc.moveDown(0.25);
}

function label(doc: PDFKit.PDFDocument, text: string) {
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED).text(text.toUpperCase(), { characterSpacing: 0.6 });
  doc.font("Helvetica").fontSize(9.5).fillColor(INK);
}

export async function buildAccountPdf(
  orgId: string,
  key: string,
  opts: { focus?: string; aliases?: string[] } = {},
): Promise<{ buffer: Buffer; filename: string; view: L3View }> {
  const v = await loadL3(orgId, key, key, opts.aliases ?? [], undefined, opts.focus);

  const doc = new PDFDocument({ size: "A4", margin: 44, info: {
    Title: `Account Intelligence — ${v.companyName}${v.focusApplied ? ` · ${v.focusApplied}` : ""}`,
    Author: "Focused ABM",
  } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  // ── Cover line ──
  doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text("Account Intelligence");
  doc.font("Helvetica").fontSize(11).fillColor(MUTED)
    .text(`${v.companyName}${v.focusApplied ? ` › ${v.focusApplied}` : ""} · ${new Date().toISOString().slice(0, 10)}`);
  doc.moveDown(0.6);

  // ── Overview ──
  if (v.exec) {
    heading(doc, "Overview", "Executive summary and recommended next action.");
    label(doc, "What changed"); para(doc, v.exec.summary);
    label(doc, "Observed"); para(doc, v.exec.observed);
    label(doc, "Inferred"); para(doc, v.exec.inferred, { colour: "#B54708" });
    label(doc, "Next step");
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(v.exec.nextAction);
    doc.font("Helvetica").fontSize(9.5);
  }

  // ── Opportunities ──
  if (v.opportunities.length > 0) {
    heading(doc, "Opportunities", "Commercial hypotheses standing on more than one signal.");
    for (const o of v.opportunities) {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK)
        .text(`${o.offer} — ${o.strength.total}/100 · fits ${o.people.length} people`);
      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED)
        .text(o.strength.components.map((c) => `${c.label}: ${c.band}`).join(" · "));
      if (o.narrativeTitles.length > 0) para(doc, `Rests on: ${o.narrativeTitles.join(" · ")}`, { size: 9, colour: MUTED });
      if (o.why) para(doc, `${o.whyFor ? `Why, for ${o.whyFor}: ` : ""}${o.why}`);
      doc.moveDown(0.4);
    }
  }

  // ── Narratives ──
  if (v.narratives.length > 0) {
    heading(doc, "What keeps repeating", "The same thing observed from more than one direction.");
    for (const n of v.narratives) {
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK)
        .text(`${n.title} — ${n.strands} independent supporting signal${n.strands === 1 ? "" : "s"}`);
      para(doc, n.relevance, { size: 9, colour: MUTED });
      for (const e of n.evidence) {
        const line = `  ✓ ${e.at ? `${e.at.toISOString().slice(0, 10)} — ` : ""}${e.label} (${e.detail})`;
        link(doc, line, e.url);
      }
      doc.moveDown(0.45);
    }
  }

  // ── Press and events ──
  if (v.announcements.length > 0) {
    heading(doc, "Signals — on the record", "Press, filings and recorded events.");
    for (const a of v.announcements) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK)
        .text(`${a.title ?? "(untitled)"}${a.publishedAt ? ` · ${a.publishedAt.toISOString().slice(0, 10)}` : ""}`);
      if (a.contributesTo.length > 0) {
        para(doc, `Contributes to: ${a.contributesTo.join(" · ")} — ${a.strength}`, { size: 8.5, colour: MUTED });
      }
      para(doc, (a.body ?? "").replace(/\s+/g, " "));
      link(doc, a.url ?? "", a.url, { size: 8.5 });
      doc.moveDown(0.45);
    }
  }

  // ── Post mix ──
  if (v.postMix.length > 0) {
    heading(doc, "What is being posted", `${v.postMixTotal} stored posts, last 30 days, by kind.`);
    for (const m of v.postMix) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(
        `${m.label} — ${m.posts} posts · ${m.employee} employee · ${m.market} market · sentiment ${m.sentiment === null ? "not scored" : m.sentiment} (${m.judged} scored)`,
      );
      for (const e of m.examples) {
        link(doc, `  ${e.when ? e.when.toISOString().slice(0, 10) : "undated"} · ${e.who} (${e.voice}) — ${e.line}`, e.url, { size: 8 });
      }
      doc.moveDown(0.4);
    }
  }

  // ── Org map ──
  if (v.units.length > 0) {
    heading(doc, "Org map", "Business units and whitespace.");
    for (const u of v.units) {
      const state = u.engaged || u.people > 0 ? "engaged" : "whitespace";
      link(doc, `  ${u.unit.name} — ${state}${u.unit.website ? ` · ${u.unit.website}` : ""}`,
        u.unit.website ? `https://${u.unit.website.replace(/^https?:\/\//, "")}` : null, { size: 8.5 });
    }
  }

  // ── People ──
  if (v.contacts.length > 0) {
    heading(doc, "People", "Ranked by relevance to the opportunities, with the research behind each.");
    for (const [i, c] of v.contacts.entries()) {
      if (doc.y > 660) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK)
        .text(`${i + 1}. ${c.name} — relevance ${c.relevance.score} · ${c.relevance.buyingRole}`);
      para(doc, c.role, { size: 9, colour: MUTED });
      if (c.profileUrl) link(doc, `  ${c.profileUrl}`, c.profileUrl, { size: 8.5 });
      if (c.url) link(doc, `  most recent post`, c.url, { size: 8.5 });
      for (const r of c.relevance.reasons) para(doc, `  — ${r}`, { size: 8.5, colour: "#475467" });
      para(doc, `  Gap · ${c.relevance.gap}`, { size: 8.5, colour: "#B54708" });
      if (c.research) {
        if (c.research.offer) para(doc, `  Offer · ${c.research.offer}${c.research.offerWhy ? ` — ${c.research.offerWhy}` : ""}`, { size: 8.5 });
        para(doc, `  Observed · ${c.research.observed}`, { size: 8.5 });
        if (c.research.postsRead) para(doc, `  Posts · ${c.research.postsRead}`, { size: 8.5, colour: MUTED });
        para(doc, `  Inferred · ${c.research.inferred}`, { size: 8.5, colour: "#B54708" });
      }
      doc.moveDown(0.5);
    }
  }

  // ── Unknowns ──
  if (v.unknowns.length > 0) {
    heading(doc, "Unknowns", "What nobody has established, and that would change the approach.");
    for (const u of v.unknowns) para(doc, `☐ ${u}`);
  }

  // ── Sources ──
  if (v.sources.length > 0) {
    heading(doc, "Sources", "Everything above, with a link to each.");
    for (const s of v.sources) {
      link(doc, `  [${s.kind}] ${s.title}${s.source ? ` — ${s.source}` : ""}${s.when ? ` · ${s.when.toISOString().slice(0, 10)}` : ""}`, s.url, { size: 8.5 });
    }
  }

  doc.end();
  const buffer = await done;
  const slug = `${v.focusApplied ?? v.companyName}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { buffer, filename: `account-intelligence-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`, view: v };
}
