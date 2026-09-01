/**
 * Agent tools — same org-scoped jobs as the UI buttons.
 */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, connection, accountShortlist } from "@/db";
import { companyKey } from "@/modules/radar/score";
import { toggleShortlist, enrichOneAccount, enrichOnePerson } from "@/modules/accounts/shortlist";
import { enqueue } from "@/jobs/runner";
import { countryBySlug } from "@/modules/geo/countries";

export type ToolCtx = { orgId: string };
export type PendingAction = { kind: string; title: string; yes: string; tone?: "yes" | "no" };
export type ResultCard = {
  kind: "account" | "person" | "job";
  title: string;
  subtitle?: string;
  pills: string[];
};
export type ToolOut = {
  text: string;
  open?: string;
  openLabel?: string;
  pending?: PendingAction[];
  cards?: ResultCard[];
};

function confirmed(args: Record<string, unknown>) {
  const c = args.confirm;
  return c === true || c === "true" || c === "yes";
}


export const TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "search_accounts",
      description: "Find companies in this user's pitchable network. Use before shortlist or enrich.",
      parameters: {
        type: "object",
        properties: { q: { type: "string", description: "Company or person name" } },
        required: ["q"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_people",
      description: "Find people by name, company, or job title (e.g. VP, Head of Product).",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Name, company, or title words" },
        },
        required: ["q"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "shortlist_top",
      description: "Propose or shortlist the top N ICP-weighted accounts at once. Use when the user says shortlist the top accounts / top 3 / top recommended.",
      parameters: {
        type: "object",
        properties: {
          n: { type: "number", description: "How many top accounts, default 3" },
          confirm: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "shortlist_account",
      description: "Propose or confirm starring a company. Call first with confirm=false so Nova can ask permission. Only pass confirm=true after the user says yes.",
      parameters: {
        type: "object",
        properties: {
          company: { type: "string", description: "Company name as stored" },
          confirm: { type: "boolean", description: "true only after the user agrees" },
        },
        required: ["company"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "unshortlist_account",
      description: "Remove one company from the shortlist after confirm.",
      parameters: { type: "object", properties: { company: { type: "string" }, confirm: { type: "boolean" } }, required: ["company"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "clear_shortlist",
      description: "Unshortlist every starred account after confirm. Use for unselect all.",
      parameters: { type: "object", properties: { confirm: { type: "boolean" } } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "radar_floor",
      description: "Mark a Radar person met or skipped after confirm.",
      parameters: { type: "object", properties: {
        person: { type: "string" },
        status: { type: "string", description: "met or skipped" },
        confirm: { type: "boolean" },
      }, required: ["person", "status"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "mark_sent",
      description: "Mark a person as sent after confirm.",
      parameters: { type: "object", properties: { person: { type: "string" }, confirm: { type: "boolean" } }, required: ["person"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "undo_sent",
      description: "Undo mark sent after confirm.",
      parameters: { type: "object", properties: { person: { type: "string" }, confirm: { type: "boolean" } }, required: ["person"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "flag_person",
      description: "Flag a person dropped, verify, or variant after confirm.",
      parameters: { type: "object", properties: {
        person: { type: "string" },
        verdict: { type: "string" },
        confirm: { type: "boolean" },
      }, required: ["person", "verdict"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "sync_network",
      description: "Sync LinkedIn connections after confirm.",
      parameters: { type: "object", properties: { confirm: { type: "boolean" } } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "stop_jobs",
      description: "Request stop on running jobs after confirm.",
      parameters: { type: "object", properties: { confirm: { type: "boolean" } } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "enrich_account",
      description: "Propose or queue research for remaining people at a company. confirm=true only after the user agrees.",
      parameters: {
        type: "object",
        properties: {
          company: { type: "string" },
          confirm: { type: "boolean" },
        },
        required: ["company"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "enrich_person",
      description: "Propose or queue research for one person. confirm=true only after the user agrees.",
      parameters: {
        type: "object",
        properties: {
          personId: { type: "string" },
          confirm: { type: "boolean" },
        },
        required: ["personId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "start_radar",
      description: "Propose or start Event Radar. confirm=true only after the user agrees.",
      parameters: {
        type: "object",
        properties: {
          event: { type: "string" },
          country: { type: "string", description: "united-states or india" },
          days: { type: "number" },
          pool: { type: "string", description: "first or extended" },
          confirm: { type: "boolean" },
        },
        required: ["event"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "workspace_snapshot",
      description: "Totals for this workspace: people, pitchable, companies, shortlist, researched, ready drafts.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "count_title",
      description: "How many contacts match a title (and optional company). Always returns counts by company.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title words e.g. VP, director, head of product" },
          company: { type: "string", description: "Optional company filter" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "enrich_shortlist",
      description: "Propose or enrich the shortlist. confirm=true only after the user agrees.",
      parameters: { type: "object", properties: { confirm: { type: "boolean" } } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "recommend_next",
      description: "Rank accounts. n = page size. skipShortlisted=true for 'next' accounts not already starred. offset skips that many ranked rows.",
      parameters: { type: "object", properties: {
        n: { type: "number" },
        skipShortlisted: { type: "boolean" },
        offset: { type: "number" },
      } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "whats_left",
      description: "What is still open: shortlist not researched, ready drafts, latest Radar job. Use for 'what else left', leftover, remaining.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "insight",
      description: "Workspace insight. topic=titles|gaps|lookalikes|send|radar",
      parameters: {
        type: "object",
        properties: { topic: { type: "string" } },
        required: ["topic"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_ready",
      description: "List people with a ready outreach draft on Review.",
      parameters: { type: "object", properties: {} },
    },
  },
];

async function listPeopleAt(orgId: string, key: string, nameHint = "") {
  const token = (nameHint.split("|")[0] || nameHint).trim().slice(0, 40);
  const rows = await db.select({
    firstName: connection.firstName,
    lastName: connection.lastName,
    positionRaw: connection.positionRaw,
    enrichStatus: connection.enrichStatus,
    score: connection.score,
    companyRaw: connection.companyRaw,
  }).from(connection).where(and(
    eq(connection.orgId, orgId),
    eq(connection.bucket, "pitchable"),
    ...(token ? [ilike(connection.companyRaw, `%${token}%`)] : []),
  )).limit(200);
  const people = rows.filter((r) => companyKey(r.companyRaw) === key);
  const pending = people.filter((p) => ["pending", "failed", "skipped"].includes(p.enrichStatus)).length;
  const lines = people.slice(0, 12).map((p) =>
    `${p.firstName} ${p.lastName} — ${p.positionRaw ?? "—"} · ${p.enrichStatus} · score ${p.score ?? "—"}`
  );
  const cards: ResultCard[] = people.slice(0, 8).map((p) => ({
    kind: "person" as const,
    title: `${p.firstName} ${p.lastName}`,
    subtitle: p.positionRaw ?? "—",
    pills: [p.enrichStatus, p.score != null ? `score ${p.score}` : "unscored"],
  }));
  return { n: people.length, pending, lines, cards };
}

async function findPerson(orgId: string, q: string) {
  const token = q.trim().split(/\s+/).filter((w) => !/^(yes|mark|sent|undo|flag|dropped|verify|variant|as|the|on|my|behalf)$/i.test(w)).join(" ");
  if (!token) return null;
  const [row] = await db.select({
    id: connection.id,
    firstName: connection.firstName,
    lastName: connection.lastName,
    companyRaw: connection.companyRaw,
  }).from(connection).where(and(
    eq(connection.orgId, orgId),
    or(ilike(connection.firstName, `%${token.split(" ")[0]}%`), ilike(connection.lastName, `%${token.split(" ").slice(-1)[0]}%`)),
  )).limit(1);
  return row ?? null;
}

async function resolveCompany(orgId: string, company: string) {
  const key = companyKey(company);
  const rows = await db.select({
    companyRaw: connection.companyRaw,
  }).from(connection).where(and(
    eq(connection.orgId, orgId),
    eq(connection.bucket, "pitchable"),
  )).limit(4000);
  const exact = rows.find((r) => companyKey(r.companyRaw) === key);
  if (exact) return { key: companyKey(exact.companyRaw), name: (exact.companyRaw ?? "").trim() };
  const needle = company.toLowerCase();
  const fuzzy = rows.find((r) => (r.companyRaw ?? "").toLowerCase().includes(needle));
  if (fuzzy) return { key: companyKey(fuzzy.companyRaw), name: (fuzzy.companyRaw ?? "").trim() };
  return null;
}

export async function runTool(
  ctx: ToolCtx,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOut> {
  const orgId = ctx.orgId;

  if (name === "search_accounts") {
    const q = String(args.q ?? "").trim();
    if (!q) return { text: "Need a company name." };
    const rows = await db.select({
      companyRaw: connection.companyRaw,
      firstName: connection.firstName,
      lastName: connection.lastName,
      enrichStatus: connection.enrichStatus,
    }).from(connection).where(and(
      eq(connection.orgId, orgId),
      eq(connection.bucket, "pitchable"),
      ilike(connection.companyRaw, `%${q}%`),
    )).limit(80);
    const map = new Map<string, { name: string; n: number; pending: number }>();
    for (const r of rows) {
      const k = companyKey(r.companyRaw);
      const cur = map.get(k) ?? { name: (r.companyRaw ?? "").trim(), n: 0, pending: 0 };
      cur.n += 1;
      if (["pending", "failed", "skipped"].includes(r.enrichStatus)) cur.pending += 1;
      map.set(k, cur);
    }
    const list = [...map.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    if (list.length === 0) return { text: `No pitchable company matching "${q}".` };
    return {
      text: list.map((a) => `${a.name} — ${a.n} people, ${a.pending} not researched`).join("\n"),
      open: `/accounts?company=${encodeURIComponent(list[0]!.name)}&a=${encodeURIComponent(companyKey(list[0]!.name))}`,
    };
  }

  if (name === "search_people") {
    const q = String(args.q ?? "").trim();
    if (!q) return { text: "Need a name." };
    const rows = await db.select({
      id: connection.id,
      firstName: connection.firstName,
      lastName: connection.lastName,
      companyRaw: connection.companyRaw,
      positionRaw: connection.positionRaw,
      enrichStatus: connection.enrichStatus,
      matchWhy: connection.matchWhy,
      score: connection.score,
      batchId: connection.batchId,
    }).from(connection).where(and(
      eq(connection.orgId, orgId),
      or(
        ilike(connection.firstName, `%${q}%`),
        ilike(connection.lastName, `%${q}%`),
        ilike(connection.companyRaw, `%${q}%`),
        ilike(connection.positionRaw, `%${q}%`),
      ),
    )).limit(12);
    if (rows.length === 0) return { text: `No people matching "${q}".` };
    return {
      text: rows.map((p) =>
        `${p.firstName} ${p.lastName} @ ${p.companyRaw ?? "—"} — ${p.positionRaw ?? "—"} · score ${p.score ?? "—"} · ${p.enrichStatus}${p.matchWhy ? `\n  ${p.matchWhy}` : ""} [${p.id}]`
      ).join("\n"),
      open: rows[0]?.batchId
        ? `/batches/${rows[0].batchId}?view=${rows[0].enrichStatus === "done" ? "enriched" : "pitchable"}&p=${rows[0].id}`
        : `/people?q=${encodeURIComponent(q)}`,
    };
  }


  if (name === "shortlist_top") {
    const n = Math.min(20, Math.max(1, Number(args.n) || 3));
    const { recommendAll } = await import("@/modules/recommend");
    const rec = await recommendAll(orgId);
    const pool = args.skipShortlisted ? rec.accounts.filter((a) => !a.shortlisted) : rec.accounts;
    const top = pool.slice(0, n);
    if (top.length === 0) return { text: args.skipShortlisted ? "Those next accounts are already shortlisted (or none left)." : "No pitchable accounts to shortlist." };
    const cards = top.map((a) => ({
      kind: "account" as const,
      title: a.name,
      subtitle: a.shortlisted ? "Already shortlisted" : "Proposed shortlist",
      pills: [`weighted ${a.avg}`, `${a.n} people`, `${a.pending} not researched`],
    }));
    if (!confirmed(args)) {
      return {
        text: `Shall I shortlist these ${top.length} accounts on your behalf?`,
        pending: [
          { kind: "shortlist_top", title: "Yes", yes: args.skipShortlisted
            ? `Yes, shortlist these ${top.length} accounts on my behalf.`
            : `Yes, shortlist the top ${top.length} accounts on my behalf.`, tone: "yes" },
          { kind: "no", title: "No", yes: "No, do not make that change.", tone: "no" },
        ],
        cards,
      };
    }
    for (const a of top) {
      await toggleShortlist(orgId, a.key, a.name, true);
    }
    return {
      text: `Shortlisted ${top.length} accounts.`,
      cards: top.map((a) => ({
        kind: "account" as const,
        title: a.name,
        subtitle: "Shortlisted",
        pills: [`weighted ${a.avg}`, `${a.n} people`, `${a.pending} not researched`],
      })),
    };
  }



  if (name === "mark_sent" || name === "undo_sent") {
    const hit = await findPerson(orgId, String(args.person ?? ""));
    if (!hit) return { text: "Could not find that person." };
    const label = `${hit.firstName} ${hit.lastName}`;
    const undo = name === "undo_sent";
    if (!confirmed(args)) {
      return {
        text: undo ? `Shall I undo sent for ${label}?` : `Shall I mark ${label} as sent?`,
        pending: [
          { kind: name, title: "Yes", yes: `Yes, ${undo ? "undo sent for" : "mark sent"} ${label} on my behalf.`, tone: "yes" },
          { kind: "no", title: "No", yes: "No, do not make that change.", tone: "no" },
        ],
      };
    }
    await db.update(connection).set(undo
      ? { outreachStatus: null, sentAt: null }
      : { outreachStatus: "sent", sentAt: new Date() }
    ).where(and(eq(connection.orgId, orgId), eq(connection.id, hit.id)));
    return { text: undo ? `Undid sent for ${label}.` : `Marked ${label} as sent.`, cards: [{ kind: "person" as const, title: label, subtitle: undo ? "back in queue" : "sent", pills: ["review"] }] };
  }

  if (name === "flag_person") {
    const hit = await findPerson(orgId, String(args.person ?? ""));
    if (!hit) return { text: "Could not find that person." };
    const verdict = ["dropped", "verify", "variant"].includes(String(args.verdict)) ? String(args.verdict) : "verify";
    const label = `${hit.firstName} ${hit.lastName}`;
    if (!confirmed(args)) {
      return {
        text: `Shall I flag ${label} as ${verdict}?`,
        pending: [
          { kind: "flag_person", title: "Yes", yes: `Yes, flag ${label} as ${verdict} on my behalf.`, tone: "yes" },
          { kind: "no", title: "No", yes: "No, do not make that change.", tone: "no" },
        ],
      };
    }
    await db.update(connection).set({ flagVerdict: verdict }).where(and(eq(connection.orgId, orgId), eq(connection.id, hit.id)));
    return { text: `Flagged ${label} as ${verdict}.` };
  }

  if (name === "sync_network") {
    if (!confirmed(args)) {
      return {
        text: "Shall I sync LinkedIn connections on your behalf?",
        pending: [
          { kind: "sync_network", title: "Yes", yes: "Yes, sync my network on my behalf.", tone: "yes" },
          { kind: "no", title: "No", yes: "No, do not make that change.", tone: "no" },
        ],
      };
    }
    const { channelAccount } = await import("@/db");
    const [seat] = await db.select().from(channelAccount).where(and(eq(channelAccount.orgId, orgId), eq(channelAccount.status, "operational")));
    if (!seat) return { text: "Connect LinkedIn in Settings first." };
    await enqueue(orgId, "sync", { accountId: seat.unipileAccountId, seatId: seat.id });
    return { text: "Network sync queued. Watch the top bar." };
  }

  if (name === "stop_jobs") {
    if (!confirmed(args)) {
      return {
        text: "Shall I request stop on running jobs?",
        pending: [
          { kind: "stop_jobs", title: "Yes", yes: "Yes, stop running jobs on my behalf.", tone: "yes" },
          { kind: "no", title: "No", yes: "No, do not make that change.", tone: "no" },
        ],
      };
    }
    const { job } = await import("@/db");
    await db.update(job).set({ status: "stopping" }).where(and(eq(job.orgId, orgId), eq(job.status, "running")));
    return { text: "Stop requested on running jobs." };
  }

  if (name === "unshortlist_account") {
    const company = String(args.company ?? "").trim();
    const hit = await resolveCompany(orgId, company);
    if (!hit) return { text: `Could not find "${company}" on pitchable accounts.` };
    if (!confirmed(args)) {
      return {
        text: `Shall I remove ${hit.name} from the shortlist?`,
        pending: [
          { kind: "unshortlist_account", title: "Yes", yes: `Yes, unshortlist ${hit.name} on my behalf.`, tone: "yes" },
          { kind: "no", title: "No", yes: "No, do not make that change.", tone: "no" },
        ],
        cards: [{ kind: "account", title: hit.name, subtitle: "Remove from shortlist", pills: ["unselect"] }],
      };
    }
    await toggleShortlist(orgId, hit.key, hit.name, false);
    return { text: `Removed ${hit.name} from the shortlist.`, cards: [{ kind: "account", title: hit.name, subtitle: "Unshortlisted", pills: ["removed"] }] };
  }

  if (name === "clear_shortlist") {
    const rows = await db.select({ companyName: accountShortlist.companyName, companyKey: accountShortlist.companyKey }).from(accountShortlist).where(eq(accountShortlist.orgId, orgId));
    if (!confirmed(args)) {
      return {
        text: `Shall I unshortlist all ${rows.length} accounts?`,
        pending: rows.length ? [
          { kind: "clear_shortlist", title: "Yes", yes: "Yes, unshortlist all accounts on my behalf.", tone: "yes" },
          { kind: "no", title: "No", yes: "No, do not make that change.", tone: "no" },
        ] : [],
        cards: rows.slice(0, 12).map((r) => ({ kind: "account" as const, title: r.companyName, subtitle: "Will unselect", pills: ["starred"] })),
      };
    }
    await db.delete(accountShortlist).where(eq(accountShortlist.orgId, orgId));
    return { text: `Cleared the shortlist (${rows.length} accounts).` };
  }

  if (name === "radar_floor") {
    const q = String(args.person ?? "").trim();
    const status = String(args.status ?? "").toLowerCase() === "skipped" ? "skipped" : "met";
    const rows = await db.select({ id: connection.id, firstName: connection.firstName, lastName: connection.lastName, companyRaw: connection.companyRaw }).from(connection).where(and(
      eq(connection.orgId, orgId),
      or(ilike(connection.firstName, `%${q}%`), ilike(connection.lastName, `%${q}%`)),
    )).limit(5);
    const hit = rows[0];
    if (!hit) return { text: `No person matching "${q}".` };
    const label = `${hit.firstName} ${hit.lastName}`;
    if (!confirmed(args)) {
      return {
        text: `Shall I mark ${label} as ${status} on Radar?`,
        pending: [
          { kind: "radar_floor", title: "Yes", yes: `Yes, mark ${label} ${status} on my behalf.`, tone: "yes" },
          { kind: "no", title: "No", yes: "No, do not make that change.", tone: "no" },
        ],
      };
    }
    await db.update(connection).set({ floorStatus: status, floorAt: new Date() }).where(and(eq(connection.orgId, orgId), eq(connection.id, hit.id)));
    return { text: `Marked ${label} as ${status}.`, cards: [{ kind: "person", title: label, subtitle: status, pills: ["radar"] }] };
  }

  if (name === "shortlist_account") {
    const company = String(args.company ?? "").trim();
    const hit = await resolveCompany(orgId, company);
    if (!hit) return { text: `Could not find company "${company}" in pitchable accounts.` };
    const roster = await listPeopleAt(orgId, hit.key, hit.name);
    if (!confirmed(args)) {
      return {
        text: `Shall I mark ${hit.name} as shortlisted on your behalf?`,
        pending: [
          { kind: "shortlist_account", title: "Yes", yes: `Yes, shortlist ${hit.name} on my behalf.`, tone: "yes" },
          { kind: "no", title: "No", yes: "No, do not make that change.", tone: "no" },
        ],
        cards: [{ kind: "account", title: hit.name, subtitle: "Proposed shortlist", pills: [`${roster.n} people`, `${roster.pending} not researched`] }],
      };
    }
    await toggleShortlist(orgId, hit.key, hit.name, true);
    return {
      text: `Shortlisted ${hit.name}. ${roster.n} people on this account.`,
      cards: [
        { kind: "account", title: hit.name, subtitle: "Shortlisted", pills: ["shortlist", `${roster.n} people`, `${roster.pending} not researched`] },
        ...roster.cards,
      ],
    };
  }

  if (name === "enrich_account") {
    const company = String(args.company ?? "").trim();
    const hit = await resolveCompany(orgId, company);
    if (!hit) return { text: `Could not find company "${company}".` };
    const roster = await listPeopleAt(orgId, hit.key, hit.name);
    if (!confirmed(args)) {
      return {
        text: `Shall I enrich remaining contacts at ${hit.name} on your behalf?`,
        pending: [
          { kind: "enrich_account", title: "Yes", yes: `Yes, enrich remaining contacts at ${hit.name} on my behalf.`, tone: "yes" },
          { kind: "no", title: "No", yes: "No, do not make that change.", tone: "no" },
        ],
        cards: [{ kind: "account", title: hit.name, subtitle: "Proposed enrich", pills: [`${roster.pending} to research`] }],
      };
    }
    await toggleShortlist(orgId, hit.key, hit.name, true);
    const result = await enrichOneAccount(orgId, hit.key);
    return {
      text: result.people === 0
        ? `${hit.name}: nobody left to research.`
        : `Queued research for ${result.people} at ${hit.name}. Results stay in this chat as they complete.`,
      cards: [
        { kind: "job", title: hit.name, subtitle: "Research queued", pills: [`${result.people} queued`] },
        ...roster.cards,
      ],
    };
  }

  if (name === "enrich_person") {
    const personId = String(args.personId ?? "").trim();
    if (!confirmed(args)) {
      return {
        text: "Shall I enrich this person on your behalf? That uses a research credit.",
        pending: [
          { kind: "enrich_person", title: "Yes", yes: `Yes, enrich person ${personId} on my behalf.`, tone: "yes" },
          { kind: "no", title: "No", yes: "No, do not make that change.", tone: "no" },
        ],
      };
    }
    const ok = await enrichOnePerson(orgId, personId);
    if (!ok) return { text: "Person not found in this workspace." };
    return { text: "Queued research for that person. Watch the top bar.", open: "/people", openLabel: "Open People" };
  }

  if (name === "start_radar") {
    const eventName = String(args.event ?? "").trim();
    if (!eventName) return { text: "Need an event name." };
    const country = String(args.country ?? "united-states");
    const slug = countryBySlug(country) ? country : (country.toLowerCase().includes("india") ? "india" : "united-states");
    if (!countryBySlug(slug)) return { text: "Country must be united-states or india." };
    const days = Math.min(30, Math.max(1, Number(args.days) || 7));
    const pool = String(args.pool ?? "first") === "extended" ? "extended" : "first";
    if (!confirmed(args)) {
      return {
        text: `Shall I start a Radar scan for "${eventName}" (${slug}, last ${days} days, ${pool}) on your behalf?`,
        pending: [
          { kind: "start_radar", title: "Yes", yes: `Yes, start Radar for ${eventName} in ${slug} last ${days} days on my behalf.`, tone: "yes" },
          { kind: "no", title: "No", yes: "No, do not make that change.", tone: "no" },
        ],
      };
    }
    await enqueue(orgId, "event_extended", {
      country: slug,
      days,
      eventName,
      degree: pool === "extended" ? "extended" : "first",
    });
    return {
      text: `Radar scan started: "${eventName}", ${slug}, last ${days} days, ${pool === "extended" ? "2nd/3rd" : "1st"} degree. Watch the top bar.`,
      open: `/radar?days=${days}&pool=${pool}&country=${slug}&scanning=1&event=${encodeURIComponent(eventName)}&q=${encodeURIComponent(eventName)}`,
      openLabel: "Open Radar",
    };
  }

  if (name === "workspace_snapshot") {
    const [row] = await db.select({
      people: sql<number>`count(*)::int`,
      pitchable: sql<number>`count(*) filter (where bucket = 'pitchable')::int`,
      researched: sql<number>`count(*) filter (where enrich_status = 'done')::int`,
      pending: sql<number>`count(*) filter (where bucket = 'pitchable' and enrich_status in ('pending','failed','skipped'))::int`,
      ready: sql<number>`count(*) filter (where outreach_message is not null and sent_at is null)::int`,
      companies: sql<number>`count(distinct company_raw) filter (where bucket = 'pitchable' and company_raw is not null and company_raw <> '')::int`,
    }).from(connection).where(eq(connection.orgId, orgId));
    const [sl] = await db.select({ n: sql<number>`count(*)::int` }).from(accountShortlist).where(eq(accountShortlist.orgId, orgId));
    return {
      text: [
        `People: ${row?.people ?? 0}`,
        `Pitchable: ${row?.pitchable ?? 0}`,
        `Companies: ${row?.companies ?? 0}`,
        `On shortlist: ${sl?.n ?? 0}`,
        `Researched: ${row?.researched ?? 0}`,
        `Pitchable not researched: ${row?.pending ?? 0}`,
        `Ready drafts: ${row?.ready ?? 0}`,
      ].join("\n"),
    };
  }

  if (name === "count_title") {
    const title = String(args.title ?? "").trim();
    const company = String(args.company ?? "").trim();
    if (!title) return { text: "Need a title." };
    const cond = [eq(connection.orgId, orgId), eq(connection.bucket, "pitchable"), ilike(connection.positionRaw, `%${title}%`)];
    const rows = await db.select({
      id: connection.id,
      firstName: connection.firstName,
      lastName: connection.lastName,
      companyRaw: connection.companyRaw,
      positionRaw: connection.positionRaw,
      enrichStatus: connection.enrichStatus,
    }).from(connection).where(and(...cond)).limit(400);
    const filtered = company
      ? rows.filter((r) => (r.companyRaw ?? "").toLowerCase().includes(company.toLowerCase()))
      : rows;
    if (filtered.length === 0) return { text: `0 pitchable contacts with title matching "${title}"${company ? ` at ${company}` : ""}.` };
    const byCo = new Map<string, { n: number; pending: number }>();
    for (const r of filtered) {
      const name = (r.companyRaw ?? "Unknown").trim() || "Unknown";
      const cur = byCo.get(name) ?? { n: 0, pending: 0 };
      cur.n += 1;
      if (["pending", "failed", "skipped"].includes(r.enrichStatus)) cur.pending += 1;
      byCo.set(name, cur);
    }
    const ranked = [...byCo.entries()].sort((a, b) => b[1].n - a[1].n);
    const top = ranked[0]!;
    const sample = filtered.slice(0, 8).map((p) => `${p.firstName} ${p.lastName} — ${p.positionRaw} @ ${p.companyRaw}`).join("\n");
    return {
      text: [
        `${filtered.length} pitchable contact(s) matching title "${title}"${company ? ` at ${company}` : ""}.`,
        `Across ${ranked.length} companies.`,
        `Largest share: ${top[0]} with ${top[1].n} (${Math.round(top[1].n / filtered.length * 100)}%).`,
        ranked.slice(0, 8).map(([n, s]) => `${n}: ${s.n} people, ${s.pending} not researched`).join("\n"),
        "Sample:",
        sample,
      ].join("\n"),
      open: `/accounts?q=${encodeURIComponent(top[0])}`,
    };
  }

  if (name === "enrich_shortlist") {
    const { recommendAll } = await import("@/modules/recommend");
    const rec = await recommendAll(orgId);
    const need = rec.accounts.filter((a) => a.shortlisted && a.pending > 0);
    const needCards = need.slice(0, 12).map((a) => ({
      kind: "account" as const,
      title: a.name,
      subtitle: "Needs research",
      pills: [`${a.pending} left`, `weighted ${a.avg}`],
    }));
    if (!confirmed(args)) {
      return {
        text: need.length
          ? `Shall I enrich the ${need.length} shortlisted accounts that still have unresearched people?`
          : "Everyone on the shortlist is already researched.",
        pending: need.length ? [
          { kind: "enrich_shortlist", title: "Yes", yes: "Yes, enrich remaining contacts on the shortlist on my behalf.", tone: "yes" },
          { kind: "no", title: "No", yes: "No, do not make that change.", tone: "no" },
        ] : [],
        cards: needCards,
      };
    }
    const { enrichShortlistedAccounts } = await import("@/modules/accounts/shortlist");
    const result = await enrichShortlistedAccounts(orgId);
    return {
      text: result.people === 0
        ? "Nobody left to research on the shortlist."
        : `Queued research for ${result.people} people at ${need.length} accounts that still needed it.`,
      cards: needCards,
    };
  }

  if (name === "recommend_next") {
    const { recommendAll, formatRecommend } = await import("@/modules/recommend");
    const rec = await recommendAll(orgId);
    const n = Math.min(20, Math.max(1, Number(args.n) || 3));
    const offset = Math.max(0, Number(args.offset) || 0);
    const pool = args.skipShortlisted ? rec.accounts.filter((a) => !a.shortlisted) : rec.accounts;
    const slice = pool.slice(offset, offset + n);
    if (slice.length === 0) {
      return { text: args.skipShortlisted
        ? "No more pitchable accounts outside the shortlist."
        : "No pitchable accounts to rank." };
    }
    const top = slice[0];
    return {
      text: formatRecommend({ ...rec, accounts: slice }),
      cards: slice.map((a) => ({
        kind: "account" as const,
        title: a.name,
        subtitle: a.shortlisted ? "Shortlisted" : "ICP match",
        pills: [`weighted ${a.avg}`, `${a.n} people`, `${a.pending} not researched`],
      })),
    };
  }

  if (name === "whats_left") {
    const { recommendAll } = await import("@/modules/recommend");
    const rec = await recommendAll(orgId);
    const short = rec.accounts.filter((a) => a.shortlisted);
    const need = short.filter((a) => a.pending > 0);
    const drafts = rec.accounts; // unused
    const [ready] = await db.select({
      n: sql<number>`count(*) filter (where outreach_message is not null and sent_at is null)::int`,
    }).from(connection).where(eq(connection.orgId, orgId));
    const text = [
      `Shortlisted accounts: ${short.length}.`,
      `Still need research: ${need.length} accounts (${need.reduce((s, a) => s + a.pending, 0)} people).`,
      need.length ? need.map((a) => `- ${a.name}: ${a.pending} left`).join("\n") : "- Shortlist research is complete.",
      `Ready drafts not sent: ${ready?.n ?? 0}.`,
    ].join("\n");
    return {
      text,
      cards: (need.length ? need : short).slice(0, 10).map((a) => ({
        kind: "account" as const,
        title: a.name,
        subtitle: a.pending > 0 ? "Still to research" : "Researched",
        pills: [`weighted ${a.avg}`, `${a.n} people`, `${a.pending} left`],
      })),
    };
  }


  if (name === "insight") {
    const topic = String(args.topic ?? "titles");
    const { recommendAll } = await import("@/modules/recommend");
    const rec = await recommendAll(orgId);
    if (topic === "gaps") {
      const rows = rec.committee.slice(0, 8);
      return {
        text: rows.length
          ? rows.map((c) => `${c.name}: ${c.have} seats, missing ${c.missing.join(", ")}`).join("\n")
          : "No committee gaps in the current pitchable set.",
        cards: rows.map((c) => ({
          kind: "account" as const,
          title: c.name,
          subtitle: "Committee gap",
          pills: [`${c.have} seats`, ...c.missing.slice(0, 3)],
        })),
      };
    }
    if (topic === "lookalikes") {
      return {
        text: rec.lookalike.length
          ? rec.lookalike.slice(0, 8).map((p) => `${p.name} @ ${p.company} · ${p.similarToReady}% like drafted/sent`).join("\n")
          : "No lookalikes yet — draft or send a few first.",
        cards: rec.lookalike.slice(0, 8).map((p) => ({
          kind: "person" as const,
          title: p.name,
          subtitle: String(p.company ?? ""),
          pills: [`${p.similarToReady}% similar`, p.title ?? ""],
        })),
      };
    }
    if (topic === "enriched") {
      const done = rec.accounts.filter((a) => a.pending === 0).slice(0, 12);
      const need = rec.accounts.filter((a) => a.pending > 0).slice(0, 5);
      const lines = [
        done.length ? "Fully researched accounts:" : "No fully researched accounts yet.",
        ...done.map((a) => `- ${a.name}: ${a.n} people, weighted ${a.avg}`),
        need.length ? "Still need research:" : "",
        ...need.map((a) => `- ${a.name}: ${a.pending} left`),
      ].filter(Boolean);
      return {
        text: lines.join("\n"),
        cards: done.map((a) => ({
          kind: "account" as const,
          title: a.name,
          subtitle: "Researched",
          pills: [`weighted ${a.avg}`, `${a.n} people`],
        })),
      };
    }
    if (topic === "send") {
      const ready = rec.weightedPeople.filter((p) => p.status === "done").slice(0, 8);
      return {
        text: ready.length
          ? ready.map((p) => `${p.name} @ ${p.company} · rec ${p.rec} · ICP ${p.score ?? "—"}`).join("\n")
          : "No researched priority people yet. Enrich the shortlist first.",
        cards: ready.map((p) => ({
          kind: "person" as const,
          title: p.name,
          subtitle: String(p.company ?? ""),
          pills: [`rec ${p.rec}`, p.score != null ? `ICP ${p.score}` : ""],
        })),
      };
    }
    if (topic === "radar") {
      const rows = await db.select({
        firstName: connection.firstName,
        lastName: connection.lastName,
        companyRaw: connection.companyRaw,
        eventQuery: connection.eventQuery,
        mentionSnippet: connection.mentionSnippet,
      }).from(connection).where(and(
        eq(connection.orgId, orgId),
        sql`event_query is not null`,
      )).orderBy(desc(connection.mentionAt)).limit(12);
      return {
        text: rows.length
          ? rows.map((r) => `${r.firstName} ${r.lastName} @ ${r.companyRaw ?? "—"} · ${r.eventQuery}`).join("\n")
          : "No Radar hits stored yet. Scan an event first.",
        cards: rows.map((r) => ({
          kind: "person" as const,
          title: `${r.firstName} ${r.lastName}`,
          subtitle: String(r.companyRaw ?? r.eventQuery ?? ""),
          pills: [r.eventQuery ?? "radar"],
        })),
      };
    }
    return {
      text: rec.titles.map((x) => `${x.label}: ${x.n}` + (x.topAccount ? ` · most at ${x.topAccount} (${x.share}%)` : "")).join("\n"),
      cards: rec.titles.slice(0, 8).map((x) => ({
        kind: "account" as const,
        title: x.label,
        subtitle: x.topAccount ? `most at ${x.topAccount}` : "title mix",
        pills: [`${x.n}`, x.share ? `${x.share}%` : ""],
      })),
    };
  }

  if (name === "list_ready") {
    const rows = await db.select({
      id: connection.id,
      firstName: connection.firstName,
      lastName: connection.lastName,
      companyRaw: connection.companyRaw,
      batchId: connection.batchId,
    }).from(connection).where(and(
      eq(connection.orgId, orgId),
      sql`outreach_message is not null`,
      sql`sent_at is null`,
    )).orderBy(desc(connection.rank)).limit(12);
    if (rows.length === 0) return { text: "No ready drafts. Enrich people first, then open Review.", open: "/review?tab=ready" };
    return {
      text: rows.map((p) => `${p.firstName} ${p.lastName} @ ${p.companyRaw ?? "—"}`).join("\n"),
      open: `/review?tab=ready`,
      openLabel: "Open Review",
    };
  }

  return { text: `Unknown tool ${name}` };
}
