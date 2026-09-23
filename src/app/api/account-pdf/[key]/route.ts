import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/auth/session";
import { buildAccountPdf } from "@/modules/accounts/account-pdf";
import { renderAccountPdf } from "@/modules/accounts/account-pdf-render";
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

  // Preferred: the real page, rendered. The drawn version is the fallback for
  // a host with no browser on it — same content, plainer, still linked.
  const path = `/accounts/${encodeURIComponent(key)}/l3?${req.nextUrl.searchParams.toString()}`;
  const rendered = await renderAccountPdf({ path, cookie: req.headers.get("cookie") ?? "" })
    .catch(() => null);

  const { buffer, filename, view } = rendered
    ? { buffer: rendered, filename: `account-intelligence-${key}-${new Date().toISOString().slice(0, 10)}.pdf`,
        view: { focusApplied: focus ?? null, contacts: [] as unknown[] } }
    : await buildAccountPdf(user.orgId, key, { focus, aliases });
  await audit(user.orgId, user.email, "account.pdf", {
    key, focus: view.focusApplied, people: view.contacts.length, mode: rendered ? "rendered" : "drawn",
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
