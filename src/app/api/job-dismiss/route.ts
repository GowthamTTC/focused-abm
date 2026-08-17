/** Dismiss a finished job's banner. Plain JSON in, plain JSON out — no
 *  streaming, so it survives filtered networks. Stores the flag in the job's
 *  payload (no schema change). */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, job } from "@/db";
import { currentUser } from "@/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const { id } = (await req.json()) as { id?: string };
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });
  const [row] = await db.select().from(job).where(eq(job.id, id));
  if (!row || row.orgId !== user.orgId) return NextResponse.json({ ok: false }, { status: 404 });
  const payload = (row.payloadJson ?? {}) as Record<string, unknown>;
  await db.update(job).set({ payloadJson: { ...payload, dismissed: true } }).where(eq(job.id, id));
  return NextResponse.json({ ok: true });
}
