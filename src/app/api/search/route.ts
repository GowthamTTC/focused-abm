import { NextResponse } from "next/server";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db, connection } from "@/db";
import { currentUser } from "@/auth/session";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ people: [] });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ people: [] });
  const rows = await db.select({
    id: connection.id, firstName: connection.firstName, lastName: connection.lastName,
    company: connection.companyRaw, tier: connection.tier, score: connection.score,
    batchId: connection.batchId, enrichStatus: connection.enrichStatus,
  }).from(connection)
    .where(and(eq(connection.orgId, user.orgId),
      or(ilike(connection.firstName, `%${q}%`), ilike(connection.lastName, `%${q}%`), ilike(connection.companyRaw, `%${q}%`))))
    .orderBy(sql`tier asc nulls last, score desc nulls last`).limit(7);
  return NextResponse.json({ people: rows });
}
