import { NextResponse } from "next/server";
import { currentUser } from "@/auth/session";
import { buildWorkbook } from "@/modules/exporter/workbook";
import { db, exportLog, connection } from "@/db";
import { and, eq, sql } from "drizzle-orm";
import { audit } from "@/lib/security/audit";

export async function GET(req: Request, ctx: { params: Promise<{ batchId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { batchId } = await ctx.params;
  const includeOps = new URL(req.url).searchParams.get("ops") === "1";
  const buf = await buildWorkbook(user.orgId, batchId, { includeOps });
    try {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(connection)
      .where(and(eq(connection.batchId, batchId), eq(connection.bucket, "pitchable")));
    await db.insert(exportLog).values({ orgId: user.orgId, batchId, label: `Workbook — ${batchId.slice(0, 6)}`, rows: n });
    await audit(user.orgId, user.email, "data.export", { batchId, rows: n });
  } catch { /* logging must never block the download */ }
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="focused-abm-batch-${batchId.slice(0, 8)}.xlsx"`,
    },
  });
}
