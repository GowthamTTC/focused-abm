/**
 * Queue one Intelligence scan for a workspace, from an operator's machine.
 *
 *   CONFIRM_PRODUCTION=1 ORG_ID=... COMPANY="Allergan Aesthetics" \
 *     railway run npx tsx scripts/queue-intel-scan.ts
 *
 * Why this exists rather than "click the button": the button lives inside a
 * CLIENT's workspace and needs that client's password. Borrowing a credential
 * to save four clicks is a bad trade, and the activity log would then record
 * the client as the actor for something they did not do. This writes the same
 * job row the button writes, and the audit line says an operator did it.
 *
 * It deliberately does NOT import require-local-db: pointing at production is
 * the whole point here, so it is made a visible choice via CONFIRM_PRODUCTION
 * rather than an accident of which .env line was uncommented.
 *
 * It queues work that spends — LinkedIn search requests and model calls. It
 * queues exactly one job and prints its id.
 */
import { eq } from "drizzle-orm";
import { db, org, channelAccount } from "../src/db";
import { enqueue } from "../src/jobs/runner";
import { companyKey } from "../src/modules/radar/score";
import { audit } from "../src/lib/security/audit";

async function main() {
  if (process.env.CONFIRM_PRODUCTION !== "1") {
    throw new Error("Refusing to run without CONFIRM_PRODUCTION=1 — this writes a job that spends money.");
  }
  const orgId = (process.env.ORG_ID ?? "").trim();
  const company = (process.env.COMPANY ?? "").trim();
  const window = (process.env.WINDOW ?? "past_month").trim();
  if (!orgId || !company) throw new Error("ORG_ID and COMPANY are both required.");

  const [workspace] = await db.select().from(org).where(eq(org.id, orgId));
  if (!workspace) throw new Error(`No workspace ${orgId} on this database.`);

  // The scan cannot run without a seat, and finding that out from a failed job
  // ten seconds later is a worse way to learn it.
  const seats = await db.select({ status: channelAccount.status })
    .from(channelAccount).where(eq(channelAccount.orgId, orgId));
  const operational = seats.filter((s) => s.status === "operational").length;
  if (operational === 0) {
    throw new Error(`Workspace "${workspace.name}" has no operational LinkedIn seat (${seats.length} seats total).`);
  }

  const key = companyKey(company);
  // KEYWORDS searches for something other than the name while the rows stay
  // filed under the company — "Allergan restructuring" asks a question about
  // Allergan Aesthetics rather than naming a different account.
  const keywords = (process.env.KEYWORDS ?? "").trim() || undefined;
  const job = await enqueue(orgId, "intel_scan", {
    companyKey: key, companyName: company, window, ...(keywords ? { keywords } : {}),
  });

  await audit(orgId, "operator:cli", "intel.scan", { key, company, window, via: "queue-intel-scan" });
  console.log(JSON.stringify({
    workspace: workspace.name, orgId, company, companyKey: key, window, keywords: keywords ?? company,
    operationalSeats: operational, jobId: (job as { id?: string })?.id ?? null,
  }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
