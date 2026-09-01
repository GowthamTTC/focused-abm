import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, job } from "@/db";
import { requireUser } from "@/auth/session";

export async function POST() {
  const user = await requireUser();
  await db.update(job).set({ status: "stopped", updatedAt: new Date() })
    .where(and(eq(job.orgId, user.orgId), inArray(job.status, ["queued", "running", "stopping"])));
  return NextResponse.json({ ok: true });
}
