/** Read-only: what the L3 page will render. */
import { loadL3 } from "../src/modules/accounts/l3";
async function main() {
  const v = await loadL3(process.env.ORG_ID!, process.env.KEY!, process.env.KEY!, (process.env.ALIASES ?? "").split(",").filter(Boolean));
  console.log(JSON.stringify({
    company: v.companyName, counts: v.counts, whitespacePct: v.whitespacePct,
    footprint: v.footprint.map((u) => u.name),
    whitespace: v.whitespace.map((u) => u.name),
    linkedin: { tone: v.linkedin.tone, gauge: v.linkedin.gauge, stored: v.linkedin.stored,
      inside: v.linkedin.insideTone, market: v.linkedin.marketTone,
      themes: v.linkedin.themes, volumePoints: v.linkedin.volume.length, volumeChangePct: v.linkedin.volumeChangePct,
      top: v.linkedin.top.map((t) => ({ s: t.sentiment, who: (t.title ?? "").slice(0, 40) })) },
    changeSignals: v.changeSignals.map((s) => ({ src: s.source, at: s.publishedAt?.toISOString().slice(0,10), t: (s.title ?? "").slice(0, 50) })),
    triggers: v.triggers.length,
    decisionMakers: v.decisionMakers.map((d) => ({ role: d.role, person: d.person?.name ?? null })),
  }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
