/** One deepdive call: which themes at this company open which of THIS
 *  workspace's offers. Reads signals, writes nothing.
 *
 *  VOICE=employee restricts the read to posts by people whose own headline
 *  says they work there — the question the market's half of the feed drowns. */
import { loadIntel } from "../src/modules/intel/query";
import { voiceOf, type Voice } from "../src/modules/intel/voice";
import { deriveTriggers } from "../src/modules/pulse/triggers";

async function main() {
  const orgId = process.env.ORG_ID!;
  const key = process.env.KEY!;
  const name = process.env.NAME ?? key;
  const aliases = (process.env.ALIASES ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  const voice = (process.env.VOICE ?? "").trim() as Voice | "";

  let ids: string[] | undefined;
  if (voice) {
    const view = await loadIntel(orgId, key, name, aliases);
    ids = view.posts.filter((p) => voiceOf(p.title, name, aliases) === voice).map((p) => p.id);
    console.error(`scoped to ${ids.length} ${voice} posts`);
    if (ids.length === 0) { console.log("[]"); process.exit(0); }
  }

  const t = await deriveTriggers(orgId, key, name, ids ? { ids } : {});
  console.log(JSON.stringify(t, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
