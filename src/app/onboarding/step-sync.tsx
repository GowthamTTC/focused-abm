import { and, desc, eq, sql } from "drizzle-orm";
import { db, channelAccount, connectionBatch, job as jobTable } from "@/db";
import { enqueue } from "@/jobs/runner";
import { LiveJob } from "@/components/live-job";
import { bucketCounts } from "@/modules/matching/service-fit";
import { retryClassifyStep, startSync } from "./actions";
import { CONNECT_STEP, SYNC_STEP } from "./progress";
import type { StepQuery } from "./step-services";

const RETURN_TO = `/onboarding/${SYNC_STEP}`;
const TERMINAL = ["done", "failed", "stopped"];
const MAP_LABEL = "Mapping your connections against your ICP";

export async function StepSync({ orgId, sp }: { orgId: string; sp: StepQuery }) {
  const accounts = await db.select().from(channelAccount).where(eq(channelAccount.orgId, orgId));
  const seat = accounts.find((a) => a.status === "operational");

  if (!seat) {
    return (
      <div className="space-y-4">
        <div className="rounded-[10px] border border-[#DDE2EE] bg-[#F6F7FB] p-6">
          <p className="text-sm text-[#475467]">
            This step reads your LinkedIn network and matches it to what you sell, so it needs
            the seat from a few steps back. There is nothing to map yet — go connect it first.
          </p>
          <a href={`/onboarding/${CONNECT_STEP}`}
            className="mt-4 inline-block rounded-[10px] bg-[#263BAA] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
            Go connect LinkedIn
          </a>
        </div>
      </div>
    );
  }

  const [batch] = await db.select().from(connectionBatch)
    .where(and(eq(connectionBatch.orgId, orgId), eq(connectionBatch.source, "sync")))
    .orderBy(desc(connectionBatch.createdAt)).limit(1);

  const [syncJob] = await db.select().from(jobTable)
    .where(and(eq(jobTable.orgId, orgId), eq(jobTable.kind, "sync")))
    .orderBy(desc(jobTable.createdAt)).limit(1);

  const syncRunning = Boolean(syncJob && !TERMINAL.includes(syncJob.status));
  const syncFailed = syncJob?.status === "failed";
  // A stopped sync writes no batch (runner.ts), so it is a dead end unless this
  // step offers the import back — same for a stopped mapping pass below.
  const syncStopped = syncJob?.status === "stopped";
  const syncDone = syncJob?.status === "done";

  // Matched on the payload's batchId in SQL, so it stays the mapping pass for
  // THIS import however many other classify runs (CSV batches, re-runs from
  // Connections) landed in between — a near-miss here would re-enqueue mapping
  // on every render.
  let classifyJob: typeof syncJob | undefined;
  if (batch) {
    [classifyJob] = await db.select().from(jobTable)
      .where(and(
        eq(jobTable.orgId, orgId), eq(jobTable.kind, "classify"),
        sql`${jobTable.payloadJson}->>'batchId' = ${batch.id}`,
      ))
      .orderBy(desc(jobTable.createdAt)).limit(1);
  }

  // Auto-chain: the wizard's whole point is that this step reads as one
  // action, not three. Once the import this step just ran has a batch and
  // mapping has not started on it yet, start mapping ourselves — same
  // render-time-trigger pattern step-connect-linkedin.tsx already uses for
  // claimAccountsForUser. Rank runs inside the classify job itself
  // (jobs/runner.ts), so nothing further needs enqueuing after this.
  //
  // fullPool: the setup run maps the whole imported set, ignoring the org's
  // matching guardrail (default 1000). Every step after this one reads from
  // what lands here, so a part-mapped network here is a half-empty product
  // later — and a brand-new org has never seen that setting to raise it.
  if (syncDone && batch && !classifyJob) {
    classifyJob = await enqueue(orgId, "classify", { batchId: batch.id, fullPool: true });
  }

  const classifyRunning = Boolean(classifyJob && !TERMINAL.includes(classifyJob.status));
  const classifyFailed = classifyJob?.status === "failed";
  const classifyStopped = classifyJob?.status === "stopped";
  const classifyDone = classifyJob?.status === "done";

  const idle = !syncRunning && !classifyRunning;
  const syncBroke = syncFailed || syncStopped;
  const classifyBroke = classifyFailed || classifyStopped;
  const imported = (batch?.statsJson as { imported?: number } | null)?.imported ?? 0;
  const counts = classifyDone && batch ? await bucketCounts(batch.id) : null;
  // Mapping can finish with rows still unbucketed — a model call that failed on
  // an earlier run, or rows left behind by a pre-fullPool capped run. They are
  // invisible to every bucket count, so they are named here with the one button
  // that clears them (a continuation classify touches only unbucketed rows).
  const unmapped = counts?.unclassified ?? 0;
  const importedNothing = Boolean(counts) && imported === 0;

  return (
    <div className="space-y-5">
      {sp.err === "incomplete" && (
        <p className="rounded-[8px] border border-[#FDA29B] bg-[#FFFBFA] px-3 py-2 text-sm text-[#B42318]">
          Setup cannot continue past this step yet — everything after it works from what gets
          imported and mapped here.
        </p>
      )}
      {sp.err === "noseat" && (
        <p className="rounded-[8px] border border-[#FDA29B] bg-[#FFFBFA] px-3 py-2 text-sm text-[#B42318]">
          The LinkedIn seat disconnected before that import could start. Reconnect it and try again.
        </p>
      )}

      <div className="rounded-[10px] border border-[#DDE2EE] bg-[#F6F7FB] p-6">
        <p className="text-sm text-[#475467]">
          We pull your 1st-degree LinkedIn connections, then match each one against the ICPs you
          defined earlier — who is worth reaching out to, and for which offer. This is the step
          the rest of the tool runs on, so it has to finish once before you can move on.
        </p>
      </div>

      {(syncRunning || classifyRunning) && (
        <div className="rounded-[10px] border border-[#DDE2EE] bg-white p-4">
          <LiveJob label={MAP_LABEL}
            initial={syncRunning
              ? { id: syncJob!.id, kind: syncJob!.kind, status: syncJob!.status, progress: syncJob!.progress, total: syncJob!.total }
              : { id: classifyJob!.id, kind: classifyJob!.kind, status: classifyJob!.status, progress: classifyJob!.progress, total: classifyJob!.total }} />
        </div>
      )}

      {idle && syncBroke && (
        <div className="rounded-[10px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <p className="text-sm text-[#B42318]">
            {syncStopped
              ? "That import was stopped before it finished, so nothing was saved from it."
              : `The last import did not finish${syncJob?.error ? `: ${syncJob.error}` : "."}`}
          </p>
          <form action={startSync.bind(null, RETURN_TO)} className="mt-3">
            <button className="rounded-[10px] bg-[#263BAA] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
              {syncStopped ? "Start the import again" : "Try again"}
            </button>
          </form>
        </div>
      )}

      {idle && !syncBroke && classifyBroke && batch && (
        <div className="rounded-[10px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <p className="text-sm text-[#B42318]">
            {classifyStopped
              ? "Mapping was stopped part-way through your connections."
              : `The mapping pass did not finish${classifyJob?.error ? `: ${classifyJob.error}` : "."}`}
          </p>
          <p className="mt-1 text-sm text-[#475467]">
            Your import is safe — picking this up again maps only the connections it has not
            reached yet, and does not re-read LinkedIn.
          </p>
          <form action={retryClassifyStep.bind(null, batch.id, RETURN_TO)} className="mt-3">
            <button className="rounded-[10px] bg-[#263BAA] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
              {classifyStopped ? "Resume mapping" : "Retry mapping"}
            </button>
          </form>
        </div>
      )}

      {idle && importedNothing && (
        <div className="rounded-[10px] border border-[#FEC84B] bg-[#FFFCF5] p-5">
          <p className="text-sm font-medium text-[#B54708]">
            That import came back with no connections.
          </p>
          <p className="mt-1 text-sm text-[#475467]">
            Nothing here is broken, but there is nothing to map either — and setup needs one
            import that actually brings people in. If your LinkedIn seat was only just
            connected, give it a minute and run it again.
          </p>
        </div>
      )}

      {idle && classifyDone && counts && !importedNothing && (
        <div className="rounded-[10px] border border-[#A6E9C2] bg-[#F2FBF6] p-5">
          <p className="text-sm font-medium text-[#067647]">
            Imported {imported.toLocaleString()} connections · {counts.pitchable.toLocaleString()} worth reaching out to.
          </p>
          <p className="mt-1 text-sm text-[#475467]">
            {counts.off_icp.toLocaleString()} off-target, {counts.peer_competitor.toLocaleString()} peers or
            competitors, {counts.excluded.toLocaleString()} excluded. You can re-run this any time from Connections.
          </p>
          {unmapped > 0 && batch && (
            <div className="mt-3 border-t border-[#A6E9C2] pt-3">
              <p className="text-sm text-[#475467]">
                {unmapped.toLocaleString()} {unmapped === 1 ? "connection is" : "connections are"} still
                unmapped — they are not counted above, and nothing downstream will pick them up
                until they are.
              </p>
              <form action={retryClassifyStep.bind(null, batch.id, RETURN_TO)} className="mt-3">
                <button className="rounded-[10px] border border-[#DDE2EE] bg-white px-5 py-2.5 text-sm font-medium text-[#101828] hover:border-[#C7CFEA]">
                  Map the rest
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {idle && !syncBroke && !classifyBroke && (!syncJob || classifyDone) && (
        <div className="rounded-[10px] border border-[#DDE2EE] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[#101828]">
                {syncJob ? "Import again" : "Import your connections"}
              </p>
              <p className="mt-1 text-sm text-[#475467]">
                {syncJob
                  ? "Pulls a fresh copy of your network and maps it again."
                  : "One read of your 1st-degree connections — no posting, liking, or connecting."}
              </p>
            </div>
            <form action={startSync.bind(null, RETURN_TO)}>
              <button className="rounded-[10px] bg-[#263BAA] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
                {syncJob ? "Sync again" : "Start"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
