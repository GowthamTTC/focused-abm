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
import { db, accountSignal, accountPerson, connection, job } from "@/db";
import { companyKey } from "@/modules/radar/score";
import { meanSentiment, type Band, type Trigger } from "@/modules/pulse/types";
import { loadAccountMap, mapKeys, type AccountMapRow } from "@/modules/accounts/org-map";
import { voiceOf } from "@/modules/intel/voice";
import { isUsPost } from "@/modules/accounts/us-filter";
import { competitorHits } from "@/modules/pulse/competitors";
import { getOrgSettings } from "@/modules/settings/org-settings";
import { DEFAULT_TRIGGERS, scoreTriggers, triggersIn, type TriggerScore, type TriggerSignal } from "@/modules/accounts/trigger-vocab";
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
/** A press item recorded against the unit: the company or its parent saying
 *  something in public, with whatever buying-signal language it carries. */
export interface PressNote {
  id: string;
  title: string | null;
  source: string | null;
  url: string | null;
  body: string | null;
  publishedAt: Date | null;
  matchedTriggers: TriggerSignal[];
}

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
  /** Vocabulary phrases this post contains — why it matters, beside it. */
  matchedTriggers: TriggerSignal[];
  /** What the posting entity is, in its own words, when the map describes it.
   *  A reason is easier to believe when the thing it is about has been
   *  described first, by them rather than by us. */
  about: string | null;
}

/** One search this account has been read with, and what it returned. */
export interface QueryRun {
  keywords: string;
  seen: number;
  stored: number;
  at: Date | null;
}

/** Seniority bands, read off the headline. Coarse on purpose: the point is to
 *  let a reader ask "who are the leaders here" without reading twenty titles,
 *  not to reproduce AbbVie's grade ladder. */
export type SeniorityLevel = "exec" | "vp" | "director" | "manager" | "trainer" | "other";

export interface SignalContact {
  name: string;
  role: string;
  /** Which band their title puts them in. "other" means the headline names no
   *  rank at all, which is common for faculty and individual contributors. */
  level: SeniorityLevel;
  /** Where this person came from. "post" means they wrote something we hold;
   *  "search" means LinkedIn's people search returned them and they have said
   *  nothing in the window. The second kind is most of any organisation. */
  source: "post" | "search";
  /** Their LinkedIn profile, when we have it. */
  profileUrl: string | null;
  /** What the research pass concluded about them, and who fetched it. Null
   *  until a pass has run — a person with no research is a person nobody has
   *  read yet, which the page says rather than hides. */
  research: {
    /** The offer this person opens, as a slug from the workspace catalogue,
     *  and why that one rather than the nearest alternative. */
    offer: string | null;
    offerWhy: string | null;
    /** What the fetched profile and posts say — facts, nothing else. */
    observed: string;
    /** What follows from role, company and moment, marked as reasoning. */
    inferred: string;
    postsRead: string;
    evidence: string | null;
    flag: string | null;
  } | null;
  researchedAt: Date | null;
  researchedBy: string | null;
  lastPostAt: Date | null;
  url: string | null;
  theme: string | null;
  /** They announced a new role in the post we hold. */
  newArrival: boolean;
  /** Their post names the Allergan Medical Institute or its speaker summit —
   *  the clearest evidence on this account that someone is inside the
   *  education and training programme a seller of it would want to reach. */
  amiEvent: boolean;
  excerpt: string;
  /** Whether this workspace already knows them. At an account nobody is
   *  connected to, every row reading "not connected" IS the finding — it is
   *  whitespace at the level of a person rather than a function. */
  connected: boolean;
  connectionId: string | null;
}

/** Movement in and out of the account, counted two different ways because the
 *  two sources see different things. Filings are official, historical and
 *  complete; LinkedIn is unofficial, recent and partial. Reporting them side by
 *  side with their windows stated is the only honest way to show both. */
/** One post behind a count. The count is the length of this list, so a reader
 *  who opens the number sees exactly what produced it — and can tell us a row
 *  does not belong, which is how "37 arrivals" was caught being seventeen
 *  reposts of a competitor's conference. */
export interface MovementPost {
  id: string;
  who: string;
  role: string;
  publishedAt: Date | null;
  url: string | null;
  excerpt: string;
}

export interface WorkforceMovement {
  /** Restructuring filings — official, with dates and headcounts in the title. */
  filings: SignalCard[];
  /** Posts announcing a new role or a move into the account. */
  arrivals: MovementPost[];
  /** Posts advertising open roles. */
  hiringPosts: MovementPost[];
  /** Posts using departure or layoff language. */
  exits: MovementPost[];
  postsRead: number;
  /** The unit these counts describe, and the span of posts they were taken
   *  over. LinkedIn's post search accepts past_day, past_week or past_month and
   *  nothing longer, so the window is whatever the scans could reach — never a
   *  date a reader picked. Printing it stops "last 30 days" from being asserted
   *  when it is not true. */
  scope: string;
  from: Date | null;
  to: Date | null;
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
  workforce: WorkforceMovement;
  /** What the account has posted from its OWN LinkedIn pages lately. Its
   *  newsroom publishes investor calendar; its LinkedIn page publishes what the
   *  business is actually doing, which is the thing a seller wants. */
  companyUpdates: VoicePost[];
  /** The account in one screen: what hurts, and what to open with. Assembled
   *  from what is already on the page — the filing, the signals that fired, the
   *  offers the research kept landing on — so every line traces to a section
   *  below it rather than being a paragraph somebody wrote once. */
  overview: {
    pains: { title: string; detail: string; source: string }[];
    pitch: { offer: string; people: { name: string; url: string | null }[]; why: string | null; whyFor: string | null }[];
    /** Named seats to open on, most senior first. */
    entry: { name: string; role: string; url: string | null; why: string | null }[];
  };
  /** Press about the business, newest first — the releases that carry the
   *  unit's own numbers and decisions, which its LinkedIn page does not. */
  announcements: PressNote[];
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

/** The mapped unit a post's author page belongs to, and what the map says it
 *  is. Matched on the page name containing the unit name — a company page is
 *  named after the thing it speaks for, and the longest match wins so
 *  "Allergan Medical Institute" is not claimed by "Allergan". */
function describeAuthor(authorLine: string | null, units: OrgUnit[]): string | null {
  const who = (authorLine ?? "").split(" \u2014 ")[0].toLowerCase();
  if (!who.trim()) return null;
  const hit = units
    .filter((u) => u.note && who.includes(u.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  return hit?.note ?? null;
}

/** A stored signal reduced to what a reader needs to judge whether it belongs
 *  in the count it was put in. */
function toMovementPost(sg: {
  id: string; title: string | null; body: string | null;
  publishedAt: Date | null; url: string | null;
}): MovementPost {
  const [namePart, ...rest] = (sg.title ?? "").split(" \u2014 ");
  return {
    id: sg.id,
    who: namePart.trim() || "Unknown",
    role: rest.join(" \u2014 ").trim(),
    publishedAt: sg.publishedAt,
    url: sg.url,
    excerpt: (sg.body ?? "").replace(/\s+/g, " ").trim().slice(0, 190),
  };
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
  /** Restrict the workforce counts to one unit — the whole account is the wrong
   *  denominator when the question is about one of its businesses. */
  focusUnit?: string,
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
  // High enough that the counts describe the account rather than the query.
  // At 400 the workforce band reported 64 arrivals over 396 posts while the
  // table held 432 — a number about our own paging, presented as a number
  // about them.
  )).orderBy(desc(accountSignal.publishedAt)).limit(1000);

  // News and filings are fetched separately. They are few, and they lose a
  // newest-first race against hundreds of LinkedIn posts: once this account
  // passed four hundred rows, the WARN notice naming a 202-person
  // reorganisation — the oldest row and the most important one — fell off the
  // end of the limit and stopped existing as far as the page was concerned.
  const pressRows = await db.select({
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
    inArray(accountSignal.kind, ["news", "filing"]),
  )).orderBy(desc(accountSignal.publishedAt)).limit(120);

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
  const news = pressRows;

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
  const AMI_RE = /\b(allergan medical institute|\bAMI\b|speaker training summit)\b/i;
  const ARRIVAL_CONTACT_RE = /\b(joined|joining|starting a new|started a new|new chapter|new position|new role|took on a new)\b/i;
  // A tenure post uses the same words as an arrival post — "joined AbbVie 11
  // years ago today" is not a new joiner, and tagging it as one is the kind of
  // mistake a seller only has to make once in front of a client.
  const ANNIVERSARY_RE = /\b(\d+(st|nd|rd|th)?[- ]?year|anniversary|years ago|years at|years with|decade)\b/i;
  // Ariel sells leadership and communication development. The list is the
  // people who buy that or own the teams it is bought for — not everyone who
  // happens to post. Two ways in: the role IS people development, or the role
  // is senior enough to commission it for a team.
  const ICP_FUNCTION_RE = new RegExp([
    "learning and development", "learning & development", "\\bl&d\\b", "talent",
    "leadership development", "organi[sz]ational development", "organi[sz]ation development",
    "training", "trainer", "preceptor", "facilitator", "enablement", "capability",
    "academy", "institute", "faculty",
    "organi[sz]ational effectiveness", "change management", "employee experience",
    "medical education", "field education", "human resources", "\\bhr\\b", "people",
    "communications", "communication", "culture", "engagement", "coaching",
  ].join("|"), "i");
  const ICP_SENIORITY_RE = /\b(chief|ceo|clo|chro|coo|cfo|president|svp|evp|vp|vice president|head of|senior director|associate director|director|general manager|regional director)\b/i;
  // Functions that are senior and are still not this buyer. A Director of IT
  // and Regulated Systems runs systems, not people, and nothing about a
  // leadership-communication offer reaches him. This only ever applies to a
  // row that got in on its title alone — someone whose headline says training
  // or communications keeps their place whatever else it says.
  const ICP_OFF_FUNCTION_RE = /\b(information technology|business technology|it|regulated systems|systems|software|engineering|engineer|infrastructure|cyber|data platform|quality assurance|qa|validation)\b/i;
  // Read in this order: "Executive Director" is a director, and "Associate
  // Vice President" is a VP. Testing the words in rank order instead would
  // promote both of them.
  const levelOf = (role: string): SeniorityLevel => {
    const r = role.replace(/president[\u2019']?s club/gi, " ");
    if (/\b(svp|evp|senior vice president|executive vice president)\b/i.test(r)) return "exec";
    if (/\b(chief|ceo|coo|cfo|clo|chro|cmo|cpo|cto|ciso)\b/i.test(r)) return "exec";
    // "Vice President" contains the word "president". Without this the
    // Associate Vice President who heads AMI's curricula was filed as an
    // officer of the company.
    if (/(?<!vice\s)\bpresident\b/i.test(r)) return "exec";
    if (/\b(vice president|avp|vp|head of)\b/i.test(r)) return "vp";
    if (/\bdirector\b/i.test(r)) return "director";
    // Trainer before manager: "Sr. Training Manager" runs a function, while a
    // "Faculty Trainer" teaches in rooms. Both matter to a seller of speaker
    // training, and they are not the same conversation.
    if (/\b(faculty trainer|trainer|preceptor|instructor|facilitator)\b/i.test(r)) return "trainer";
    if (/\b(manager|lead|supervisor|principal)\b/i.test(r)) return "manager";
    return "other";
  };
  const matchesIcp = (role: string) => {
    // "2X President's Club Winner" is a sales award, not an officer of the
    // company. It is the one phrase that turns this list into a list of
    // everybody, so it goes before the seniority test reads the headline.
    const r = role.replace(/president[\u2019']?s club/gi, " ");
    if (ICP_FUNCTION_RE.test(r)) return true;
    return ICP_SENIORITY_RE.test(r) && !ICP_OFF_FUNCTION_RE.test(r);
  };
  const orgSettings = await getOrgSettings(orgId);
  const vocab = orgSettings.triggerSignals ?? DEFAULT_TRIGGERS;
  /** Names the workspace has taken out of account lists, normalised. */
  const nameKey = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const hidden = new Set((orgSettings.icpHidden ?? []).map(nameKey));

  const focusKey = focusUnit ? companyKey(focusUnit) : null;
  // Scoped to the unit in focus when there is one. An Allergan Aesthetics page
  // that lists AbbVie's recruiters and Parkinson's directors is an AbbVie page.
  // The unit's own rows, plus anyone whose headline names the unit however
  // their post was filed. The Head of AMI Faculty works for Allergan
  // Aesthetics and says so in his headline; his posts were captured under the
  // institute's key, and a key-only filter loses exactly the people this
  // section exists to find.
  // Trailing "s" optional: headlines write "Allergan Aesthetic" as often as
  // "Allergan Aesthetics", and a plural the author dropped is not a different
  // employer.
  const focusRe = focusUnit
    ? new RegExp(`${focusUnit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/s$/i, "")}s?`, "i")
    : null;
  const unitLi = focusKey
    ? allLi.filter((sg) => sg.signalKey === focusKey || (focusRe?.test(sg.title ?? "") ?? false))
    : [];
  const contactPool = unitLi.length ? unitLi : allLi;
  const byPerson = new Map<string, Omit<SignalContact, "connected" | "connectionId">>();
  for (const sg of contactPool) {
    if (voiceOf(sg.title, sg.companyName ?? companyName, extraAliases) !== "employee") continue;
    // US only, and only the unit in question — the same two filters the
    // workforce counts use, because a list of people to approach has to obey
    // the same scope as the numbers above it.
    if (!isUsPost(sg.title, sg.body)) continue;
    const [namePart, ...rest] = (sg.title ?? "").split(" \u2014 ");
    const name = namePart.trim();
    if (!name) continue;
    const prev = byPerson.get(name.toLowerCase());
    if (prev && (prev.lastPostAt?.getTime() ?? 0) >= (sg.publishedAt?.getTime() ?? 0)) continue;
    const postRole = rest.join(" \u2014 ").trim();
    byPerson.set(name.toLowerCase(), {
      name,
      role: postRole,
      level: levelOf(postRole),
      source: "post",
      research: null,
      researchedAt: null,
      researchedBy: null,
      profileUrl: sg.authorProfileUrl,
      lastPostAt: sg.publishedAt,
      url: sg.url,
      theme: sg.theme,
      newArrival: ARRIVAL_CONTACT_RE.test(sg.body ?? "") && !ANNIVERSARY_RE.test(sg.body ?? ""),
      amiEvent: AMI_RE.test(`${sg.title ?? ""} ${sg.body ?? ""}`),
      excerpt: (sg.body ?? "").replace(/\s+/g, " ").trim().slice(0, 150),
    });
  }
  // The people LinkedIn's own search found at the unit, whether or not they
  // have posted. A post feed is a list of the people who write in public; this
  // is a list of the people who work there, and the second one is the account.
  const directory = await db.select({
    name: accountPerson.name,
    headline: accountPerson.headline,
    profileUrl: accountPerson.profileUrl,
    companyKey: accountPerson.companyKey,
    levelOverride: accountPerson.levelOverride,
    capturedBy: accountPerson.capturedBy,
    researchJson: accountPerson.researchJson,
    researchedAt: accountPerson.researchedAt,
    researchedBy: accountPerson.researchedBy,
  }).from(accountPerson).where(and(
    eq(accountPerson.orgId, orgId),
    inArray(accountPerson.companyKey, [...unitKeys]),
  ));
  /** Bands set by hand, by normalised name, applied after the merge so a
   *  correction holds whether the person was found by a post or by a search. */
  const levelFix = new Map<string, SeniorityLevel>();
  /** Research by normalised name, so it reaches a person however they were
   *  found — the pass reads account_person, the list may know them from a post. */
  const researchByName = new Map<string, SignalContact["research"] & object>();
  const researchMeta = new Map<string, { at: Date | null; by: string | null }>();
  for (const d of directory) {
    const fix = (d.levelOverride ?? "").trim() as SeniorityLevel;
    if (fix) levelFix.set(d.name.toLowerCase(), fix);
    const r = d.researchJson as Record<string, string | null> | null;
    // Two shapes live in this column: v2 splits observed from inferred, v1 wrote
    // a summary and an angle. A row written by v1 is still a row someone can
    // read, so it is mapped onto the same two halves rather than hidden.
    if (r && (typeof r.observed === "string" || typeof r.about_summary === "string")) {
      researchByName.set(d.name.toLowerCase(), {
        offer: r.offer ?? null,
        offerWhy: r.offer_why ?? r.angle ?? null,
        observed: r.observed ?? r.about_summary ?? "",
        inferred: r.inferred ?? r.priorities ?? "",
        postsRead: r.posts_read ?? r.posts_summary ?? "",
        evidence: r.evidence ?? null,
        flag: r.flag ?? null,
      });
      researchMeta.set(d.name.toLowerCase(), { at: d.researchedAt, by: d.researchedBy });
    }
    const headline = (d.headline ?? "").trim();
    if (focusKey && d.companyKey !== focusKey && !(focusRe?.test(headline) ?? false)) continue;
    const key = d.name.toLowerCase();
    const prev = byPerson.get(key);
    // Rows copied out of the post feed exist so the research pass can reach
    // people it otherwise could not. They must not ADD anyone: the post path
    // applies the employee-voice and US tests, and a row that skipped them
    // would walk a foreign-market reposter straight onto the list.
    if (!prev && d.capturedBy === "post author") continue;
    if (prev) {
      // Already known from a post. Keep the post — it carries a date and words
      // — and take only the profile link the search added.
      if (!prev.profileUrl && d.profileUrl) prev.profileUrl = d.profileUrl;
      continue;
    }
    byPerson.set(key, {
      name: d.name,
      role: headline,
      level: levelOf(headline),
      source: "search",
      profileUrl: d.profileUrl,
      research: null,
      researchedAt: null,
      researchedBy: null,
      lastPostAt: null,
      url: null,
      theme: null,
      newArrival: false,
      amiEvent: AMI_RE.test(headline),
      excerpt: "",
    });
  }

  // Do we already know any of them? Matched on normalised full name against
  // this workspace's own connections. A name match is not proof of identity,
  // so the page says "connected" rather than asserting it is the same person.
  const known = await db.select({
    id: connection.id,
    firstName: connection.firstName,
    lastName: connection.lastName,
  }).from(connection).where(eq(connection.orgId, orgId));
  const knownByName = new Map<string, string>();
  for (const k of known) {
    const n = `${k.firstName} ${k.lastName}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (n && !knownByName.has(n)) knownByName.set(n, k.id);
  }

  const contacts = [...byPerson.values()]
    .filter((c) => matchesIcp(c.role))
    // Taken out by hand. A headline cannot say "this one is not the buyer".
    .filter((c) => !hidden.has(nameKey(c.name)))
    .map((c) => {
      const k = c.name.toLowerCase();
      const meta = researchMeta.get(k);
      return {
        ...c,
        level: levelFix.get(k) ?? c.level,
        research: researchByName.get(k) ?? null,
        researchedAt: meta?.at ?? null,
        researchedBy: meta?.by ?? null,
      };
    })
    .map((c) => {
      const n = c.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const id = knownByName.get(n) ?? null;
      return { ...c, connected: Boolean(id), connectionId: id };
    })
    .sort((a, b) => {
      // Anyone who said something recently leads, because there is something to
      // open on. The rest follow in name order, which is the only honest order
      // for people we know a headline about and nothing else.
      if (a.source !== b.source) return a.source === "post" ? -1 : 1;
      if (a.source === "post") return (b.lastPostAt?.getTime() ?? 0) - (a.lastPostAt?.getTime() ?? 0);
      return a.name.localeCompare(b.name);
    });

  // Leadership and company voices only. The market half of the feed is
  // practitioners talking about products, and it is not what an account plan
  // is arguing from.
  // Buying signals, scored. The vocabulary is the workspace's own when it has
  // one; undefined falls back to the built-in list, and [] switches it off.
  // Press, newest first. WARN filings are excluded: they are already the left
  // column of workforce movement, and a filing shown twice reads as two events.
  // Scoped to the unit in focus, so the parent's investor calendar — "AbbVie to
  // present at the Morgan Stanley healthcare conference" — stays out of a band
  // that is meant to carry what the business itself did.
  const unitPress = pressRows.filter((r) => r.signalKey === focusKey);
  const announcements: PressNote[] = (focusKey && unitPress.length ? unitPress : pressRows)
    .filter((r) => r.kind === "news")
    // Only what there is something to do about. A release with no buying-signal
    // language is background a seller already has; printing it beside the line
    // "context, not a trigger" is a row that costs attention and returns none.
    .filter((r) => triggersIn(`${r.title ?? ""} ${r.body ?? ""}`, vocab).length > 0)
    .filter((r, i, arr) => arr.findIndex((q) => (q.url ?? q.title) === (r.url ?? r.title)) === i)
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      title: r.title,
      source: r.source,
      url: r.url,
      body: r.body,
      publishedAt: r.publishedAt,
      matchedTriggers: triggersIn(`${r.title ?? ""} ${r.body ?? ""}`, vocab),
    }));

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
        matchedTriggers: triggersIn(`${sg.title ?? ""} ${sg.body ?? ""}`, vocab),
        about: describeAuthor(sg.title, map?.units ?? []),
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
    // Product marketing is not an opening. A Natrelle post listing implant
    // profiles is the company doing its job, and a row that says "no buying
    // signal" beside it is a row that tells a seller nothing twice.
    .filter((p) => p.matchedTriggers.length > 0)
    .slice(0, 6);

  const triggerScore = scoreTriggers(
    [
      ...allLi.map((sg) => ({
        title: sg.title, body: sg.body, evidence: sg.evidence,
        url: sg.url, publishedAt: sg.publishedAt,
        inside: voiceOf(sg.title, sg.companyName ?? companyName, extraAliases) !== "market",
      })),
      // News and filings count. The `inside` rule exists to keep LinkedIn's
      // market chatter and a competitor's event marketing from scoring — not to
      // exclude a regulatory filing or trade reporting about the account, which
      // passed the collector's company test and came from a domain this
      // workspace chose. A WARN notice naming a reorganisation is the strongest
      // buying signal available and was scoring nothing.
      ...news.map((sg) => ({
        title: sg.title, body: sg.body, evidence: sg.evidence,
        url: sg.url, publishedAt: sg.publishedAt, inside: true,
      })),
    ],
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
  // Counted over the post bodies this workspace holds. These are coarse
  // patterns, not a model: they are reported as counts of POSTS containing the
  // language, never as headcount, because one person announcing a new job is
  // one post and a company announcing a restructure is also one post.
  const ARRIVAL_RE = /\b(joined|joining|starting a new|started a new|new chapter|new position|new role|thrilled to (share|announce)|excited to (share|announce) that i)\b/i;
  const HIRING_RE = /\b(we are hiring|we're hiring|now hiring|#hiring|open role|open position|join our team|apply (here|now)|is looking for)\b/i;
  const EXIT_RE = /\b(last day|farewell|open to work|impacted by|role was eliminated|made redundant|laid off|layoffs?)\b/i;

  const seenBody = new Set<string>();
  const scopedLi = (focusKey ? allLi.filter((sg) => sg.signalKey === focusKey) : allLi)
    // ONLY PEOPLE WHO WORK THERE. Without this the counts read the whole feed:
    // "37 arrivals" was seventeen employees of a COMPETITOR reposting one
    // syndicated write-up of their own conference, plus three actual arrivals.
    // Movement at an account can only be reported by people at the account.
    .filter((sg) => voiceOf(sg.title, sg.companyName ?? companyName, extraAliases) === "employee")
    // US only, as far as a post can show it. There is no location on a LinkedIn
    // post, so this removes what is demonstrably elsewhere — an author line
    // naming another market, or a post written in another language — and keeps
    // the rest. That is "not shown to be elsewhere", not "proven American".
    .filter((sg) => isUsPost(sg.title, sg.body))
    // One syndicated post reposted by twenty colleagues is one event. Counting
    // the copies turns a single announcement into a hiring wave.
    .filter((sg) => {
      const id = (sg.body ?? "").replace(/\s+/g, " ").trim().slice(0, 160).toLowerCase();
      if (!id) return true;
      if (seenBody.has(id)) return false;
      seenBody.add(id);
      return true;
    });
  const dates = scopedLi.map((sg) => sg.publishedAt).filter((d): d is Date => Boolean(d));
  const workforce: WorkforceMovement = {
    filings: news
      .filter((sg) => sg.theme === "restructuring")
      .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)),
    arrivals: scopedLi.filter((sg) => ARRIVAL_RE.test(sg.body ?? "")).map(toMovementPost),
    hiringPosts: scopedLi.filter((sg) => HIRING_RE.test(sg.body ?? "")).map(toMovementPost),
    exits: scopedLi.filter((sg) => EXIT_RE.test(sg.body ?? "")).map(toMovementPost),
    postsRead: scopedLi.length,
    scope: focusUnit || companyName,
    from: dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
    to: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
  };

  // Restructuring outranks recency. Sorted newest-first alone, a WARN filing
  // naming a reorganisation sat below whatever a quality engineer posted this
  // morning — the most consequential fact about the account, buried by a day.
  const changeSignalsDeduped = dedupeByUrl(changeSignalsRaw)
    .sort((a, b) => {
      const rank = (t: string | null) => (t === "restructuring" ? 0 : t === "leadership" ? 1 : 2);
      const r = rank(a.theme) - rank(b.theme);
      return r !== 0 ? r : (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
    })
    .slice(0, 8);

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

  // ── The overview ────────────────────────────────────────────────────────
  // Assembled, not written. Every line points at something else on the page:
  // a filing you can open, a signal that fired with its points, an offer the
  // research landed on for named people. Nothing here is a claim the sections
  // below cannot support.
  const pains: L3View["overview"]["pains"] = [];
  // Filings are no longer listed here. A WARN notice from last year is the
  // background to this account, not what a seller opens on today, and two of
  // them took half the slots in a four-line summary. The rows are still stored
  // and still score the restructuring triggers below.
  for (const hit of triggerScore.fired.slice(0, 4)) {
    pains.push({
      title: hit.trigger.label,
      detail: hit.trigger.why ?? "",
      source: `${hit.hits} post${hit.hits === 1 ? "" : "s"} · ${Math.round(hit.points)} pts`,
    });
  }
  for (const a of announcements.slice(0, 2)) {
    const t = a.matchedTriggers[0];
    if (!t) continue;
    pains.push({
      title: a.title ?? t.label,
      detail: t.why ?? "",
      source: a.publishedAt ? a.publishedAt.toISOString().slice(0, 10) : "press",
    });
  }

  // Which offer the research kept landing on, and for whom. An offer named
  // once is an opinion; an offer named for six people is a route in.
  const byOffer = new Map<string, {
    people: { name: string; url: string | null }[];
    why: string | null;
    whyFor: string | null;
  }>();
  for (const c of contacts) {
    const slug = c.research?.offer?.trim();
    if (!slug) continue;
    // The reason shown is one person's, because that is how it was written —
    // the card names whose, so nobody reads a sentence about one manager as a
    // statement about eleven.
    const row = byOffer.get(slug)
      ?? { people: [], why: c.research?.offerWhy ?? null, whyFor: c.name };
    row.people.push({ name: c.name, url: c.profileUrl });
    byOffer.set(slug, row);
  }
  const pitch = [...byOffer.entries()]
    .map(([offer, r]) => ({ offer, people: r.people, why: r.why, whyFor: r.whyFor }))
    .sort((a, b) => b.people.length - a.people.length)
    .slice(0, 3);

  const ENTRY_ORDER: SeniorityLevel[] = ["exec", "vp", "director", "manager", "trainer", "other"];
  const entry = [...contacts]
    .filter((c) => c.research && !c.research.flag)
    .sort((a, b) => ENTRY_ORDER.indexOf(a.level) - ENTRY_ORDER.indexOf(b.level))
    .slice(0, 3)
    .map((c) => ({ name: c.name, role: c.role, url: c.profileUrl, why: c.research?.offerWhy ?? null }));

  const overview = { pains: pains.slice(0, 4), pitch, entry };

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
    workforce,
    companyUpdates,
    announcements,
    overview,
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
