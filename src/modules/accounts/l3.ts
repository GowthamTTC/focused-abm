/**
 * L3 Account Intelligence — one account, read four ways.
 *
 * Footprint (what the team says it has), whitespace (what the org chart says it
 * has not), change signals (what the outside world said lately), and the people
 * question (who to approach), which is answered honestly as "not yet known"
 * rather than guessed.
 *
 * Every number here is derived from a row somebody can go and look at. The one
 * thing this file deliberately does NOT do is invent a composite score: an
 * "opportunity: 86/100" with no definition behind it reads as rigour and is the
 * fastest way to lose a room that asks how it was calculated.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, accountSignal, connection, job } from "@/db";
import { companyKey } from "@/modules/radar/score";
import { meanSentiment, type Band, type Trigger } from "@/modules/pulse/types";
import { loadAccountMap, mapKeys, type AccountMapRow } from "@/modules/accounts/org-map";
import { voiceOf } from "@/modules/intel/voice";
import { isUsPost } from "@/modules/accounts/us-filter";
import { competitorHits } from "@/modules/pulse/competitors";
import { getOrgSettings } from "@/modules/settings/org-settings";
import { DEFAULT_TRIGGERS, scoreTriggers, type TriggerScore } from "@/modules/accounts/trigger-vocab";
import type { CompetitorHit } from "@/modules/pulse/types";
import type { OrgUnit } from "@/db";
import { desc } from "drizzle-orm";

/** The seats an expansion play has to find. Fixed, because the question "who
 *  owns change at this BU" has the same shape at every large company — and
 *  because a list that shifts with whoever happens to be in the network would
 *  quietly redefine the target to match the data. */
export const TARGET_ROLES: { role: string; seniority: string; match: string[] }[] = [
  { role: "CHRO / Head of HR", seniority: "C-level", match: ["chro", "chief people", "chief human"] },
  { role: "Chief Legal Officer", seniority: "C-level", match: ["chief legal", "general counsel", "clo"] },
  { role: "People / Org Transformation Leader", seniority: "VP+", match: ["organization", "organisational", "transformation", "people"] },
  { role: "Customer Operations Executive", seniority: "VP+", match: ["customer operations", "commercial operations", "customer excellence"] },
  { role: "Business Unit President", seniority: "C-level", match: ["president", "general manager", "country manager"] },
];

export interface DecisionMakerRow {
  role: string;
  seniority: string;
  /** Null when nobody in the network holds this seat — which the page prints as
   *  "to be identified", never as a blank that could read as "nobody there". */
  person: { id: string; name: string; positionRaw: string | null; linkedinUrl: string | null } | null;
}

export interface UnitNode {
  unit: OrgUnit;
  /** Asserted by the team. */
  engaged: boolean;
  /** Evidenced by people in this workspace's network. */
  people: number;
}

export interface SignalCard {
  id: string;
  kind: string;
  source: string | null;
  title: string | null;
  url: string | null;
  publishedAt: Date | null;
  body: string | null;
  theme: string | null;
  sentiment: number | null;
}

export interface TopSignal extends SignalCard {
  evidence: string | null;
}

/** Someone whose own LinkedIn headline says they work at this account. Named
 *  because they named themselves, in public, in a post this workspace already
 *  stored — not inferred, not enriched, not bought. It is the only route that
 *  has produced actual names at an account nobody here is connected to. */
/** A post by someone at the account or by the company itself, with the search
 *  phrase that surfaced it. The provenance is the point: a claim made from
 *  these posts can be traced back to how they were looked for. */
export interface VoicePost {
  id: string;
  who: string;
  role: string;
  voice: "employee" | "company";
  publishedAt: Date | null;
  theme: string | null;
  sentiment: number | null;
  body: string | null;
  evidence: string | null;
  url: string | null;
  profileUrl: string | null;
  capturedBy: string | null;
}

/** One search this account has been read with, and what it returned. */
export interface QueryRun {
  keywords: string;
  seen: number;
  stored: number;
  at: Date | null;
}

export interface SignalContact {
  name: string;
  role: string;
  lastPostAt: Date | null;
  url: string | null;
  theme: string | null;
}

export interface L3View {
  companyKey: string;
  companyName: string;
  map: AccountMapRow | null;
  units: UnitNode[];
  footprint: OrgUnit[];
  whitespace: OrgUnit[];
  counts: { pockets: number; mapped: number; whitespace: number; changeSignals: number };
  /** Share of mapped functions with no engagement. Stated, not scored. */
  whitespacePct: number | null;
  linkedin: {
    tone: Band;
    /** 0–100 restatement of tone for a gauge. Null stays null. */
    gauge: number | null;
    stored: number;
    themes: { theme: string; n: number }[];
    volume: { week: string; n: number }[];
    volumeChangePct: number | null;
    top: TopSignal[];
    insideTone: Band;
    marketTone: Band;
  };
  changeSignals: SignalCard[];
  /** What the account has posted from its OWN LinkedIn pages lately. Its
   *  newsroom publishes investor calendar; its LinkedIn page publishes what the
   *  business is actually doing, which is the thing a seller wants. */
  companyUpdates: VoicePost[];
  /** Null country = the whole feed. `located` says how many rows could be
   *  placed at all, which a reader needs before trusting a country split. */
  geo: { country: string | null; located: number; total: number };
  triggers: Trigger[];
  decisionMakers: DecisionMakerRow[];
  contacts: SignalContact[];
  /** Which buying-signal phrases this account's posts contain, and what that
   *  adds up to. Every point traces to a phrase in a post you can open. */
  triggerScore: TriggerScore;
  /** Leadership and company posts, newest first — the evidence a reader is
   *  asked to look at rather than take on trust. */
  voicePosts: VoicePost[];
  /** Every phrase this account has been searched with, and its yield. */
  queries: QueryRun[];
  competitors: CompetitorHit[];
  refreshedAt: Date | null;
}

const WINDOW_DAYS = 90;

function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - t.getUTCDay());
  return t.toISOString().slice(0, 10);
}

export async function loadL3(
  orgId: string,
  key: string,
  nameHint: string,
  extraAliases: string[] = [],
  /** Restrict every LinkedIn number to authors in this country. Rows stored
   *  before author_country existed are null and are EXCLUDED rather than
   *  assumed — "we do not know where they are" is not "they are here". */
  country?: string,
): Promise<L3View> {
  const map = await loadAccountMap(orgId, key);
  const companyName = map?.name ?? nameHint ?? key;

  // Signals for this account AND for any unit that is tracked under its own
  // key — Allergan Aesthetics is scanned as itself, and an AbbVie-level page
  // that ignored that would show an empty feed next to a full one.
  const unitKeys = new Set<string>([key]);
  for (const u of map?.units ?? []) unitKeys.add(companyKey(u.name));
  for (const a of map?.aliases ?? []) unitKeys.add(companyKey(a));

  const signals = await db.select({
    id: accountSignal.id,
    kind: accountSignal.kind,
    source: accountSignal.source,
    title: accountSignal.title,
    url: accountSignal.url,
    publishedAt: accountSignal.publishedAt,
    body: accountSignal.body,
    theme: accountSignal.theme,
    sentiment: accountSignal.sentiment,
    evidence: accountSignal.evidence,
    companyName: accountSignal.companyName,
    signalKey: accountSignal.companyKey,
    capturedBy: accountSignal.capturedBy,
    authorProfileUrl: accountSignal.authorProfileUrl,
    authorCountry: accountSignal.authorCountry,
    authorLocation: accountSignal.authorLocation,
  }).from(accountSignal).where(and(
    eq(accountSignal.orgId, orgId),
    inArray(accountSignal.companyKey, [...unitKeys]),
  )).orderBy(desc(accountSignal.publishedAt)).limit(400);

  const allLi = signals.filter((s) => s.kind === "linkedin");
  // A country filter over rows that carry no country is not a filter, it is an
  // eraser: it emptied sentiment, themes and change signals while the buying
  // score — which never read the parameter — went on showing 50. Hiding the
  // control was not enough, because the parameter survives in a bookmarked URL.
  // When nothing can be placed, the filter is inert rather than absolute.
  const placeable = allLi.some((s) => s.authorCountry);
  const li = country && placeable
    ? allLi.filter((s) => (s.authorCountry ?? "").toLowerCase() === country.toLowerCase())
    : allLi;
  /** How much of the feed could be placed at all — the coverage line, so a
   *  small country number is not mistaken for a quiet country. */
  const geo = {
    country: placeable ? (country ?? null) : null,
    located: allLi.filter((s) => s.authorCountry).length,
    total: allLi.length,
  };
  const news = signals.filter((s) => s.kind === "news" || s.kind === "filing");

  const tone = meanSentiment(li.map((s) => ({ sentiment: s.sentiment, at: s.publishedAt })));
  // A gauge wants 0–100; sentiment is −100..100. This is a restatement of one
  // number, not a new one, and the page says so.
  const gauge = tone.score === null ? null : Math.round((tone.score + 100) / 2);

  const themeCount = new Map<string, number>();
  for (const s of li) {
    if (!s.theme) continue;
    themeCount.set(s.theme, (themeCount.get(s.theme) ?? 0) + 1);
  }
  const themes = [...themeCount.entries()]
    .map(([theme, n]) => ({ theme, n }))
    .sort((a, b) => b.n - a.n);

  const cutoff = Date.now() - WINDOW_DAYS * 86400000;
  const weeks = new Map<string, number>();
  for (const s of li) {
    if (!s.publishedAt || s.publishedAt.getTime() < cutoff) continue;
    const k = weekKey(s.publishedAt);
    weeks.set(k, (weeks.get(k) ?? 0) + 1);
  }
  const volume = [...weeks.entries()].map(([week, n]) => ({ week, n })).sort((a, b) => a.week.localeCompare(b.week));
  // No trend percentage, deliberately. This series counts posts WE HAVE STORED
  // per week, and what we hold is decided by when a scan was run and which
  // phrase it used — not by how much the company posted. Early weeks are thin
  // because nobody had searched yet, so a first-half against second-half
  // comparison reported +650% on an account that had simply been scanned
  // twice. A growth figure on a client-facing page has to mean growth.
  const volumeChangePct = null;

  const insideTone = meanSentiment(li
    .filter((s) => voiceOf(s.title, s.companyName ?? companyName, extraAliases) === "employee")
    .map((s) => ({ sentiment: s.sentiment, at: s.publishedAt })));
  const marketTone = meanSentiment(li
    .filter((s) => voiceOf(s.title, s.companyName ?? companyName, extraAliases) === "market")
    .map((s) => ({ sentiment: s.sentiment, at: s.publishedAt })));

  const top: TopSignal[] = li
    .filter((s) => s.sentiment !== null && s.evidence)
    .sort((a, b) => Math.abs(b.sentiment ?? 0) - Math.abs(a.sentiment ?? 0)
      || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .slice(0, 5);

  // ── the org chart ──
  const keys = map ? mapKeys(map) : [];
  const people = keys.length > 0
    ? await db.select({
        id: connection.id,
        firstName: connection.firstName,
        lastName: connection.lastName,
        companyRaw: connection.companyRaw,
        positionRaw: connection.positionRaw,
        linkedinUrl: connection.linkedinUrl,
        division: connection.division,
      }).from(connection).where(and(
        eq(connection.orgId, orgId),
        eq(connection.bucket, "pitchable"),
      ))
    : [];
  const mine = people.filter((p) => keys.includes(companyKey(p.companyRaw)));

  const units: UnitNode[] = (map?.units ?? []).map((u) => ({
    unit: u,
    engaged: Boolean(u.engaged),
    people: mine.filter((p) => (p.division ?? "").toLowerCase() === u.name.toLowerCase()).length,
  }));
  const footprint = units.filter((u) => u.engaged || u.people > 0).map((u) => u.unit);
  const whitespace = units.filter((u) => !u.engaged && u.people === 0).map((u) => u.unit);
  const mapped = units.length;
  const whitespacePct = mapped > 0 ? Math.round((whitespace.length / mapped) * 100) : null;

  // ── who to approach ──
  const decisionMakers: DecisionMakerRow[] = TARGET_ROLES.map((r) => {
    const hit = mine.find((p) => {
      const t = (p.positionRaw ?? "").toLowerCase();
      return r.match.some((m) => t.includes(m));
    });
    return {
      role: r.role,
      seniority: r.seniority,
      person: hit
        ? { id: hit.id, name: `${hit.firstName} ${hit.lastName}`.trim(), positionRaw: hit.positionRaw, linkedinUrl: hit.linkedinUrl }
        : null,
    };
  });

  // Authors whose headline names the employer. Deduped by person, newest post
  // kept, so a prolific poster is one row rather than five.
  const byPerson = new Map<string, SignalContact>();
  for (const sg of allLi) {
    if (voiceOf(sg.title, sg.companyName ?? companyName, extraAliases) !== "employee") continue;
    const [namePart, ...rest] = (sg.title ?? "").split(" \u2014 ");
    const name = namePart.trim();
    if (!name) continue;
    const prev = byPerson.get(name.toLowerCase());
    if (prev && (prev.lastPostAt?.getTime() ?? 0) >= (sg.publishedAt?.getTime() ?? 0)) continue;
    byPerson.set(name.toLowerCase(), {
      name,
      role: rest.join(" \u2014 ").trim(),
      lastPostAt: sg.publishedAt,
      url: sg.url,
      theme: sg.theme,
    });
  }
  const contacts = [...byPerson.values()]
    .sort((a, b) => (b.lastPostAt?.getTime() ?? 0) - (a.lastPostAt?.getTime() ?? 0));

  // Leadership and company voices only. The market half of the feed is
  // practitioners talking about products, and it is not what an account plan
  // is arguing from.
  const voicePosts: VoicePost[] = allLi
    .map((sg) => ({ sg, voice: voiceOf(sg.title, sg.companyName ?? companyName, extraAliases) }))
    .filter((x) => x.voice === "employee" || x.voice === "company")
    .map(({ sg, voice }) => {
      const [namePart, ...rest] = (sg.title ?? "").split(" \u2014 ");
      return {
        id: sg.id,
        who: namePart.trim(),
        role: rest.join(" \u2014 ").trim(),
        voice: voice as "employee" | "company",
        publishedAt: sg.publishedAt,
        theme: sg.theme,
        sentiment: sg.sentiment,
        body: sg.body,
        evidence: sg.evidence,
        url: sg.url,
        profileUrl: sg.authorProfileUrl,
        capturedBy: sg.capturedBy,
      };
    })
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  // The account's own LinkedIn pages, newest first. Its newsroom publishes an
  // investor calendar; its LinkedIn page publishes what the business is doing.
  const UPDATE_WINDOW_DAYS = 30;
  const updateCutoff = Date.now() - UPDATE_WINDOW_DAYS * 86400000;
  const companyUpdates = voicePosts
    .filter((p) => p.voice === "company")
    .filter((p) => !p.publishedAt || p.publishedAt.getTime() >= updateCutoff)
    // US only. There is no location field on a post, so this excludes what it
    // can show is elsewhere — a page that names another market, or a post
    // written in another language — rather than demanding proof of US-ness the
    // parent page never offers.
    .filter((p) => isUsPost(p.who, p.body))
    // Same story, stored once per unit key it was collected under.
    .filter((p, i, arr) => {
      const id = (p.url || p.body || "").trim().toLowerCase();
      return !id || arr.findIndex((q) => (q.url || q.body || "").trim().toLowerCase() === id) === i;
    })
    .slice(0, 6);

  // Buying signals, scored. The vocabulary is the workspace's own when it has
  // one; undefined falls back to the built-in list, and [] switches it off.
  const orgSettings = await getOrgSettings(orgId);
  const vocab = orgSettings.triggerSignals ?? DEFAULT_TRIGGERS;
  const triggerScore = scoreTriggers(
    allLi.map((sg) => ({
      title: sg.title, body: sg.body, evidence: sg.evidence,
      url: sg.url, publishedAt: sg.publishedAt,
      inside: voiceOf(sg.title, sg.companyName ?? companyName, extraAliases) !== "market",
    })),
    vocab,
  );

  // competitorHits reads ONE company key. The signals for an account are spread
  // across the keys its units are tracked under — Allergan Aesthetics is scanned
  // as itself — so asking only about the parent key found nothing while the
  // incumbent sat in the unit's own feed. Ask about every key that actually
  // holds signals, then merge.
  const keysWithSignals = [...new Set(signals.map((sg) => sg.signalKey))];
  const merged = new Map<string, CompetitorHit>();
  for (const k of keysWithSignals) {
    // DEFAULT_PEERS deliberately, not settings.peerSignals. That setting is
    // tuned for matching COMPANY NAMES during classification and carries
    // category words — "coaching", "leadership development". Matched against
    // the text of posts they appear constantly and mean nothing: the first run
    // of this band returned "coaching" as an incumbent, quoting a consultant's
    // own job title. The curated named-firm list is the one built for text.
    for (const hit of await competitorHits(orgId, k, companyName, undefined)) {
      const prev = merged.get(hit.peer);
      if (!prev) { merged.set(hit.peer, hit); continue; }
      merged.set(hit.peer, {
        ...prev,
        mentions: prev.mentions + hit.mentions,
        latestAt: (hit.latestAt?.getTime() ?? 0) > (prev.latestAt?.getTime() ?? 0) ? hit.latestAt : prev.latestAt,
        snippet: (hit.latestAt?.getTime() ?? 0) > (prev.latestAt?.getTime() ?? 0) ? hit.snippet : prev.snippet,
      });
    }
  }
  const competitors = [...merged.values()].sort((a, b) => b.mentions - a.mentions);

  // The company key lives inside payload_json, and matching a JS array against
  // it in SQL binds as a scalar rather than an array. Rather than hand-roll an
  // array literal, take the recent completed runs and pick in JS — there are a
  // handful of them, and the filter is the same either way.
  const runs = await db.select({ payload: job.payloadJson, at: job.updatedAt, kind: job.kind }).from(job).where(and(
    eq(job.orgId, orgId),
    inArray(job.kind, ["account_pulse", "intel_scan"]),
    eq(job.status, "done"),
  )).orderBy(desc(job.updatedAt)).limit(25);
  const run = runs.find((r) => {
    const k = (r.payload as { companyKey?: string })?.companyKey;
    return typeof k === "string" && unitKeys.has(k);
  });
  const triggers = ((run?.payload as { result?: { triggers?: Trigger[] } })?.result?.triggers) ?? [];

  // WHAT CHANGED, not what was published.
  //
  // This band was news-first, and an investor-relations feed is mostly
  // calendar: "AbbVie to Present at the Morgan Stanley Conference", "AbbVie to
  // Host Second-Quarter Earnings Call". Seven of those filled a panel headed
  // "change signals" while eleven posts about people moving in and out of the
  // account sat underneath, unseen.
  //
  // The discriminator is already in the data. The judge is required to quote
  // the line a score rests on, and it could not quote ONE of those notices —
  // there is nothing in them to quote. So an item earns this band by naming a
  // change (people moving, restructuring, leadership) or by having survived
  // the judge with a quotable line. Scheduling boilerplate does neither.
  // Voice matters as much as theme. Dropping the calendar notices let the
  // market back in — dermatologists with a well-quoted line about a product
  // launch, which is not a change AT the company either. A change signal comes
  // from inside: someone who works there, or the company itself.
  // The same article is stored once per company key it was collected under —
  // account_signal is unique on (org, key, source) — so an account whose units
  // are tracked separately shows every story twice. Dedupe on the URL, which is
  // what actually identifies a story, keeping the earliest publication date.
  const dedupeByUrl = <T extends { url: string | null; title: string | null }>(rows: T[]): T[] => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      const id = (r.url || r.title || "").trim().toLowerCase();
      if (!id || seen.has(id)) return Boolean(!id);
      seen.add(id);
      return true;
    });
  };


  const CHANGE_THEMES = new Set(["restructuring", "leadership", "channel"]);
  const changeSignalsRaw: SignalCard[] = [
    ...li.filter((sg) => {
      const voice = voiceOf(sg.title, sg.companyName ?? companyName, extraAliases);
      if (voice === "market") return false;
      return CHANGE_THEMES.has(sg.theme ?? "") || Boolean(sg.evidence);
    }),
    // News and filings still count when the judge could quote them: a real
    // announcement has something in it to quote, and a scheduling notice does not.
    ...news.filter((sg) => Boolean(sg.evidence)),
  ]
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  const changeSignalsDeduped = dedupeByUrl(changeSignalsRaw).slice(0, 8);

  // Every search this account has been read with. Shown so the reader can see
  // what was asked as well as what came back — including the phrases that
  // returned nothing, which is itself a finding.
  const seenQuery = new Set<string>();
  const queries: QueryRun[] = runs
    // Only searches. A Pulse news refresh has no keywords and no seen/stored,
    // and listing it as a query that returned nothing would read as a failed
    // search rather than a different kind of run entirely.
    .filter((r) => r.kind === "intel_scan")
    .filter((r) => {
      const k = (r.payload as { companyKey?: string })?.companyKey;
      return typeof k === "string" && unitKeys.has(k);
    })
    .map((r) => {
      const pl = r.payload as { keywords?: string; companyName?: string; result?: { seen?: string | number; stored?: string | number } };
      return {
        keywords: pl.keywords ?? pl.companyName ?? "",
        seen: Number(pl.result?.seen ?? 0),
        stored: Number(pl.result?.stored ?? 0),
        at: r.at,
      };
    })
    .filter((q) => q.keywords)
    // `runs` is newest first, so the FIRST time a phrase is seen here is its
    // most recent run — and that is the one to keep. One early job carried a
    // keywords value the worker of the day ignored, and reported the company
    // scan's 60/68 under the word "restructuring". Keeping the best yield would
    // have put that on the page and told a reader restructuring returned sixty
    // posts, which is the exact opposite of what the search found.
    .filter((q) => {
      const k = q.keywords.toLowerCase();
      if (seenQuery.has(k)) return false;
      seenQuery.add(k);
      return true;
    })
    .sort((a, b) => b.stored - a.stored || b.seen - a.seen);

  return {
    companyKey: key,
    companyName,
    map,
    units,
    footprint,
    whitespace,
    counts: {
      pockets: units.filter((u) => u.engaged).length,
      mapped,
      whitespace: whitespace.length,
      changeSignals: changeSignalsDeduped.length,
    },
    whitespacePct,
    linkedin: { tone, gauge, stored: li.length, themes, volume, volumeChangePct, top, insideTone, marketTone },
    changeSignals: changeSignalsDeduped,
    companyUpdates,
    geo,
    contacts,
    triggerScore,
    voicePosts,
    queries,
    competitors,
    triggers,
    decisionMakers,
    refreshedAt: run?.at ?? null,
  };
}
