/**
 * Unipile hosted-auth notify: fires when the user finishes connecting.
 * Body includes account_id + the name we passed (our userRef).
 * Local dev: expose via ngrok and set APP_URL to the ngrok URL.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, appUser, channelAccount } from "@/db";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    { account_id?: string; name?: string; status?: string } | null;
  if (!body?.account_id) return NextResponse.json({ ok: false }, { status: 400 });

  const [u] = body.name
    ? await db.select().from(appUser).where(eq(appUser.id, body.name))
    : await db.select().from(appUser);
  if (!u) return NextResponse.json({ ok: false }, { status: 404 });

  const existing = await db.select().from(channelAccount)
    .where(eq(channelAccount.unipileAccountId, body.account_id));
  if (existing.length === 0) {
    await db.insert(channelAccount).values({
      orgId: u.orgId, unipileAccountId: body.account_id, status: "operational",
    });
  } else {
    await db.update(channelAccount).set({ status: "operational" })
      .where(eq(channelAccount.unipileAccountId, body.account_id));
  }
  return NextResponse.json({ ok: true });
}
