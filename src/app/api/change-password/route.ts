/** Password change, usable two ways:
 *  · signed in (or forced after a temp password) — no current password needed
 *  · from the login screen — email + current password proves identity
 *  Plain form POST + 303 redirect: no streaming, survives filtered networks. */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, appUser } from "@/db";
import { BCRYPT_ROUNDS, currentUser } from "@/auth/session";
import { checkPassword } from "@/lib/security/password-policy";
import { audit } from "@/lib/security/audit";
import { clientIp } from "@/lib/security/client-ip";
import { rateLimit } from "@/lib/security/rate-limit";

function base(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto")
    ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
const back = (req: NextRequest, err: string) =>
  NextResponse.redirect(new URL(`/change-password?err=${err}`, base(req)), 303);

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = rateLimit(`pwd:${ip}`, 8, 15 * 60_000);
  if (!rl.ok) return back(req, "rate");

  const form = await req.formData();
  const pwd = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const current = String(form.get("current") ?? "");

  if (pwd !== confirm) return back(req, "match");

  const session = await currentUser();
  let userId: string | null = session?.userId ?? null;
  let orgId: string | null = session?.orgId ?? null;
  let actorEmail = session?.email ?? email;

  if (!userId) {
    if (!email || !current) return back(req, "creds");
    const [u] = await db.select().from(appUser).where(eq(appUser.email, email));
    if (!u || !(await bcrypt.compare(current, u.passwordHash))) return back(req, "creds");
    userId = u.id;
    orgId = u.orgId;
    actorEmail = u.email;
  }

  const policy = checkPassword(pwd, actorEmail);
  if (!policy.ok) return back(req, "policy");

  await db.update(appUser)
    .set({ passwordHash: await bcrypt.hash(pwd, BCRYPT_ROUNDS), mustChangePassword: false })
    .where(eq(appUser.id, userId));

  if (orgId) {
    await audit(orgId, actorEmail, "auth.password_change", { ip });
  }

  return NextResponse.redirect(new URL(session ? "/dashboard" : "/login?changed=1", base(req)), 303);
}
