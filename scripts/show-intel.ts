/** Read-only: print what the Intel panel shows for one company. */
import { loadIntel } from "../src/modules/intel/query";

async function main() {
  const v = await loadIntel(process.env.ORG_ID!, process.env.KEY!, process.env.NAME ?? process.env.KEY!);
  console.log(JSON.stringify({
    tone: v.tone, stored: v.stored, judged: v.judged, scored: v.scored,
    themes: v.themes,
    top: v.top.map((p) => ({
      s: p.sentiment, theme: p.theme, who: p.title,
      at: p.publishedAt?.toISOString().slice(0, 10) ?? null,
      quote: p.evidence, url: p.url,
    })),
  }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
