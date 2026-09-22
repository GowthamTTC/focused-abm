/** Self-serve sign-up: org + first user, signed in on the same cookie login()
 *  issues. Plain form POST + 303 redirect, matching /api/login.
 *
 *  Public and unauthenticated, so every field is re-validated here — the form's
 *  own required/minLength attributes prove nothing. */
import { NextRequest, NextResponse } from "next/server";
import { createAccountAndLogin } from "@/auth/session";
import { checkPassword } from "@/lib/security/password-policy";
import { audit } from "@/lib/security/audit";
import { clientIp } from "@/lib/security/client-ip";
import { rateLimit } from "@/lib/security/rate-limit";
import { signupAllowed } from "@/lib/feature-access";

function base(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto")
    ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = rateLimit(`signup-handler:${ip}`, 5, 15 * 60_000);

  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const orgName = String(form.get("orgName") ?? "").trim().slice(0, 120);
  const typedName = String(form.get("name") ?? "").trim().slice(0, 120);
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  const back = (err: string) => {
    const url = new URL("/signup", base(req));
    url.searchParams.set("err", err);
    if (err !== "email" && email) url.searchParams.set("email", email);
    if (orgName) url.searchParams.set("org", orgName);
    if (typedName) url.searchParams.set("name", typedName);
    return NextResponse.redirect(url, 303);
  };

  if (!rl.ok) return back("rate");
  if (!/^\S+@\S+\.\S+$/.test(email)) return back("email");
  if (!signupAllowed(email)) return back("closed");
  if (!orgName) return back("org");
  if (password !== confirm) return back("match");
  if (!checkPassword(password, email).ok) return back("policy");

  const result = await createAccountAndLogin({
    email,
    password,
    orgName,
    name: typedName || email.split("@")[0],
  });
  if (!result.ok) return back(result.error);

  await audit(result.orgId, email, "auth.signup", { ip });
  return NextResponse.redirect(new URL("/onboarding", base(req)), 303);
}
