/**
 * Unipile hosted-auth notify: fires when the user finishes connecting.
 * Body includes account_id + the name we passed (our userRef).
 * Auth: WEBHOOK_SECRET via header OR ?token= query (Unipile often cannot set custom headers).
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, appUser } from "@/db";
import { getChannelProvider } from "@/providers/channel";
import { env } from "@/lib/env";
import { audit } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client-ip";
import { upsertChannelAccount } from "@/modules/channel/claim";

function secretOk(req: Request): boolean {
  const expected = env.WEBHOOK_SECRET;
  if (!expected) {
    const host = req.headers.get("host") ?? "";
    return host.startsWith("localhost") || host.startsWith("127.");
  }
  const url = new URL(req.url);
  const token = url.searchParams.get("token")
    ?? req.headers.get("x-fabm-webhook-secret")
    ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`webhook:${ip}`, 60, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429 });

  if (!secretOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as
    { account_id?: string; name?: string; status?: string; AccountStatus?: string } | null;
  const accountId = body?.account_id;
  const userRef = body?.name;
  if (!accountId || !userRef) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }

  const [u] = await db.select().from(appUser).where(eq(appUser.id, userRef)).limit(1);
  if (!u) return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });

  let displayName: string | null = null;
  try {
    displayName = (await getChannelProvider().getAccountStatus(accountId)).displayName;
  } catch { /* cosmetic */ }

  await upsertChannelAccount({
    orgId: u.orgId,
    unipileAccountId: accountId,
    displayName,
    status: "operational",
  });

  await audit(u.orgId, u.id, "channel.linked", { accountId: accountId.slice(0, 12), via: "webhook" });

  return NextResponse.json({ ok: true });
}
