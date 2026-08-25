/**
 * Link Unipile LinkedIn seats to an org.
 * Paths: webhook upsert, post-connect claim, Refresh from Unipile.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, activityLog, channelAccount } from "@/db";
import { getChannelProvider } from "@/providers/channel";

function newId() {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function upsertChannelAccount(input: {
  orgId: string;
  unipileAccountId: string;
  displayName?: string | null;
  status?: string;
}) {
  const existing = await db.select().from(channelAccount)
    .where(eq(channelAccount.unipileAccountId, input.unipileAccountId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(channelAccount).values({
      id: newId(),
      orgId: input.orgId,
      unipileAccountId: input.unipileAccountId,
      status: input.status ?? "operational",
      displayName: input.displayName ?? null,
    });
    return { linked: true as const, moved: false as const };
  }

  const row = existing[0]!;
  await db.update(channelAccount).set({
    orgId: input.orgId,
    status: input.status ?? "operational",
    displayName: input.displayName ?? row.displayName,
  }).where(eq(channelAccount.unipileAccountId, input.unipileAccountId));

  return { linked: true as const, moved: row.orgId !== input.orgId };
}

/** Mark that this user started Connect LinkedIn (used if webhook is slow). */
export async function markConnectStarted(orgId: string, userId: string) {
  try {
    await db.insert(activityLog).values({
      orgId,
      actor: userId.slice(0, 200),
      action: "channel.connect_started",
      detailJson: { at: new Date().toISOString() },
    });
  } catch {
    /* non-fatal */
  }
}

export async function claimAccountsForUser(input: {
  orgId: string;
  userId: string;
}): Promise<{ claimed: number; ids: string[] }> {
  const provider = getChannelProvider();
  let accounts: { id: string; name: string | null; displayName: string | null }[] = [];
  try {
    accounts = await provider.listAccounts();
  } catch {
    return { claimed: 0, ids: [] };
  }

  const ids: string[] = [];
  const claim = async (a: { id: string; displayName: string | null }) => {
    if (ids.includes(a.id)) return;
    await upsertChannelAccount({
      orgId: input.orgId,
      unipileAccountId: a.id,
      displayName: a.displayName,
    });
    ids.push(a.id);
  };

  // 1) Hosted-auth userRef stored as Unipile account name
  for (const a of accounts) {
    if (a.name === input.userId) await claim(a);
  }
  if (ids.length > 0) return { claimed: ids.length, ids };

  const known = await db.select({ id: channelAccount.unipileAccountId }).from(channelAccount);
  const knownSet = new Set(known.map((k) => k.id));
  const unknown = accounts.filter((a) => !knownSet.has(a.id));

  // 2) Exactly one seat not in our DB → claim it
  if (unknown.length === 1) {
    await claim(unknown[0]!);
    return { claimed: ids.length, ids };
  }

  // 3) Org has no seats + user started connect in last 30m → claim preferred unknown
  const [orgSeats] = await db.select({ n: sql<number>`count(*)::int` })
    .from(channelAccount)
    .where(eq(channelAccount.orgId, input.orgId));

  if ((orgSeats?.n ?? 0) === 0 && unknown.length > 0) {
    const since = new Date(Date.now() - 30 * 60_000);
    const started = await db.select({ id: activityLog.id }).from(activityLog).where(and(
      eq(activityLog.orgId, input.orgId),
      eq(activityLog.actor, input.userId),
      eq(activityLog.action, "channel.connect_started"),
      sql`${activityLog.createdAt} >= ${since}`,
    )).limit(1);

    if (started.length > 0) {
      const preferred =
        unknown.find((a) => !a.name || a.name === input.userId)
        ?? unknown[unknown.length - 1]!;
      await claim(preferred);
    }
  }

  return { claimed: ids.length, ids };
}
