/** Password change, usable two ways:
 *  · signed in (or forced after a temp password) — no current password needed
 *  · from the login screen — email + current password proves identity
 *  Plain form POST + 303 redirect: no streaming, survives filtered networks. */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, appUser } from "@/db";
import { currentUser } from "@/auth/session";

function base(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto")
    ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
const back = (req: NextRequest, err: string) =>
  NextResponse.redirect(new URL(`/change-password?err=${err}`, base(req)), 303);

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const pwd = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const current = String(form.get("current") ?? "");

  if (pwd.length < 8) return back(req, "short");
  if (pwd !== confirm) return back(req, "match");

  const session = await currentUser();
  let userId: string | null = session?.userId ?? null;

  // Signed out: prove identity with the existing password.
  if (!userId) {
    if (!email || !current) return back(req, "creds");
    const [u] = await db.select().from(appUser).where(eq(appUser.email, email));
    if (!u || !(await bcrypt.compare(current, u.passwordHash))) return back(req, "creds");
    userId = u.id;
  }

  await db.update(appUser)
    .set({ passwordHash: await bcrypt.hash(pwd, 10), mustChangePassword: false })
    .where(eq(appUser.id, userId));

  // Signed-in users continue into the app; signed-out users sign in fresh.
  return NextResponse.redirect(new URL(session ? "/dashboard" : "/login?changed=1", base(req)), 303);
}
