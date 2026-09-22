/**
 * Merge-ready schema: every business table carries org_id even though the
 * standalone runs single-tenant. Retrofitting org scoping is the most painful
 * merge task — a column we ignore today costs nothing.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";

const id = () => text("id").primaryKey().$defaultFn(createId);
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ── Identity ──────────────────────────────────────────────────────────
/** Org-level knobs — the API-cost guardrails.
 *  enrichLimit: max people ONE deep-enrichment run may process ("all" = daily cap only).
 *  classifyLlmPeopleCap: max people ONE matching run may send to the model
 *  (rule-matched people are free and uncapped); remainder stays unclassified
 *  and the next matching run continues from there. */
export interface OrgSettings {
  enrichLimit: number | "all";
  classifyLlmPeopleCap: number | "all";
  /** "managed" — TTC-run seat, admin catalog sync may overwrite the services.
   *  "own"     — client defines their own offers; sync never touches them. */
  catalogMode?: "managed" | "own";
  /** The firm whose seat this workspace is. Drives the "works at our own
   *  company" exclusion and the {{own_company}} prompt variable. Blank = the
   *  rule is off; nothing is excluded for employer. */
  sellerName?: string;
  /** Who the outreach is FROM, in one sentence — the message drafter is told
   *  this and sells the workspace's own services in its terms. */
  sellerContext?: string;
  /** Points a person earns when their EMPLOYER matches the ICP they were
   *  matched to (rank.ts). Unset falls back to DEFAULT_ICP_FIT_BONUS, which is
   *  0 — the component is built but switched off until its weight has been
   *  measured. Set it per workspace to turn the employer test on. */
  icpFitBonus?: number;
  /** Company-name fragments that mark a PEER (a competitor, not a buyer), and
   *  title fragments that mark someone OFF-TARGET. Both run before persona
   *  matching, so they are the workspace's own or its ICP cannot win.
   *  undefined = use the built-in defaults; [] = rule off. */
  peerSignals?: string[];
  offIcpSignals?: string[];
  /** Max people ONE day of post scanning may touch in this workspace. Lower it
   *  for a fresh or fragile LinkedIn seat without redeploying. */
  postScanDailyCap?: number;
  /** Words in a job title that mark someone as a BUYER for this workspace.
   *  Ranking awards its function-fit points on these, so a marketing firm and a
   *  leadership-development firm must not share them. */
  functionTerms?: string[];
  /** Exact slug -> ranking bonus. A workspace knows its own slugs, so this is an
   *  exact map rather than the substring guessing the defaults still do. */
  serviceWeights?: Record<string, number>;
  /** Slug the classifier falls back to when nothing else fits. Marked
   *  (CATCH-ALL) in the services digest. Unset = no fallback; a pitchable
   *  person with no good match gets a null service, which is honest. */
  catchAllSlug?: string;
  /** Compact style profile distilled from the user's own LinkedIn posts;
   *  injected into every drafted message so outreach sounds like THEM. */
  voiceProfile?: string;
  voiceSampledAt?: string;
  /** Domains Pulse's news collector may fetch. There is no general crawler and
   *  no default list: the trade press for aesthetics is not the trade press for
   *  IT services, so an empty list means the news band stays empty rather than
   *  a guess being made on the workspace's behalf. */
  pulseDomains?: string[];
  /** Last-used research sentence — the picker reopens where you left it
   *  instead of snapping back to 30 after every run. */
  pickN?: number;
  pickCountry?: string;
  pickPosted?: string;
}
export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  enrichLimit: 10, classifyLlmPeopleCap: 1000, catalogMode: "managed",
};

export const org = pgTable("org", {
  id: id(),
  name: text("name").notNull(),
  settingsJson: jsonb("settings_json").$type<OrgSettings>().notNull().default(DEFAULT_ORG_SETTINGS),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Billing / client company in the admin console.
 *  Many users can belong to one account; each user still has their own org workspace. */
export const clientAccount = pgTable("client_account", {
  id: id(),
  name: text("name").notNull(),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const appUser = pgTable("app_user", {
  id: id(),
  orgId: text("org_id").notNull().references(() => org.id),
  clientAccountId: text("client_account_id").references(() => clientAccount.id),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  /** true for admin-issued temporary passwords — forces a change on first login */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  /** Guided-setup progress: highest wizard step finished (0 = none yet).
   *  A null completedAt is what pins the user inside /onboarding, so every
   *  account that predates the wizard is backfilled complete by the migration. */
  onboardingStep: integer("onboarding_step").notNull().default(0),
  onboardingCompletedAt: ts("onboarding_completed_at"),
  /** Decayed topic weights + last Nova asks — per login, not shared workspace. */
  novaLearnJson: jsonb("nova_learn_json").$type<{
    topics: Record<string, number>;
    last: string[];
    updatedAt?: string;
  }>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const novaChat = pgTable("nova_chat", {
  id: id(),
  userId: text("user_id").notNull().references(() => appUser.id),
  orgId: text("org_id").notNull().references(() => org.id),
  title: text("title").notNull().default("New chat"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("nova_chat_user_idx").on(t.userId, t.updatedAt)]);

export const novaChatMessage = pgTable("nova_chat_message", {
  id: id(),
  chatId: text("chat_id").notNull().references(() => novaChat.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  suggestionsJson: jsonb("suggestions_json").$type<string[]>(),
  pendingJson: jsonb("pending_json").$type<{ kind: string; title: string; yes: string; tone?: string }[]>(),
  cardsJson: jsonb("cards_json").$type<{ kind: string; title: string; subtitle?: string; pills: string[] }[]>(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("nova_chat_msg_idx").on(t.chatId, t.createdAt)]);

// ── Channel (Unipile) ────────────────────────────────────────────────
export const channelAccount = pgTable("channel_account", {
  id: id(),
  orgId: text("org_id").notNull().references(() => org.id),
  provider: text("provider").notNull().default("linkedin"),
  unipileAccountId: text("unipile_account_id").notNull().unique(),
  displayName: text("display_name"),
  status: text("status").notNull().default("operational"), // operational | needs_reauth | disconnected
  lastSyncedAt: ts("last_synced_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ── Services (the six TTC solutions, editable) ───────────────────────
export interface IcpPersona {
  slug: string;
  name: string;
  title_include: string[];
  title_exclude: string[];
  seniority: string[];       // cxo | vp | head | director | manager | founder | ic
  function_tags: string[];
}
export interface IcpJson {
  summary: string;
  fit_signals: string[];
  pain_points: string[];
  personas: IcpPersona[];
  disqualifiers: string[];
}
export const service = pgTable("service", {
  id: id(),
  orgId: text("org_id").notNull().references(() => org.id),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"), // active | archived
  icpJson: jsonb("icp_json").$type<IcpJson>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("service_org_slug_uq").on(t.orgId, t.slug)]);

// ── Connections pipeline ─────────────────────────────────────────────
export const connectionBatch = pgTable("connection_batch", {
  id: id(),
  orgId: text("org_id").notNull().references(() => org.id),
  source: text("source").notNull(), // csv | sync
  label: text("label").notNull(),
  statsJson: jsonb("stats_json").$type<Record<string, number>>().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export interface ScoreBreakdown {
  seniority: number;
  function_fit: number;
  confidence: number;
  founder_bonus: number;
  company_present: number;
  service_bonus: number;
  /** Their EMPLOYER matched the ICP they were matched to. Optional because
   *  rows scored before v2.21.0 have no such field; read it as 0. */
  icp_fit?: number;
  total: number;
}
export const connection = pgTable("connection", {
  id: id(),
  orgId: text("org_id").notNull().references(() => org.id),
  batchId: text("batch_id").notNull().references(() => connectionBatch.id, { onDelete: "cascade" }),

  // Raw (from CSV or relations sync)
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull().default(""),
  companyRaw: text("company_raw"),
  positionRaw: text("position_raw"),
  headlineRaw: text("headline_raw"),
  linkedinUrl: text("linkedin_url"),
  publicIdentifier: text("public_identifier"),
  memberId: text("member_id"),               // Unipile provider-internal id (posts endpoint needs it)
  location: text("location"),                // e.g. "Chennai, Tamil Nadu, India" — country = last segment
  country: text("country"),                  // normalised from location; null until known
  /** Home metro slug (sf-bay-area). Profile location, never live GPS. */
  metro: text("metro"),
  metroEvidence: text("metro_evidence"),     // profile | headline
  mentionMetro: text("mention_metro"),       // weaker: they named this metro in a recent post
  mentionAt: ts("mention_at"),
  mentionSnippet: text("mention_snippet"),
  mentionKind: text("mention_kind"),         // travel | event | place
  eventQuery: text("event_query"),           // event name used in the radar search
  floorStatus: text("floor_status"),         // met | skipped
  floorAt: ts("floor_at"),
  connectedOn: text("connected_on"),
  /** 1 = 1st-degree (CSV/sync). 2 / 3 = event search. Null treated as 1st. */
  networkDistance: text("network_distance"),

  // Stage A — service fit + rank
  bucket: text("bucket"), // pitchable | off_icp | peer_competitor | excluded
  serviceSlug: text("service_slug"),
  matchConfidence: integer("match_confidence"),
  matchWhy: text("match_why"),
  matchMethod: text("match_method"), // rule | llm
  score: integer("score"),
  scoreBreakdownJson: jsonb("score_breakdown_json").$type<ScoreBreakdown>(),
  tier: integer("tier"),
  rank: integer("rank"),

  // ── Account map — which unit of the parent account this person sits in ──
  /** Unit name, copied EXACTLY from that account's map. Null = unmapped,
   *  which is a real answer: it is the pile the coverage view makes you look at. */
  division: text("division"),
  divisionMethod: text("division_method"),  // rule | llm | manual
  divisionWhy: text("division_why"),

  // Stage B — deep enrichment (the amber columns)
  selectedForEnrich: boolean("selected_for_enrich").notNull().default(false),
  enrichStatus: text("enrich_status").notNull().default("pending"), // pending | queued | running | done | failed | skipped
  aboutSummary: text("about_summary"),
  activityUrl: text("activity_url"),
  postsSummary: text("posts_summary"),
  painPoints: text("pain_points"),
  painInferred: boolean("pain_inferred"),
  serviceConfirmed: text("service_confirmed"),
  correctionReason: text("correction_reason"),
  flag: text("flag"),
  outreachMessage: text("outreach_message"),
  enrichError: text("enrich_error"),
  enrichedAt: ts("enriched_at"),
  // v1.3 sales-dashboard primitives
  outreachStatus: text("outreach_status"), // null/ready → sent (→ replied later)
  sentAt: ts("sent_at"),
  flagVerdict: text("flag_verdict"),       // null → dropped | verify | variant
  lastPostAt: ts("last_post_at"),          // most recent post seen at enrichment/scan time
  lastScanAt: ts("last_scan_at"),          // when the lightweight activity scan last checked this person

  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("connection_batch_idx").on(t.batchId),
  index("connection_bucket_idx").on(t.batchId, t.bucket),
  index("connection_metro_idx").on(t.orgId, t.metro),
]);

// ── Posts (the reason to reach out today) ────────────────────────────
/** One LinkedIn post by one connection.
 *
 *  Until now the only trace of someone's activity was last_post_at (a date) and
 *  posts_summary (LLM prose about ALL their posts). Neither can answer "what did
 *  they say, and where is it" — so nothing could open a message with their own
 *  words. This stores the post itself.
 *
 *  The judgement columns are filled by a separate pass and stay null until it
 *  runs. Uninteresting posts are categorised and scored 0, never deleted: the
 *  filter has to be auditable and re-tunable without re-fetching from LinkedIn.
 */
export const post = pgTable("post", {
  id: id(),
  orgId: text("org_id").notNull().references(() => org.id),
  connectionId: text("connection_id").notNull()
    .references(() => connection.id, { onDelete: "cascade" }),
  /** Provider's own post id — the dedupe key, so re-scanning is idempotent. */
  providerId: text("provider_id").notNull(),
  text: text("text").notNull(),
  /** Unipile's share_url: the deep link to this specific post. */
  url: text("url"),
  postedAt: ts("posted_at"),

  // ── Filled by the relevance pass ──
  /** 0–100 against THIS workspace's offers. Only substantive posts score above 0. */
  relevance: integer("relevance"),
  category: text("category"),   // substantive | congrats | promo | reshare | personal
  /** One line a human could actually open with, quoting their words. */
  hook: text("hook"),
  /** −100..100, how this post SOUNDS about the author's employer. Independent
   *  of relevance: a furious post about a restructure is highly negative and
   *  may be entirely irrelevant to what this workspace sells. Null until a
   *  prompt version that fills it has judged the row, so every post stored
   *  before post-relevance v2 reads null rather than a misleading zero. */
  sentiment: integer("sentiment"),
  judgedAt: ts("judged_at"),

  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("post_connection_provider_uq").on(t.connectionId, t.providerId),
  index("post_org_posted_idx").on(t.orgId, t.postedAt),
  index("post_org_relevance_idx").on(t.orgId, t.relevance, t.postedAt),
]);

// ── DB-backed jobs (no Redis in the standalone) ──────────────────────
export const job = pgTable("job", {
  id: id(),
  orgId: text("org_id").notNull().references(() => org.id),
  kind: text("kind").notNull(), // classify | deep_enrich | sync | activity_scan | event_scan
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("queued"), // queued | running | done | failed
  progress: integer("progress").notNull().default(0),
  total: integer("total").notNull().default(0),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const activityLog = pgTable("activity_log", {
  id: id(),
  orgId: text("org_id").notNull().references(() => org.id),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detailJson: jsonb("detail_json").$type<Record<string, unknown>>().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Daily network stats — one row per org per day, upserted on page view and
 *  after syncs. The growth charts begin the day this ships; we never invent
 *  history that was not observed. */

/** One unit inside a mapped account — a BU, a function, an acquired brand.
 *  `aka` carries the spellings people actually put in a headline, which is how
 *  the free rule pass finds them without asking the model anything. */
export interface OrgUnit {
  name: string;
  aka?: string[];
  note?: string;
  /** The team ASSERTS it is engaged here. Deliberately separate from coverage,
   *  which is EVIDENCED by people in the network: Ariel has landed in nine
   *  AbbVie pockets through delivery history, and not one of those people is a
   *  LinkedIn connection of the seat. Deriving footprint from connections alone
   *  would report that account as untouched, which is both false and the worst
   *  thing to put in front of the client who owns the relationship. */
  engaged?: boolean;
}

/** The org chart we are mapping an account against.
 *
 *  This is the one thing the connection list cannot produce. A network shows
 *  the units you have LANDED in; it is silent about the ones you have not, and
 *  silence is exactly what an account plan has to name. So the unit list is an
 *  input — researched, pasted, or drafted — and coverage is the diff between it
 *  and the people we actually hold.
 *
 *  `aliases` are other company_raw spellings that roll up to this parent, so an
 *  acquired brand (Allergan Aesthetics under AbbVie) counts as coverage of its
 *  own unit instead of sitting off to the side as a separate account. */
export const accountMap = pgTable("account_map", {
  id: id(),
  orgId: text("org_id").notNull().references(() => org.id),
  companyKey: text("company_key").notNull(),
  name: text("name").notNull(),
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  units: jsonb("units").$type<OrgUnit[]>().notNull().default([]),
  source: text("source").notNull().default("manual"),  // manual | drafted
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("account_map_org_key_uq").on(t.orgId, t.companyKey),
]);

/** User-shortlisted companies for account-led enrich (Stage B gate). */
export const accountShortlist = pgTable("account_shortlist", {
  id: id(),
  orgId: text("org_id").notNull().references(() => org.id),
  companyKey: text("company_key").notNull(),
  companyName: text("company_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("account_shortlist_org_idx").on(t.orgId),
  index("account_shortlist_org_key_idx").on(t.orgId, t.companyKey),
]);

/** One observed signal ABOUT a company — never about a person (docs/ACCOUNT-PULSE.md §0).
 *
 *  Four kinds share one table because they are judged by one pass and read by
 *  one panel: "news" and "filing" are fetched from the allowlisted web, while
 *  "post" and "mention" REFERENCE a row in `post` by its id in sourceId rather
 *  than copying its text. That reference is deliberate — the post table stays
 *  the single source of truth for what someone said, so re-judging a post
 *  cannot leave a stale duplicate of it sitting in here disagreeing.
 *
 *  Idempotent by (org, companyKey, sourceId): re-running a scan updates rather
 *  than duplicating, exactly as storePosts does for posts.
 */
export const accountSignal = pgTable("account_signal", {
  id: id(),
  orgId: text("org_id").notNull().references(() => org.id),
  /** Shares companyKey() with radar/score.ts — never a raw company name. */
  companyKey: text("company_key").notNull(),
  companyName: text("company_name").notNull(),
  kind: text("kind").notNull(),          // news | filing | post | mention
  /** URL for fetched items, post.id for referenced ones. The dedupe key. */
  sourceId: text("source_id").notNull(),
  source: text("source"),                // the domain, or "linkedin"
  title: text("title"),
  url: text("url"),
  body: text("body"),
  publishedAt: ts("published_at"),

  // ── Filled by the signal pass; null until it runs ──
  /** −100..100. Null means "not judged", which is not the same as neutral and
   *  must never be averaged in as a zero. */
  sentiment: integer("sentiment"),
  theme: text("theme"),
  /** The quoted span the score rests on — no score without its evidence. */
  evidence: text("evidence"),
  judgedAt: ts("judged_at"),

  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("account_signal_src_uq").on(t.orgId, t.companyKey, t.sourceId),
  index("account_signal_org_key_idx").on(t.orgId, t.companyKey, t.publishedAt),
]);

export const networkSnapshot = pgTable("network_snapshot", {
  id: id(),
  orgId: text("org_id").notNull().references(() => org.id),
  day: text("day").notNull(),                       // YYYY-MM-DD
  total: integer("total").notNull().default(0),
  pitchable: integer("pitchable").notNull().default(0),
  enriched: integer("enriched").notNull().default(0),
  active30: integer("active30").notNull().default(0),  // posted within 30d of snapshot
  sent: integer("sent").notNull().default(0),
});

export const exportLog = pgTable("export_log", {
  id: id(),
  orgId: text("org_id").notNull().references(() => org.id),
  batchId: text("batch_id"),
  label: text("label").notNull(),
  rows: integer("rows").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});
