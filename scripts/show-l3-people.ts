/** Read-only: the contacts and incumbents the L3 page will show. */
import { loadL3 } from "../src/modules/accounts/l3";
async function main() {
  const v = await loadL3(process.env.ORG_ID!, process.env.KEY!, process.env.KEY!, (process.env.ALIASES ?? "").split(",").filter(Boolean));
  console.log(JSON.stringify({
    contacts: v.contacts.map((c) => ({ name: c.name, role: c.role.slice(0, 58), at: c.lastPostAt?.toISOString().slice(0,10) ?? null })),
    competitors: v.competitors.map((c) => ({ peer: c.peer, n: c.mentions, snippet: (c.snippet ?? "").slice(0, 150) })),
  }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
