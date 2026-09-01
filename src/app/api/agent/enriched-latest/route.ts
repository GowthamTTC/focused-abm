import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUser } from "@/auth/session";
import { db, connection, job } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const [latest] = await db.select({
    id: job.id,
    kind: job.kind,
    status: job.status,
    payloadJson: job.payloadJson,
    createdAt: job.createdAt,
  }).from(job).where(and(
    eq(job.orgId, user.orgId),
    eq(job.kind, "deep_enrich"),
  )).orderBy(desc(job.createdAt)).limit(1);

  const ids = (latest?.payloadJson?.connectionIds as string[] | undefined)?.filter(Boolean) ?? [];
  if (ids.length === 0) {
    return NextResponse.json({ people: [], jobStatus: latest?.status ?? null });
  }

  const rows = await db.select({
    id: connection.id,
    firstName: connection.firstName,
    lastName: connection.lastName,
    companyRaw: connection.companyRaw,
    positionRaw: connection.positionRaw,
    score: connection.score,
    matchWhy: connection.matchWhy,
    serviceSlug: connection.serviceSlug,
    aboutSummary: connection.aboutSummary,
    painPoints: connection.painPoints,
    outreachMessage: connection.outreachMessage,
    enrichStatus: connection.enrichStatus,
    enrichedAt: connection.enrichedAt,
  }).from(connection).where(and(
    eq(connection.orgId, user.orgId),
    inArray(connection.id, ids),
  ));

  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

  return NextResponse.json({
    jobStatus: latest?.status ?? null,
    people: rows.map((p) => ({
      title: `${p.firstName} ${p.lastName}`,
      subtitle: [p.positionRaw, p.companyRaw?.split("|")[0]?.trim()].filter(Boolean).join(" · "),
      icp: p.serviceSlug ?? "icp",
      why: (p.matchWhy ?? "").slice(0, 220),
      pills: [
        p.score != null ? `score ${p.score}` : null,
        p.enrichStatus,
        p.outreachMessage ? "draft ready" : null,
      ].filter(Boolean) as string[],
      about: (p.aboutSummary ?? "").slice(0, 360),
      pain: (p.painPoints ?? "").slice(0, 220),
      draft: (p.outreachMessage ?? "").slice(0, 280),
    })),
  });
}
