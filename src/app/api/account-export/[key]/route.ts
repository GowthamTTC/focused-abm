import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/auth/session";
import { buildAccountWorkbook } from "@/modules/accounts/account-export";
import { audit } from "@/lib/security/audit";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { key: raw } = await ctx.params;
  const key = decodeURIComponent(raw);
  const focus = req.nextUrl.searchParams.get("focus") ?? undefined;
  const aliases = (req.nextUrl.searchParams.get("alias") ?? "")
    .split(",").map((a) => a.trim()).filter(Boolean);

  const { buffer, filename, rows } = await buildAccountWorkbook(user.orgId, key, { focus, aliases });
  await audit(user.orgId, user.email, "account.export", { key, focus, rows });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
