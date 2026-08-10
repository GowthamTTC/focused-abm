"use server";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, appUser } from "@/db";
import { requireUser } from "@/auth/session";
import { env } from "@/lib/env";

async function requireAdmin() {
  const user = await requireUser();
  if (user.email.toLowerCase() !== (env.ADMIN_EMAIL ?? "").toLowerCase()) redirect("/dashboard");
  return user;
}

export async function addUser(formData: FormData) {
  const admin = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) redirect("/admin?err=Enter a name and a valid email.");
  if (password.length < 8) redirect("/admin?err=Password must be at least 8 characters.");
  const [existing] = await db.select().from(appUser).where(eq(appUser.email, email));
  if (existing) redirect("/admin?err=That email already has an account.");
  await db.insert(appUser).values({
    orgId: admin.orgId, email, name,
    passwordHash: await bcrypt.hash(password, 10),
  });
  redirect("/admin?ok=1");
}

export async function removeUser(userId: string) {
  const admin = await requireAdmin();
  // Never the admin account, never yourself.
  await db.delete(appUser).where(and(
    eq(appUser.id, userId), eq(appUser.orgId, admin.orgId),
    ne(appUser.email, (env.ADMIN_EMAIL ?? "").toLowerCase()), ne(appUser.id, admin.userId),
  ));
  redirect("/admin");
}
