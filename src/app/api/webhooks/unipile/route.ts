/**
 * Unipile hosted-auth notify: fires when the user finishes connecting.
 * Body includes account_id + the name we passed (our userRef).
 * Protected by WEBHOOK_SECRET (header x-fabm-webhook-secret or Authorization: Bearer).
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, appUser, channelAccount } from "@/db";
import { getChannelProvider } from "@/providers/channel";
import { env } from "@/lib/env";
import { audit } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client-ip";

function secretOk(req: Request): boolean {
  const expected = env.WEBHOOK_SECRET;
  if (!expected) {
    // Production must set WEBHOOK_SECRET. Without it, only allow non-production hosts.
    const host = req.headers.get("host") ?? "";
    return host.startsWith("localhost") || host.startsWith("127.");
  }
  const header = req.headers.get("x-fabm-webhook-secret")
    ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!header || header.length !== expected.length) return false;
  // timing-safe compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`webhook:${ip}`, 60, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429 });

  if (!secretOk(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as
    { account_id?: string; name?: string; status?: string } | null;
  if (!body?.account_id || !body?.name) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // name is our userRef (user id) — never fall back to "any user"
  const [u] = await db.select().from(appUser).where(eq(appUser.id, body.name)).limit(1);
  if (!u) return NextResponse.json({ ok: false }, { status: 404 });

  let displayName: string | null = null;
  try {
    displayName = (await getChannelProvider().getAccountStatus(body.account_id)).displayName;
  } catch { /* cosmetic */ }

  const existing = await db.select().from(channelAccount)
    .where(eq(channelAccount.unipileAccountId, body.account_id));
  if (existing.length === 0) {
    await db.insert(channelAccount).values({
      orgId: u.orgId, unipileAccountId: body.account_id, status: "operational",
      displayName,
    });
  } else {
    await db.update(channelAccount).set({
      status: "operational",
      ...(displayName ? { displayName } : {}),
    }).where(eq(channelAccount.unipileAccountId, body.account_id));
  }

  await audit(u.orgId, u.email, "channel.linkedin_connected", {
    accountId: body.account_id.slice(0, 12),
    ip,
  });

  return NextResponse.json({ ok: true });
}
