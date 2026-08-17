/** Login as a classic document POST → 303 redirect. No server action, no
 *  streamed response — deliberately boring HTTP that survives interfering
 *  proxies and security software. */
import { NextRequest, NextResponse } from "next/server";
import { login } from "@/auth/session";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const ok = await login(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  const dest = ok ? "/dashboard" : "/login?err=1";
  return NextResponse.redirect(new URL(dest, req.url), 303);
}
