/** Login as a classic document POST → 303 redirect. No server action, no
 *  streamed response — deliberately boring HTTP that survives interfering
 *  proxies and security software.
 *
 *  The redirect is built from the FORWARDED host, never req.url — behind
 *  Railway's proxy, req.url is the container's localhost:8080. */
import { NextRequest, NextResponse } from "next/server";
import { currentUser, login } from "@/auth/session";

function externalBase(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto")
    ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const ok = await login(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  const u = ok ? await currentUser() : null;
  const dest = !ok ? "/login?err=1" : u?.mustChangePassword ? "/change-password" : "/dashboard";
  return NextResponse.redirect(new URL(dest, externalBase(req)), 303);
}
