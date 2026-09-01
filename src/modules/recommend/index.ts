/**
 * Six recommenders over this org's pitchable network.
 * 1 weighted score  2 account-first  3 title clusters
 * 4 committee gaps  5 bandit on send outcomes  6 token lookalike
 */
import { and, eq } from "drizzle-orm";
import { db, accountShortlist, connection } from "@/db";
import { companyKey } from "@/modules/radar/score";

export type Role = "cxo" | "vp" | "head" | "director" | "manager" | "founder" | "ic";

export function roleFromTitle(title: string | null | undefined): Role {
  const t = (title ?? "").toLowerCase();
  if (/\b(founder|co-?founder|owner)\b/.test(t)) return "founder";
  if (/\b(chief|ceo|cfo|coo|cto|cmo|chro|cio|ciso|president)\b/.test(t)) return "cxo";
  if (/\b(vice president|\bvp\b|svp|evp)\b/.test(t)) return "vp";
  if (/\bhead of\b|\bhead,\b/.test(t)) return "head";
  if (/\bdirector\b/.test(t)) return "director";
  if (/\bmanager\b|\blead\b/.test(t)) return "manager";
  return "ic";
}

const ROLE_LABEL: Record<Role, string> = {
  cxo: "CXO / President",
  vp: "VP",
  head: "Head of",
  director: "Director",
  manager: "Manager / Lead",
  founder: "Founder",
  ic: "IC / other",
};

const COMMITTEE: Role[] = ["cxo", "vp", "head", "director"];

function recencyBoost(at: Date | null): number {
  if (!at) return 0;
  const days = (Date.now() - at.getTime()) / 86400000;
  if (days <= 7) return 1;
  if (days <= 14) return 0.7;
  if (days <= 30) return 0.4;
  if (days <= 90) return 0.15;
  return 0;
}

function tokenize(s: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const w of s.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2)) {
    map.set(w, (map.get(w) ?? 0) + 1);
  }
  return map;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const u = b.get(k);
    if (u) dot += v * u;
  }
  for (const v of b.values()) nb += v * v;
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Thompson-style draw from Beta(1+ok, 1+bad) via two exponentials (Gamma(n,1) for integer). */
function sampleBeta(ok: number, bad: number): number {
  const ga = (n: number) => {
    const shape = Math.max(1, n);
    let s = 0;
    for (let i = 0; i < Math.min(8, Math.round(shape)); i++) s -= Math.log(1 - Math.random());
    return s || 1;
  };
  const x = ga(1 + ok);
  const y = ga(1 + bad);
  return x / (x + y);
}

type Row = {
  id: string;
  firstName: string;
  lastName: string;
  companyRaw: string | null;
  positionRaw: string | null;
  score: number | null;
  enrichStatus: string;
  lastPostAt: Date | null;
  sentAt: Date | null;
  flagVerdict: string | null;
  country: string | null;
  mentionAt: Date | null;
  outreachMessage: string | null;
  serviceSlug: string | null;
  matchWhy: string | null;
  batchId: string;
};

export function personWeight(p: Row, companySize: number, shortlisted: boolean): number {
  const icp = Math.min(100, p.score ?? 0) / 100;
  const recency = recencyBoost(p.lastPostAt);
  const coverage = Math.min(1, companySize / 5);
  const radar = p.mentionAt && (Date.now() - p.mentionAt.getTime()) < 14 * 86400000 ? 1 : 0;
  const handled = p.sentAt ? 1 : p.enrichStatus === "done" ? 0.4 : 0;
  const star = shortlisted ? 0.15 : 0;
  return 0.40 * icp + 0.25 * recency + 0.15 * coverage + 0.15 * radar + star - 0.20 * handled;
}

export async function recommendAll(orgId: string) {
  const people = await db.select({
    id: connection.id,
    firstName: connection.firstName,
    lastName: connection.lastName,
    companyRaw: connection.companyRaw,
    positionRaw: connection.positionRaw,
    score: connection.score,
    enrichStatus: connection.enrichStatus,
    lastPostAt: connection.lastPostAt,
    sentAt: connection.sentAt,
    flagVerdict: connection.flagVerdict,
    country: connection.country,
    mentionAt: connection.mentionAt,
    outreachMessage: connection.outreachMessage,
    serviceSlug: connection.serviceSlug,
    matchWhy: connection.matchWhy,
    batchId: connection.batchId,
  }).from(connection).where(and(
    eq(connection.orgId, orgId),
    eq(connection.bucket, "pitchable"),
  ));

  const stars = await db.select({ key: accountShortlist.companyKey })
    .from(accountShortlist).where(eq(accountShortlist.orgId, orgId));
  const starSet = new Set(stars.map((s) => s.key));

  const byCo = new Map<string, typeof people>();
  for (const p of people) {
    const k = companyKey(p.companyRaw);
    if (k === "_none") continue;
    const list = byCo.get(k) ?? [];
    list.push(p);
    byCo.set(k, list);
  }

  const personRanked = people.map((p) => {
    const k = companyKey(p.companyRaw);
    const n = byCo.get(k)?.length ?? 1;
    return { p, w: personWeight(p, n, starSet.has(k)), role: roleFromTitle(p.positionRaw) };
  }).sort((a, b) => b.w - a.w);

  const accounts = [...byCo.entries()].map(([key, list]) => {
    const name = (list[0]?.companyRaw ?? "").trim();
    const weights = list.map((p) => personWeight(p, list.length, starSet.has(key)));
    const avg = weights.reduce((s, x) => s + x, 0) / Math.max(1, weights.length);
    const posted14 = list.filter((p) => recencyBoost(p.lastPostAt) >= 0.7).length;
    const pending = list.filter((p) => ["pending", "failed", "skipped"].includes(p.enrichStatus)).length;
    const roles = new Set(list.map((p) => roleFromTitle(p.positionRaw)));
    const missing = COMMITTEE.filter((r) => !roles.has(r));
    return {
      key, name, n: list.length,
      avg: Math.round(avg * 100),
      posted14, pending,
      shortlisted: starSet.has(key),
      missing,
      action: pending > 0 ? `enrich ${pending} remaining` : "review drafts / send",
    };
  }).sort((a, b) =>
    b.avg - a.avg
    || b.posted14 - a.posted14
    || b.pending - a.pending
    || b.n - a.n
    || Number(a.shortlisted) - Number(b.shortlisted)
  );

  const titleBuckets = new Map<Role, { n: number; byCo: Map<string, number> }>();
  for (const p of people) {
    const role = roleFromTitle(p.positionRaw);
    const cur = titleBuckets.get(role) ?? { n: 0, byCo: new Map() };
    cur.n += 1;
    const name = (p.companyRaw ?? "Unknown").trim() || "Unknown";
    cur.byCo.set(name, (cur.byCo.get(name) ?? 0) + 1);
    titleBuckets.set(role, cur);
  }
  const titles = [...titleBuckets.entries()].map(([role, v]) => {
    const top = [...v.byCo.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      role, label: ROLE_LABEL[role], n: v.n,
      topAccount: top?.[0] ?? null,
      topN: top?.[1] ?? 0,
      share: top && v.n ? Math.round((top[1] / v.n) * 100) : 0,
    };
  }).sort((a, b) => b.n - a.n);

  const committee = accounts
    .filter((a) => a.n >= 2 && a.missing.length > 0)
    .slice(0, 8)
    .map((a) => ({ name: a.name, have: a.n, missing: a.missing.map((r) => ROLE_LABEL[r]) }));

  const arms = new Map<string, { ok: number; bad: number; n: number }>();
  for (const p of people) {
    const key = `${p.serviceSlug ?? "none"}|${roleFromTitle(p.positionRaw)}|${(p.country ?? "unknown").trim() || "unknown"}`;
    const arm = arms.get(key) ?? { ok: 0, bad: 0, n: 0 };
    arm.n += 1;
    if (p.sentAt || p.flagVerdict === "variant") arm.ok += 1;
    if (p.flagVerdict === "dropped") arm.bad += 1;
    arms.set(key, arm);
  }
  const bandit = [...arms.entries()].map(([key, a]) => {
    const [service, role, country] = key.split("|");
    return {
      service, role, country,
      tried: a.n, wins: a.ok, drops: a.bad,
      p: Math.round(sampleBeta(a.ok, a.bad) * 100),
    };
  }).sort((x, y) => y.p - x.p).slice(0, 8);

  const seeds = people.filter((p) => p.outreachMessage || p.flagVerdict === "variant" || p.sentAt);
  const seedVecs = seeds.map((p) => tokenize(`${p.positionRaw ?? ""} ${p.companyRaw ?? ""} ${p.matchWhy ?? ""} ${p.serviceSlug ?? ""}`));
  const lookalike = people
    .filter((p) => !p.sentAt && p.enrichStatus !== "done")
    .map((p) => {
      const v = tokenize(`${p.positionRaw ?? ""} ${p.companyRaw ?? ""} ${p.matchWhy ?? ""} ${p.serviceSlug ?? ""}`);
      const sim = seedVecs.length ? Math.max(...seedVecs.map((s) => cosine(v, s))) : 0;
      return { p, sim };
    })
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 8);

  const nextAccount = accounts.find((a) => a.pending > 0 && (a.shortlisted || a.avg >= 40)) ?? accounts[0];
  const recommendation = nextAccount
    ? `Recommendation: ${nextAccount.shortlisted ? "Enrich" : "Shortlist then enrich"} ${nextAccount.name} (${nextAccount.n} people, ${nextAccount.pending} not researched, weighted ${nextAccount.avg}).`
    : "Recommendation: Run matching so pitchable accounts appear, then shortlist 3 companies.";

  return {
    recommendation,
    accounts: accounts.slice(0, 20),
    titles,
    committee,
    bandit,
    lookalike: lookalike.map(({ p, sim }) => ({
      name: `${p.firstName} ${p.lastName}`,
      company: p.companyRaw,
      title: p.positionRaw,
      similarToReady: Math.round(sim * 100),
      id: p.id,
    })),
    weightedPeople: personRanked.slice(0, 8).map(({ p, w, role }) => ({
      name: `${p.firstName} ${p.lastName}`,
      company: p.companyRaw,
      title: p.positionRaw,
      role,
      score: p.score,
      rec: Math.round(w * 100),
      status: p.enrichStatus,
      id: p.id,
    })),
  };
}

export function formatRecommend(r: Awaited<ReturnType<typeof recommendAll>>): string {
  const lines: string[] = [r.recommendation, ""];
  lines.push("Top accounts:");
  for (const a of r.accounts) {
    lines.push(`- ${a.name}: ${a.n} people, weighted ${a.avg}, ${a.posted14} active in 14d, ${a.pending} not researched${a.shortlisted ? ", shortlisted" : ""}. Next: ${a.action}.`);
  }
  lines.push("", "Title mix:");
  for (const t of r.titles) {
    lines.push(`- ${t.label}: ${t.n}` + (t.topAccount ? `, most at ${t.topAccount} (${t.topN}, ${t.share}%)` : ""));
  }
  if (r.committee.length) {
    lines.push("", "Committee gaps:");
    for (const c of r.committee.slice(0, 5)) {
      lines.push(`- ${c.name} (${c.have} seats) missing ${c.missing.join(", ")}.`);
    }
  }
  if (r.bandit.length) {
    lines.push("", "Outcome bandit (service x role x country):");
    for (const b of r.bandit.slice(0, 5)) {
      lines.push(`- ${b.service} / ${b.role} / ${b.country}: p=${b.p} from ${b.wins} wins, ${b.drops} drops, ${b.tried} people.`);
    }
  }
  if (r.lookalike.length) {
    lines.push("", "Lookalikes of drafted/sent people:");
    for (const p of r.lookalike.slice(0, 5)) {
      lines.push(`- ${p.name} @ ${p.company} (${p.title ?? "—"}) similar ${p.similarToReady}%`);
    }
  }
  lines.push("", "Priority people:");
  for (const p of r.weightedPeople.slice(0, 5)) {
    lines.push(`- ${p.name} @ ${p.company} · ${p.title ?? "—"} · rec ${p.rec} · ICP ${p.score ?? "—"} · ${p.status}`);
  }
  return lines.join("\n");
}
