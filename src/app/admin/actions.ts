"use server";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, appUser, org, service, clientAccount, DEFAULT_ORG_SETTINGS } from "@/db";
import { ne as neq } from "drizzle-orm";
import { requireUser } from "@/auth/session";
import { env } from "@/lib/env";
import { SEED_SERVICES } from "@/modules/services/seed-data";
import { checkPassword } from "@/lib/security/password-policy";
import { BCRYPT_ROUNDS } from "@/auth/session";

async function requireAdmin() {
  const user = await requireUser();
  if (user.email.toLowerCase() !== (env.ADMIN_EMAIL ?? "").toLowerCase()) redirect("/dashboard");
  return user;
}

export async function createClientAccount(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!name) redirect("/admin?err=Enter an account name.");
  const [row] = await db.insert(clientAccount).values({ name, notes }).returning();
  redirect(`/admin/accounts/${row.id}`);
}

export async function renameClientAccount(accountId: string, formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!name) redirect(`/admin/accounts/${accountId}?err=Name required`);
  await db.update(clientAccount).set({ name, notes }).where(eq(clientAccount.id, accountId));
  redirect(`/admin/accounts/${accountId}?ok=saved`);
}

/** Each user gets a private org workspace. Same client account ≠ shared data. */
export async function addUser(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const accountId = String(formData.get("accountId") ?? "").trim();
  const back = accountId ? `/admin/accounts/${accountId}` : "/admin";
  if (!accountId) redirect("/admin?err=Create or pick an account first, then add users under it.");
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) redirect(`${back}?err=Enter a name and a valid email.`);
  if (password.length < 8) redirect(`${back}?err=Password must be at least 8 characters.`);
  const [acct] = await db.select().from(clientAccount).where(eq(clientAccount.id, accountId)).limit(1);
  if (!acct) redirect("/admin?err=Account not found.");
  const [existing] = await db.select().from(appUser).where(eq(appUser.email, email));
  if (existing) redirect(`${back}?err=That email already has a login.`);

  const mode = String(formData.get("catalogMode") ?? "managed") === "own" ? "own" : "managed";
  const [newOrg] = await db.insert(org).values({
    name: `${name} — workspace`,
    settingsJson: { ...DEFAULT_ORG_SETTINGS, catalogMode: mode },
  }).returning();
  if (mode === "managed") {
    await db.insert(service).values(SEED_SERVICES.map((s) => ({
      orgId: newOrg.id, slug: s.slug, name: s.name, icpJson: s.icp,
    })));
  }
  const policy = checkPassword(password, email);
  if (!policy.ok) redirect(`${back}?err=password`);
  await db.insert(appUser).values({
    orgId: newOrg.id,
    clientAccountId: accountId,
    email,
    name,
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    mustChangePassword: true,
  });
  redirect(`${back}?ok=1`);
}

export async function assignUserToAccount(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  if (!userId || !accountId) redirect("/admin?err=Pick a user and an account.");
  await db.update(appUser).set({ clientAccountId: accountId }).where(eq(appUser.id, userId));
  redirect(`/admin/accounts/${accountId}`);
}

export async function removeUser(userId: string, accountId?: string) {
  const admin = await requireAdmin();
  await db.delete(appUser).where(and(
    eq(appUser.id, userId),
    ne(appUser.email, (env.ADMIN_EMAIL ?? "").toLowerCase()),
    ne(appUser.id, admin.userId),
  ));
  redirect(accountId ? `/admin/accounts/${accountId}` : "/admin");
}

export async function syncCatalogToAllWorkspaces() {
  const admin = await requireAdmin();
  const catalog = await db.select().from(service).where(eq(service.orgId, admin.orgId));
  if (catalog.length === 0) redirect("/admin?err=Your own workspace has no services to sync.");
  const all = await db.select({ id: org.id, s: org.settingsJson }).from(org).where(neq(org.id, admin.orgId));
  const orgs = all.filter((o) => (o.s as { catalogMode?: string })?.catalogMode !== "own");
  const skipped = all.length - orgs.length;
  for (const o of orgs) {
    await db.delete(service).where(eq(service.orgId, o.id));
    await db.insert(service).values(catalog.map((c) => ({
      orgId: o.id, slug: c.slug, name: c.name, status: c.status, icpJson: c.icpJson,
    })));
  }
  redirect(`/admin?ok=synced&n=${orgs.length}&skipped=${skipped}`);
}
