/**
 * Ensure a Unipile LinkedIn seat is linked to an org in channel_account.
 * Used by webhook + post-connect claim so Settings never stays empty after a successful Unipile connect.
 */
import { eq } from "drizzle-orm";
import { db, channelAccount } from "@/db";
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

  return {
    linked: true as const,
    moved: row.orgId !== input.orgId,
  };
}

/**
 * After hosted auth, Unipile stores our user id in the account `name` field.
 * List workspace accounts and claim any whose name matches this user.
 * Fallback: if exactly one Unipile seat is not in our DB, claim it for this org.
 */
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

  for (const a of accounts) {
    if (a.name === input.userId) {
      await upsertChannelAccount({
        orgId: input.orgId,
        unipileAccountId: a.id,
        displayName: a.displayName,
      });
      ids.push(a.id);
    }
  }

  if (ids.length > 0) return { claimed: ids.length, ids };

  const known = await db.select({ id: channelAccount.unipileAccountId }).from(channelAccount);
  const knownSet = new Set(known.map((k) => k.id));
  const unknown = accounts.filter((a) => !knownSet.has(a.id));

  if (unknown.length === 1) {
    const a = unknown[0]!;
    await upsertChannelAccount({
      orgId: input.orgId,
      unipileAccountId: a.id,
      displayName: a.displayName,
    });
    ids.push(a.id);
  }

  return { claimed: ids.length, ids };
}
