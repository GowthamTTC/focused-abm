/**
 * Verification harness for the research queue — the one brake every
 * tick-and-run presses (People, the Matched table, the account card).
 *
 *   UNIPILE_API_KEY= UNIPILE_DSN= npx tsx scripts/verify-enrich-queue.ts
 *
 * What is worth pinning here is not "does it enqueue" but every way a click can
 * end up spending nothing, or spending someone else's budget:
 *
 *  - a row already researched or in flight is never re-queued (it is `skipped`,
 *    and skipped rows must not eat the allowance);
 *  - the allowance is the smaller of today's remaining cap and the per-run tick
 *    ceiling, and the overflow is reported as `held` rather than enqueued for a
 *    worker that would throw partway through the run;
 *  - a person from another workspace is not ours to enrich, however the id got
 *    into the form body;
 *  - what IS queued is the best-ranked of what was ticked, because a clamp has
 *    to keep the people most worth the money;
 *  - the job payload holds exactly the ids that were queued, and the rows are
 *    marked so the batch screen shows them as in flight.
 *
 * Writes rows and enqueues jobs, so it refuses to run against anything but a
 * local database, and refuses to start with real Unipile keys present. It never
 * RUNS a job — nothing here costs a model call or touches LinkedIn.
 */
import "./require-local-db";
import "./require-mock-provider";
import { and, eq, inArray } from "drizzle-orm";
import { db, connection, connectionBatch, job, org } from "../src/db";
import { enrichAllowance, outcomeQs, queueEnrich } from "../src/modules/enrich/queue";
import { MAX_MANUAL_SELECT } from "../src/modules/enrich/limits";
import { enrichStateOf, isEnrichable } from "../src/modules/enrich/status";
import { env } from "../src/lib/env";

let passed = 0;
const failures: string[] = [];
let n = 0;

function check(label: string, ok: boolean, detail?: string) {
  n += 1;
  if (ok) { passed += 1; console.log(`ok   ${String(n).padStart(2)} · ${label}`); }
  else { failures.push(`${n} · ${label}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL ${String(n).padStart(2)} · ${label}${detail ? ` — ${detail}` : ""}`); }
}
function eqCheck(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(label, a === e, a === e ? undefined : `expected ${e}, got ${a}`);
}

const LABEL = "enrich-queue-verify";

/** People differing only in rank and research state, so every assertion below
 *  is about the queue rather than about scoring. */
interface Person { key: string; rank: number; status?: string; enrichedAt?: Date | null }

async function addPeople(orgId: string, batchId: string, people: Person[]) {
  const ids = new Map<string, string>();
  for (const p of people) {
    const [row] = await db.insert(connection).values({
      orgId, batchId,
      firstName: p.key, lastName: "Verify",
      bucket: "pitchable", rank: p.rank, score: 100 - p.rank,
      enrichStatus: p.status ?? "pending",
      enrichedAt: p.enrichedAt ?? null,
    }).returning({ id: connection.id });
    ids.set(p.key, row.id);
  }
  return ids;
}

async function fixture(orgName: string, people: Person[]) {
  const [o] = await db.insert(org).values({ name: orgName }).returning();
  const [batch] = await db.insert(connectionBatch)
    .values({ orgId: o.id, source: "csv", label: orgName, statsJson: { imported: people.length } })
    .returning();
  return { orgId: o.id, batchId: batch.id, ids: await addPeople(o.id, batch.id, people) };
}

async function wipe(orgName: string) {
  const rows = await db.select({ id: org.id }).from(org).where(eq(org.name, orgName));
  for (const o of rows) {
    await db.delete(connection).where(eq(connection.orgId, o.id));
    await db.delete(connectionBatch).where(eq(connectionBatch.orgId, o.id));
    await db.delete(job).where(eq(job.orgId, o.id));
    await db.delete(org).where(eq(org.id, o.id));
  }
}

/** The ids a deep_enrich job was handed, newest job first. */
async function queuedPayloads(orgId: string): Promise<string[][]> {
  const jobs = await db.select({ payloadJson: job.payloadJson }).from(job)
    .where(and(eq(job.orgId, orgId), eq(job.kind, "deep_enrich")));
  return jobs.map((j) => (j.payloadJson.connectionIds as string[]) ?? []);
}

const MINE = `${LABEL} A`;
const THEIRS = `${LABEL} B`;

async function main() {
  await wipe(MINE); await wipe(THEIRS);

  // ── state model ────────────────────────────────────────────────────────────
  eqCheck("a fresh row is not enriched", enrichStateOf({ enrichStatus: "pending" }), "not-enriched");
  eqCheck("queued and running both read as researching", [
    enrichStateOf({ enrichStatus: "queued" }), enrichStateOf({ enrichStatus: "running" }),
  ], ["researching", "researching"]);
  eqCheck("a finished row is enriched", enrichStateOf({ enrichStatus: "done" }), "enriched");
  eqCheck("a row re-queued after a success reads as researching, not enriched",
    enrichStateOf({ enrichStatus: "queued", enrichedAt: new Date() }), "researching");
  eqCheck("a reset status with a date still reads as enriched",
    enrichStateOf({ enrichStatus: "pending", enrichedAt: new Date() }), "enriched");
  eqCheck("only the states with nothing to read are enrichable",
    (["not-enriched", "failed", "skipped", "enriched", "researching"] as const).map(isEnrichable),
    [true, true, true, false, false]);

  // ── the queue ──────────────────────────────────────────────────────────────
  const mine = await fixture(MINE, [
    { key: "best", rank: 1 },
    { key: "second", rank: 2 },
    { key: "third", rank: 3 },
    // Enriched YESTERDAY: this row is here for the state model, and dating it
    // today would spend one of the budget slots the allowance checks below count.
    { key: "done", rank: 4, status: "done", enrichedAt: new Date(Date.now() - 864e5) },
    { key: "inflight", rank: 5, status: "running" },
    { key: "failed", rank: 6, status: "failed" },
  ]);
  const id = (k: string) => mine.ids.get(k)!;

  eqCheck("an empty tick queues nothing", await queueEnrich(mine.orgId, []), { queued: 0, held: 0, skipped: 0 });

  const one = await queueEnrich(mine.orgId, [id("best")]);
  eqCheck("one eligible person is queued", one, { queued: 1, held: 0, skipped: 0 });
  eqCheck("the job was handed exactly that person", await queuedPayloads(mine.orgId), [[id("best")]]);
  const [best] = await db.select().from(connection).where(eq(connection.id, id("best")));
  eqCheck("and the row now reads as researching", enrichStateOf(best), "researching");
  check("so a second click on the same person spends nothing",
    JSON.stringify(await queueEnrich(mine.orgId, [id("best")])) === JSON.stringify({ queued: 0, held: 0, skipped: 1 }));

  eqCheck("already-researched and in-flight rows are skipped, never re-queued",
    await queueEnrich(mine.orgId, [id("done"), id("inflight")]), { queued: 0, held: 0, skipped: 2 });
  eqCheck("a failed row is still worth paying for",
    await queueEnrich(mine.orgId, [id("failed")]), { queued: 1, held: 0, skipped: 0 });

  // Someone else's person, however the id reached the form body.
  const theirs = await fixture(THEIRS, [{ key: "stranger", rank: 1 }]);
  eqCheck("a person from another workspace is not ours to enrich",
    await queueEnrich(mine.orgId, [theirs.ids.get("stranger")!]), { queued: 0, held: 0, skipped: 0 });
  eqCheck("and no job was created for them", (await queuedPayloads(theirs.orgId)).length, 0);

  // ── the allowance ──────────────────────────────────────────────────────────
  const room = await enrichAllowance(mine.orgId);
  eqCheck("the allowance is the smaller of today's room and the per-run ceiling",
    room.allowance, Math.min(room.room, MAX_MANUAL_SELECT));
  check("today's room is what the cap has left",
    room.room === Math.max(0, env.DEEP_ENRICH_DAILY_CAP - room.used),
    `room ${room.room}, cap ${env.DEEP_ENRICH_DAILY_CAP}, used ${room.used}`);

  // Spend the day: enriched_at inside today is what the cap counts, so dating
  // finished rows today is the same brake the worker feels. They go in THIS
  // workspace — usage is per-org, and an earlier version of this harness put
  // them in a second one and proved only that the cap is scoped.
  const spentIds = await addPeople(mine.orgId, mine.batchId,
    Array.from({ length: env.DEEP_ENRICH_DAILY_CAP }, (_, i) => ({
      key: `spent${i}`, rank: 100 + i, status: "done", enrichedAt: new Date(),
    })));
  const afterSpend = await enrichAllowance(mine.orgId);
  eqCheck("with the day's budget spent there is no allowance left", afterSpend.allowance, 0);
  eqCheck("so eligible people are held back, not enqueued",
    await queueEnrich(mine.orgId, [id("second"), id("third")]), { queued: 0, held: 2, skipped: 0 });
  eqCheck("and nothing new reached the worker", (await queuedPayloads(mine.orgId)).length, 2);

  // Free one slot and confirm the clamp keeps the best-ranked of the two.
  await db.update(connection).set({ enrichedAt: null, enrichStatus: "skipped" })
    .where(and(eq(connection.orgId, mine.orgId), inArray(connection.id, [spentIds.get("spent0")!])));
  const freed = await enrichAllowance(mine.orgId);
  eqCheck("one returned slot is one unit of allowance", freed.allowance, 1);
  eqCheck("the clamp queues the best-ranked of what was ticked",
    await queueEnrich(mine.orgId, [id("third"), id("second")]), { queued: 1, held: 1, skipped: 0 });
  const payloads = await queuedPayloads(mine.orgId);
  eqCheck("and it is the better rank that went", payloads[payloads.length - 1], [id("second")]);

  // ── what the screens read back ─────────────────────────────────────────────
  eqCheck("a clean run says only what ran", outcomeQs({ queued: 3, held: 0, skipped: 0 }), "run=3");
  eqCheck("held and kept counts ride along when there are any",
    outcomeQs({ queued: 1, held: 2, skipped: 3 }), "run=1&held=2&kept=3");

  await wipe(MINE); await wipe(THEIRS);
  console.log(`cleaned up the ${LABEL} workspaces`);

  if (failures.length > 0) {
    console.log(`${passed}/${n} checks passed — ${failures.length} FAILED:`);
    for (const f of failures) console.log(`  · ${f}`);
    process.exit(1);
  }
  console.log(`${passed}/${n} checks passed.`);
  process.exit(0);
}
main().catch(async (e) => { console.error(e); await wipe(MINE); await wipe(THEIRS); process.exit(1); });
