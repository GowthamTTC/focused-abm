/**
 * Peer and off-target signals, re-applied on demand.
 *
 * Same bargain as the own-company rule: both tests are deterministic string
 * matches that cost nothing, so editing the lists takes effect immediately
 * instead of demanding a full Reclassify all (and the loss of every manual
 * correction) to enact a free rule.
 *
 * This runs in TypeScript rather than SQL on purpose. Both helpers normalise
 * their input first — lowercasing, stripping punctuation, expanding "VP" to
 * "vice president" — and reimplementing normalizeTitle in SQL would quietly
 * disagree with the classifier. Calling the real functions cannot drift.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, connection } from "@/db";
import {
  DEFAULT_OFF_ICP_TITLE_SIGNALS,
  DEFAULT_PEER_COMPANY_SIGNALS,
  OFF_ICP_MARK,
  PEER_MARK,
  companyPeerSignal,
  offIcpTitleSignal,
  offIcpWhy,
  peerWhy,
} from "./rule-pass";

export interface SignalRuleResult { peered: number; offTarget: number; released: number }

const CHUNK = 500;

async function inChunks(ids: string[], run: (slice: string[]) => Promise<unknown>) {
  for (let i = 0; i < ids.length; i += CHUNK) await run(ids.slice(i, i + CHUNK));
}

/** Fields every non-pitchable verdict must clear — rank and score belong to
 *  the pitchable pool only (rankBatch enforces the same invariant). */
const CLEARED = {
  serviceSlug: null,
  score: null,
  tier: null,
  rank: null,
  scoreBreakdownJson: null,
  matchMethod: "rule" as const,
  matchConfidence: 85,
};

export async function applySignalRules(
  orgId: string,
  peerSignals: string[] | undefined,
  offIcpSignals: string[] | undefined,
): Promise<SignalRuleResult> {
  const peers = peerSignals ?? DEFAULT_PEER_COMPANY_SIGNALS;
  const offs = offIcpSignals ?? DEFAULT_OFF_ICP_TITLE_SIGNALS;

  const rows = await db.select({
    id: connection.id,
    companyRaw: connection.companyRaw,
    positionRaw: connection.positionRaw,
    headlineRaw: connection.headlineRaw,
    bucket: connection.bucket,
    matchWhy: connection.matchWhy,
  }).from(connection).where(eq(connection.orgId, orgId));

  // Grouped by matched signal so each update carries the right why.
  const toPeer = new Map<string, string[]>();
  const toOff = new Map<string, string[]>();
  const toRelease: string[] = [];

  for (const r of rows) {
    // "excluded" is set by checks that run BEFORE these two (blank row, own
    // company, junior title). Demoting an excluded person to peer would
    // contradict the rule order, and changes nothing a user can see — neither
    // bucket is pitchable.
    if (r.bucket === "excluded") continue;

    const title = r.positionRaw ?? r.headlineRaw ?? "";
    const peerSig = companyPeerSignal(r.companyRaw ?? "", peers);
    const offSig = offIcpTitleSignal(title, offs);
    const why = r.matchWhy ?? "";

    if (peerSig) {
      if (r.bucket !== "peer_competitor") {
        const list = toPeer.get(peerSig) ?? [];
        list.push(r.id);
        toPeer.set(peerSig, list);
      }
      continue; // peer wins over off-target, as in the rule pass
    }
    if (offSig) {
      if (r.bucket !== "off_icp") {
        const list = toOff.get(offSig) ?? [];
        list.push(r.id);
        toOff.set(offSig, list);
      }
      continue;
    }
    // Nothing matches any more. Release only what THESE rules wrote — an
    // LLM verdict of off_icp is a judgment we have no business overturning.
    if (why.endsWith(PEER_MARK) || why.endsWith(OFF_ICP_MARK)) toRelease.push(r.id);
  }

  for (const [sig, ids] of toPeer) {
    await inChunks(ids, (slice) => db.update(connection)
      .set({ ...CLEARED, bucket: "peer_competitor", matchWhy: peerWhy(sig) })
      .where(and(eq(connection.orgId, orgId), inArray(connection.id, slice))));
  }
  for (const [sig, ids] of toOff) {
    await inChunks(ids, (slice) => db.update(connection)
      .set({ ...CLEARED, bucket: "off_icp", matchWhy: offIcpWhy(sig) })
      .where(and(eq(connection.orgId, orgId), inArray(connection.id, slice))));
  }
  await inChunks(toRelease, (slice) => db.update(connection).set({
    bucket: null,
    serviceSlug: null,
    matchConfidence: null,
    matchWhy: null,
    matchMethod: null,
    score: null,
    tier: null,
    rank: null,
    scoreBreakdownJson: null,
  }).where(and(eq(connection.orgId, orgId), inArray(connection.id, slice))));

  const count = (m: Map<string, string[]>) => [...m.values()].reduce((n, v) => n + v.length, 0);
  return { peered: count(toPeer), offTarget: count(toOff), released: toRelease.length };
}
