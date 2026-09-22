/** One deepdive call: which themes at this company open which of THIS
 *  workspace's offers. Reads signals, writes nothing. */
import { deriveTriggers } from "../src/modules/pulse/triggers";

async function main() {
  const t = await deriveTriggers(process.env.ORG_ID!, process.env.KEY!, process.env.NAME ?? process.env.KEY!);
  console.log(JSON.stringify(t, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
