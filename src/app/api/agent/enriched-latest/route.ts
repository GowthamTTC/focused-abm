import { and, desc, eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUser } from "@/auth/session";
import { db, connection } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const rows = await db.select({
    id: connection.id,
    firstName: connection.firstName,
    lastName: connection.lastName,
    companyRaw: connection.companyRaw,
    positionRaw: connection.positionRaw,
    score: connection.score,
    aboutSummary: connection.aboutSummary,
    painPoints: connection.painPoints,
    outreachMessage: connection.outreachMessage,
    enrichStatus: connection.enrichStatus,
    enrichError: connection.enrichError,
    enrichedAt: connection.enrichedAt,
  }).from(connection).where(and(
    eq(connection.orgId, user.orgId),
    eq(connection.enrichStatus, "done"),
    isNotNull(connection.enrichedAt),
  )).orderBy(desc(connection.enrichedAt)).limit(12);
  return NextResponse.json({
    people: rows.map((p) => ({
      title: `${p.firstName} ${p.lastName}`,
      subtitle: [p.positionRaw, p.companyRaw?.split("|")[0]?.trim()].filter(Boolean).join(" · "),
      pills: [
        p.score != null ? `score ${p.score}` : null,
        p.outreachMessage ? "draft ready" : "researched",
      ].filter(Boolean) as string[],
      about: (p.aboutSummary ?? "").slice(0, 280),
      pain: (p.painPoints ?? "").slice(0, 160),
    })),
  });
}
