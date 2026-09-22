/** Read-only: the leadership/company posts and the query provenance. */
import { loadL3 } from "../src/modules/accounts/l3";
async function main() {
  const v = await loadL3(process.env.ORG_ID!, process.env.KEY!, process.env.KEY!, (process.env.ALIASES ?? "").split(",").filter(Boolean));
  console.log(JSON.stringify({
    voicePosts: v.voicePosts.length,
    withProvenance: v.voicePosts.filter((p) => p.capturedBy).length,
    posts: v.voicePosts.slice(0, 10).map((p) => ({
      who: p.who.slice(0, 26), voice: p.voice, at: p.publishedAt?.toISOString().slice(0,10) ?? null,
      theme: p.theme, via: p.capturedBy,
      line: (p.evidence ?? p.body ?? "").slice(0, 95),
    })),
    queries: v.queries.map((q) => `${q.keywords} ${q.stored}/${q.seen}`),
  }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
