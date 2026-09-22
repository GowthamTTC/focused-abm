/**
 * Verification harness for setup's mapping step (wizard step 6).
 *
 *   UNIPILE_API_KEY= UNIPILE_DSN= npx tsx scripts/verify-setup-mapping.ts
 *
 * Step 6 is the one step setup will not let anyone walk past, because every
 * screen after it reads what it writes. Two claims carry that weight, and both
 * are checkable without spending a model call:
 *
 *  - the GATE (`orgHasSyncedConnections`) is true only after a sync that
 *    actually imported someone has been mapped. A batch with nobody in it, a
 *    mapping pass still queued, or a finished pass against some OTHER batch all
 *    have to read as "not done yet" — each one of those passed an earlier draft
 *    of the check that trusted a single signal.
 *  - `resolveMove` clamps the step a form body claims to have come from, so a
 *    hand-edited `from=8` lands back on step 6's gate instead of finishing
 *    setup. The clamp is the only thing between a curl and a skipped step.
 *
 * What is NOT here, deliberately: whether a fullPool classify covers the whole
 * imported set. That one needs the classifier itself, so it is a paid check —
 * run it by hand (cap the workspace low, classify once without fullPool and
 * once with) rather than on every pass of this suite.
 *
 * Writes rows, so it refuses to run against anything but a local database, and
 * refuses to start with real Unipile keys in the environment.
 */
import "./require-local-db";
import "./require-mock-provider";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, connection, connectionBatch, job, org, service } from "../src/db";
import { orgHasSyncedConnections } from "../src/modules/connections/sync-ready";
import { ICP_STEP, LAST_STEP, SYNC_STEP, resolveMove } from "../src/app/onboarding/progress";
import { SEED_SERVICES } from "../src/modules/services/seed-data";
import { createBatchFromRelations } from "../src/modules/connections/create-batch";
import { MockChannelProvider } from "../src/providers/channel/mock";

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

const LABEL = "setup-mapping-verify";

async function freshOrg() {
  const [o] = await db.insert(org).values({ name: LABEL }).returning();
  const s = SEED_SERVICES[0];
  await db.insert(service).values({ orgId: o.id, slug: s.slug, name: s.name, icpJson: s.icp });
  return o;
}

async function syncedBatch(orgId: string, people: number) {
  const { items } = await new MockChannelProvider().fetchRelations({ cursor: null, limit: Math.max(people, 1) });
  return createBatchFromRelations(orgId, `${LABEL} (${people})`, items.slice(0, people));
}

async function emptyBatch(orgId: string) {
  const [b] = await db.insert(connectionBatch)
    .values({ orgId, source: "sync", label: `${LABEL} (0)`, statsJson: { imported: 0 } }).returning();
  return b;
}

async function classifyJob(orgId: string, batchId: string, status: string) {
  await db.insert(job).values({
    orgId, kind: "classify", status, payloadJson: { batchId, fullPool: true }, progress: 0, total: 0,
  });
}

async function wipe(orgId: string) {
  await db.delete(connection).where(eq(connection.orgId, orgId));
  await db.delete(connectionBatch).where(eq(connectionBatch.orgId, orgId));
  await db.delete(job).where(eq(job.orgId, orgId));
  await db.delete(service).where(eq(service.orgId, orgId));
  await db.delete(org).where(eq(org.id, orgId));
}

async function main() {
  // Any wreckage from a previous interrupted run, before it can be mistaken
  // for this run's fixture.
  const stale = await db.select({ id: org.id }).from(org).where(eq(org.name, LABEL));
  for (const s of stale) await wipe(s.id);

  const o = await freshOrg();
  try {
    // ── the gate ───────────────────────────────────────────────────────────
    check("nothing imported yet reads as not-done", !(await orgHasSyncedConnections(o.id)));

    const empty = await emptyBatch(o.id);
    await classifyJob(o.id, empty.id, "done");
    check("an import that brought back nobody reads as not-done",
      !(await orgHasSyncedConnections(o.id)));

    const batch = await syncedBatch(o.id, 12);
    const [imported] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
      .where(eq(connection.batchId, batch.id));
    eqCheck("the synced batch holds the people it claims", imported.n, 12);
    check("people imported but mapping never started reads as not-done",
      !(await orgHasSyncedConnections(o.id)));

    await classifyJob(o.id, batch.id, "queued");
    check("mapping still queued reads as not-done", !(await orgHasSyncedConnections(o.id)));

    await db.delete(job).where(and(eq(job.orgId, o.id), eq(job.status, "queued")));
    await classifyJob(o.id, batch.id, "running");
    check("mapping mid-run reads as not-done", !(await orgHasSyncedConnections(o.id)));

    await db.delete(job).where(and(eq(job.orgId, o.id), eq(job.status, "running")));
    await classifyJob(o.id, batch.id, "stopped");
    check("mapping stopped part-way reads as not-done", !(await orgHasSyncedConnections(o.id)));

    await db.delete(job).where(and(eq(job.orgId, o.id), eq(job.status, "stopped")));
    await classifyJob(o.id, batch.id, "failed");
    check("mapping that failed reads as not-done", !(await orgHasSyncedConnections(o.id)));

    await db.delete(job).where(and(eq(job.orgId, o.id), eq(job.status, "failed")));
    await classifyJob(o.id, batch.id, "done");
    check("one finished mapping pass over a real import opens the gate",
      await orgHasSyncedConnections(o.id));

    // A finished pass over SOME OTHER batch must not open it: the intersection
    // is the whole point of the check, not the two signals separately.
    const other = await syncedBatch(o.id, 3);
    await db.delete(job).where(eq(job.orgId, o.id));
    await classifyJob(o.id, other.id, "done");
    const [freshRows] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
      .where(and(eq(connection.batchId, other.id), isNull(connection.bucket)));
    eqCheck("a second synced batch starts out unmapped", freshRows.n, 3);
    check("a finished pass over a different batch still opens the gate (that batch was real)",
      await orgHasSyncedConnections(o.id));

    await db.delete(job).where(eq(job.orgId, o.id));
    await classifyJob(o.id, empty.id, "done");
    check("a finished pass over the EMPTY batch does not open the gate",
      !(await orgHasSyncedConnections(o.id)));

    // ── the clamp ──────────────────────────────────────────────────────────
    // reached = 5 is someone sitting ON step 6 who has not earned it yet.
    eqCheck("a hand-edited from=8 is clamped back to step 6's gate",
      resolveMove(5, "8", "next"), { kind: "goto", from: SYNC_STEP, step: 7, persist: SYNC_STEP });
    eqCheck("from=99 lands on the same gate", resolveMove(5, "99", "next").from, SYNC_STEP);
    eqCheck("garbage in the form body lands on step 1, not past a gate",
      resolveMove(5, "not-a-number", "next").from, 1);
    eqCheck("Next off step 6 earns step 6 and moves to 7",
      resolveMove(5, "6", "next"), { kind: "goto", from: SYNC_STEP, step: 7, persist: SYNC_STEP });
    eqCheck("Back off step 6 earns nothing and lands on 5",
      resolveMove(5, "6", "back"), { kind: "goto", from: SYNC_STEP, step: 5, persist: null });
    eqCheck("finish is unreachable from step 6", resolveMove(5, "8", "next").kind, "goto");
    eqCheck("finish needs the last step earned",
      resolveMove(LAST_STEP - 1, String(LAST_STEP), "next"), { kind: "finish", from: LAST_STEP });
    check("the ICP gate sits before the mapping gate", ICP_STEP < SYNC_STEP);
  } finally {
    await wipe(o.id);
    console.log(`cleaned up the ${LABEL} workspace`);
  }

  if (failures.length > 0) {
    console.log(`${passed}/${n} checks passed — ${failures.length} FAILED:`);
    for (const f of failures) console.log(`  · ${f}`);
    process.exit(1);
  }
  console.log(`${passed}/${n} checks passed.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
