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

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", base(req)), 303);
  const form = await req.formData();
  const pwd = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (pwd.length < 8) return NextResponse.redirect(new URL("/change-password?err=short", base(req)), 303);
  if (pwd !== confirm) return NextResponse.redirect(new URL("/change-password?err=match", base(req)), 303);
  await db.update(appUser)
    .set({ passwordHash: await bcrypt.hash(pwd, 10), mustChangePassword: false })
    .where(eq(appUser.id, user.userId));
  return NextResponse.redirect(new URL("/dashboard", base(req)), 303);
}
