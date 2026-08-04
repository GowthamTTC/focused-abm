import { NextResponse } from "next/server";
import { currentUser } from "@/auth/session";
import { buildWorkbook } from "@/modules/exporter/workbook";

export async function GET(req: Request, ctx: { params: Promise<{ batchId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { batchId } = await ctx.params;
  const includeOps = new URL(req.url).searchParams.get("ops") === "1";
  const buf = await buildWorkbook(user.orgId, batchId, { includeOps });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="focused-abm-batch-${batchId.slice(0, 8)}.xlsx"`,
    },
  });
}
