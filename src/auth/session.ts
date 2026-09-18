/**
 * Minimal single-user auth: bcrypt + HMAC-signed cookie. No session table.
 * At merge time this whole module is replaced by the mothership's OrgContext.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, appUser, org, DEFAULT_ORG_SETTINGS } from "@/db";
import { env } from "@/lib/env";

const COOKIE = "fabm_session";
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days
export const BCRYPT_ROUNDS = 12;

function sign(payload: string): string {
  const mac = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}
function verify(token: string): string | null {
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const mac = token.slice(i + 1);
  const expected = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(mac); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return payload;
}

async function issueCookie(userId: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  (await cookies()).set(COOKIE, sign(`${userId}:${exp}`), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_URL.startsWith("https"),
    maxAge: MAX_AGE,
    path: "/",
    // Mitigate session fixation; browser drops on browser-close only if maxAge omitted — we keep maxAge for UX.
  });
}

export async function login(email: string, password: string): Promise<boolean> {
  const [u] = await db.select().from(appUser).where(eq(appUser.email, email.toLowerCase()));
  if (!u) return false;
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return false;
  await issueCookie(u.id);
  return true;
}

export type SignupResult =
  | { ok: true; userId: string; orgId: string }
  | { ok: false; error: "taken" };

/** Self-serve provisioning: a private org workspace plus its first user, signed
 *  straight in on the same cookie `login()` issues. Callers must have validated
 *  the inputs (format, password policy) before getting here.
 *
 *  catalogMode is "own": a self-serve workspace defines its own offers in the
 *  setup wizard, and the admin catalog sync must never overwrite them. */
export async function createAccountAndLogin(input: {
  email: string; password: string; orgName: string; name: string;
}): Promise<SignupResult> {
  const email = input.email.trim().toLowerCase();
  const orgName = input.orgName.trim();
  const [existing] = await db.select({ id: appUser.id }).from(appUser)
    .where(eq(appUser.email, email)).limit(1);
  if (existing) return { ok: false, error: "taken" };

  const [newOrg] = await db.insert(org).values({
    name: orgName,
    settingsJson: { ...DEFAULT_ORG_SETTINGS, catalogMode: "own", sellerName: orgName },
  }).returning();

  let user;
  try {
    [user] = await db.insert(appUser).values({
      orgId: newOrg.id,
      email,
      name: input.name.trim(),
      passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
    }).returning();
  } catch (e) {
    // Unique violation: two signups raced on the same address. The loser's
    // orphan org would otherwise linger with no way to reach it.
    await db.delete(org).where(eq(org.id, newOrg.id));
    if ((e as { code?: string }).code === "23505") return { ok: false, error: "taken" };
    throw e;
  }

  await issueCookie(user.id);
  return { ok: true, userId: user.id, orgId: newOrg.id };
}

export async function logout(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export interface Ctx {
  userId: string; orgId: string; email: string; name: string; mustChangePassword: boolean;
  onboardingStep: number; onboardingCompletedAt: Date | null;
}

export async function currentUser(): Promise<Ctx | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const payload = verify(token);
  if (!payload) return null;
  const [userId, expStr] = payload.split(":");
  if (!userId || Number(expStr) < Date.now() / 1000) return null;
  const [u] = await db.select().from(appUser).where(eq(appUser.id, userId));
  if (!u) return null;
  return {
    userId: u.id, orgId: u.orgId, email: u.email, name: u.name,
    mustChangePassword: u.mustChangePassword,
    onboardingStep: u.onboardingStep,
    onboardingCompletedAt: u.onboardingCompletedAt,
  };
}

export async function requireUser(): Promise<Ctx> {
  const u = await currentUser();
  if (!u) throw new Error("UNAUTHENTICATED");
  return u;
}
