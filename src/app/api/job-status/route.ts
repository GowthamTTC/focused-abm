/** Tiny plain-JSON status probe for the live banner. Deliberately boring
 *  HTTP — no streaming, nothing for hostile networks to corrupt. */
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, job } from "@/db";
import { currentUser } from "@/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const [latest] = await db.select({
    id: job.id, kind: job.kind, status: job.status, progress: job.progress, total: job.total, payloadJson: job.payloadJson,
  }).from(job).where(eq(job.orgId, user.orgId)).orderBy(desc(job.createdAt)).limit(1);
  return NextResponse.json({ ok: true, job: latest ? { id: latest.id, kind: latest.kind, status: latest.status, progress: latest.progress, total: latest.total, current: typeof latest.payloadJson?.current === 'string' ? latest.payloadJson.current : null } : null },
    { headers: { "Cache-Control": "no-store" } });
}
