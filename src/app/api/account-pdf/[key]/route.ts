import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/auth/session";
import { buildAccountPdf } from "@/modules/accounts/account-pdf";
import { audit } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { key: raw } = await ctx.params;
  const key = decodeURIComponent(raw);
  const focus = req.nextUrl.searchParams.get("focus") || undefined;
  const aliases = (req.nextUrl.searchParams.get("alias") ?? "")
    .split(",").map((a) => a.trim()).filter(Boolean);

  const { buffer, filename, view } = await buildAccountPdf(user.orgId, key, { focus, aliases });
  await audit(user.orgId, user.email, "account.pdf", {
    key, focus: view.focusApplied, people: view.contacts.length,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
