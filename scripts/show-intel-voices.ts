/** Read-only: the voice split for one company. */
import { loadIntel } from "../src/modules/intel/query";

async function main() {
  const aliases = (process.env.ALIASES ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  const v = await loadIntel(process.env.ORG_ID!, process.env.KEY!, process.env.NAME ?? process.env.KEY!, aliases);
  console.log(JSON.stringify({
    overall: v.tone,
    voices: v.voices.map((b) => ({
      voice: b.voice, tone: b.tone, stored: b.stored, scored: b.scored,
      top: b.top.map((p) => ({
        s: p.sentiment, theme: p.theme, who: (p.title ?? "").slice(0, 64),
        at: p.publishedAt?.toISOString().slice(0, 10) ?? null,
        line: (p.evidence ?? p.body ?? "").slice(0, 170),
      })),
    })),
  }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
