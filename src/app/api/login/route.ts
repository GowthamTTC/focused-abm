/** Email/password sign-in.
 *
 *  The redirect is built from the FORWARDED host, never req.url — behind
 *  Railway's proxy, req.url is the container's localhost:8080. */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { currentUser, login } from "@/auth/session";
import { db, appUser } from "@/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client-ip";
import { audit } from "@/lib/security/audit";

function externalBase(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto")
    ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = rateLimit(`login-handler:${ip}`, 10, 15 * 60_000);
  if (!rl.ok) {
    return NextResponse.redirect(new URL("/login?err=rate", externalBase(req)), 303);
  }

  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  const ok = await login(email, password);
  const u = ok ? await currentUser() : null;

  if (ok && u) {
    await audit(u.orgId, u.email, "auth.login", { ip, ok: true });
  } else {
    // Soft audit under a system org lookup when possible
    const [row] = email
      ? await db.select({ orgId: appUser.orgId }).from(appUser).where(eq(appUser.email, email)).limit(1)
      : [];
    if (row?.orgId) {
      await audit(row.orgId, email || "unknown", "auth.login_failed", { ip, ok: false });
    }
  }

  const dest = !ok ? "/login?err=1" : u?.mustChangePassword ? "/change-password" : "/dashboard";
  return NextResponse.redirect(new URL(dest, externalBase(req)), 303);
}
