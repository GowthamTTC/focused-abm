import { and, desc, eq, sql } from "drizzle-orm";
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
  }).from(job).where(and(
    eq(job.orgId, user.orgId),
    sql`kind in ('event_extended','event_scan')`,
  )).orderBy(desc(job.createdAt)).limit(1);

  const eventName = String((latest?.payloadJson as { eventName?: string } | null)?.eventName ?? "").trim();
  const batchId = String((latest?.payloadJson as { result?: { batchId?: string } } | null)?.result?.batchId ?? "").trim();

  const rows = await db.select({
    id: connection.id,
    firstName: connection.firstName,
    lastName: connection.lastName,
    companyRaw: connection.companyRaw,
    positionRaw: connection.positionRaw,
    score: connection.score,
    eventQuery: connection.eventQuery,
    mentionSnippet: connection.mentionSnippet,
    enrichStatus: connection.enrichStatus,
  }).from(connection).where(and(
    eq(connection.orgId, user.orgId),
    batchId
      ? eq(connection.batchId, batchId)
      : eventName
        ? sql`event_query ilike ${eventName}`
        : sql`event_query is not null`,
  )).orderBy(desc(connection.mentionAt)).limit(20);

  return NextResponse.json({
    jobStatus: latest?.status ?? null,
    event: eventName || null,
    people: rows.map((p) => ({
      title: `${p.firstName} ${p.lastName}`,
      subtitle: [p.positionRaw, p.companyRaw?.split("|")[0]?.trim()].filter(Boolean).join(" · "),
      icp: p.eventQuery ?? "radar",
      why: (p.mentionSnippet ?? "").slice(0, 220),
      pills: [
        p.eventQuery ?? "event",
        p.score != null ? `ICP ${p.score}` : null,
        p.enrichStatus,
      ].filter(Boolean) as string[],
      about: (p.mentionSnippet ?? "").slice(0, 360),
      pain: "",
      draft: "",
    })),
  });
}
