/**
 * Propose and TEST "who is not a prospect" lists for one workspace.
 *
 * A signal list is only defensible against the network it will run on, so this
 * fires candidate signals at the workspace's real companies and titles and
 * prints exactly who each one catches. Read-only — writes nothing.
 *
 *   npx tsx scripts/propose-signals.ts
 */
import "dotenv/config";
import { Pool } from "pg";
import { normalizeTitle } from "../src/modules/matching/normalize";

const EMAIL = process.env.WORKSPACE_EMAIL ?? "apingel@arielgroup.com";

/** Ariel sells leadership development, executive coaching, team/org
 *  development and executive advisory. Peers are firms that sell the same. */
const PEER_CANDIDATES = [
  "coaching", "executive coaching", "leadership development", "executive education",
  "organizational development", "corporate training", "leadership institute",
  "franklincovey", "korn ferry", "development dimensions", "center for creative leadership",
  "dale carnegie", "blanchard", "crucial learning", "vitalsmarts", "wilson learning",
  "betterup", "rhr international", "hogan assessments", "gallup", "mercer",
  "heidrick", "russell reynolds", "spencer stuart", "egon zehnder", "harvard business school",
];

/** For a leadership-development firm the DEFAULT list is actively wrong:
 *  "coach" and "mentor" describe its competitors, not its audience. What is
 *  genuinely un-sellable is a one-person practice with no budget behind it. */
const OFF_ICP_CANDIDATES = [
  "astrolog", "numerolog", "tarot", "psychic", "reiki", "energy healer",
  "manifestation", "life coach", "wellness coach", "spiritual healer",
];

function hit(text: string, signals: string[]): string | null {
  const t = normalizeTitle(text);
  if (!t) return null;
  for (const s of signals) if (s && t.includes(s)) return s;
  return null;
}

async function main() {
  const pg = new Pool({ connectionString: process.env.DATABASE_URL_PRODUCTION ?? process.env.DATABASE_URL });
  const u = await pg.query("select org_id from app_user where email = $1", [EMAIL]);
  const orgId = u.rows[0].org_id;
  const rows = await pg.query(
    `select company_raw, position_raw, headline_raw, bucket from connection where org_id = $1`, [orgId]);
  await pg.end();

  const people = rows.rows.map((r) => ({
    company: r.company_raw ?? "",
    title: r.position_raw ?? r.headline_raw ?? "",
    bucket: r.bucket as string | null,
  }));
  console.log(`${EMAIL} — ${people.length} people\n`);

  // ── Peer candidates ───────────────────────────────────────────────
  const peerFires = new Map<string, Map<string, number>>();
  for (const p of people) {
    const h = hit(p.company, PEER_CANDIDATES);
    if (!h) continue;
    if (!peerFires.has(h)) peerFires.set(h, new Map());
    const m = peerFires.get(h)!;
    m.set(p.company, (m.get(p.company) ?? 0) + 1);
  }
  console.log("=".repeat(70));
  console.log("CANDIDATE COMPETITOR SIGNALS — what each catches in his network");
  console.log("=".repeat(70));
  let peerTotal = 0;
  for (const s of PEER_CANDIDATES) {
    const m = peerFires.get(s);
    if (!m) continue;
    const n = [...m.values()].reduce((a, b) => a + b, 0);
    peerTotal += n;
    const names = [...m.keys()].slice(0, 3).map((c) => c.slice(0, 36));
    const cost = people.filter((p) => p.bucket === "pitchable" && hit(p.company, [s])).length;
    console.log(`  ${s.padEnd(26)} ${String(n).padStart(4)} fires  ${String(cost).padStart(4)} now-pitchable  e.g. ${names.join(" · ")}`);
  }
  console.log(`  ${"— caught in total".padEnd(32)} ${String(peerTotal).padStart(4)}`);
  const peerNever = PEER_CANDIDATES.filter((s) => !peerFires.has(s));
  console.log(`\n  never fire (safe to keep, costs nothing): ${peerNever.length}/${PEER_CANDIDATES.length}`);

  // ── Off-target candidates ─────────────────────────────────────────
  const offFires = new Map<string, Map<string, number>>();
  for (const p of people) {
    if (hit(p.company, PEER_CANDIDATES)) continue; // peer wins, as in the rule pass
    const h = hit(p.title, OFF_ICP_CANDIDATES);
    if (!h) continue;
    if (!offFires.has(h)) offFires.set(h, new Map());
    const m = offFires.get(h)!;
    m.set(p.title, (m.get(p.title) ?? 0) + 1);
  }
  console.log("\n" + "=".repeat(70));
  console.log("CANDIDATE OFF-TARGET TITLE SIGNALS");
  console.log("=".repeat(70));
  let offTotal = 0;
  for (const s of OFF_ICP_CANDIDATES) {
    const m = offFires.get(s);
    if (!m) continue;
    const n = [...m.values()].reduce((a, b) => a + b, 0);
    offTotal += n;
    console.log(`  ${s.padEnd(24)} ${String(n).padStart(4)}  e.g. ${[...m.keys()].slice(0, 3).map((c) => c.slice(0, 34)).join(" · ")}`);
  }
  console.log(`  ${"— caught in total".padEnd(24)} ${String(offTotal).padStart(4)}`);

  // ── What the CURRENT default list does to him ─────────────────────
  const { DEFAULT_PEER_COMPANY_SIGNALS, DEFAULT_OFF_ICP_TITLE_SIGNALS } =
    await import("../src/modules/matching/rule-pass");
  let defPeer = 0, defOff = 0;
  const defPeerEg = new Set<string>(), defOffEg = new Set<string>();
  for (const p of people) {
    const ph = hit(p.company, [...DEFAULT_PEER_COMPANY_SIGNALS]);
    if (ph) { defPeer += 1; if (defPeerEg.size < 6) defPeerEg.add(`${p.company.slice(0, 34)} [${ph}]`); continue; }
    const oh = hit(p.title, [...DEFAULT_OFF_ICP_TITLE_SIGNALS]);
    if (oh) { defOff += 1; if (defOffEg.size < 6) defOffEg.add(`${p.title.slice(0, 34)} [${oh}]`); }
  }
  console.log("\n" + "=".repeat(70));
  console.log("WHAT THE DEFAULT (marketing-agency) LISTS DO TO HIM TODAY");
  console.log("=".repeat(70));
  console.log(`  filed as peers by the default company list:   ${defPeer}`);
  for (const e of defPeerEg) console.log(`     ${e}`);
  console.log(`  filed off-target by the default title list:   ${defOff}`);
  for (const e of defOffEg) console.log(`     ${e}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
