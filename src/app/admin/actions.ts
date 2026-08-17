"use server";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, appUser, org, service, DEFAULT_ORG_SETTINGS } from "@/db";
import { ne as neq } from "drizzle-orm";
import { requireUser } from "@/auth/session";
import { env } from "@/lib/env";
import { SEED_SERVICES } from "@/modules/services/seed-data";

async function requireAdmin() {
  const user = await requireUser();
  if (user.email.toLowerCase() !== (env.ADMIN_EMAIL ?? "").toLowerCase()) redirect("/dashboard");
  return user;
}

/** Each new user gets their OWN isolated workspace: a fresh org (default
 *  guardrail settings), the six TTC services seeded into it, and zero access
 *  to anyone else's data. Every query in the app is org-scoped, so isolation
 *  is structural, not cosmetic. */
export async function addUser(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) redirect("/admin?err=Enter a name and a valid email.");
  if (password.length < 8) redirect("/admin?err=Password must be at least 8 characters.");
  const [existing] = await db.select().from(appUser).where(eq(appUser.email, email));
  if (existing) redirect("/admin?err=That email already has an account.");

  // "own" = an outside client who defines their own offers; their workspace
  // starts empty and is never touched by the catalog sync.
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
  await db.insert(appUser).values({
    orgId: newOrg.id, email, name,
    passwordHash: await bcrypt.hash(password, 10),
    mustChangePassword: true,
  });
  redirect("/admin?ok=1");
}

/** Platform-wide removal (never the admin, never yourself). The user's
 *  workspace data is retained but unreachable once its only user is gone. */
export async function removeUser(userId: string) {
  const admin = await requireAdmin();
  await db.delete(appUser).where(and(
    eq(appUser.id, userId),
    ne(appUser.email, (env.ADMIN_EMAIL ?? "").toLowerCase()),
    ne(appUser.id, admin.userId),
  ));
  redirect("/admin");
}

/** Push the admin workspace's CURRENT catalog (names + ICPs) to every other
 *  workspace, replacing their services wholesale. New signups seed from code;
 *  this button brings existing workspaces up to date after a catalog refresh. */
export async function syncCatalogToAllWorkspaces() {
  const admin = await requireAdmin();
  const catalog = await db.select().from(service).where(eq(service.orgId, admin.orgId));
  if (catalog.length === 0) redirect("/admin?err=Your own workspace has no services to sync.");
  const all = await db.select({ id: org.id, s: org.settingsJson }).from(org).where(neq(org.id, admin.orgId));
  // Client-owned catalogs are never overwritten.
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
