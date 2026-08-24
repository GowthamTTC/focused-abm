/**
 * Minimal single-user auth: bcrypt + HMAC-signed cookie. No session table.
 * At merge time this whole module is replaced by the mothership's OrgContext.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, appUser } from "@/db";
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

export async function login(email: string, password: string): Promise<boolean> {
  const [u] = await db.select().from(appUser).where(eq(appUser.email, email.toLowerCase()));
  if (!u) return false;
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return false;
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  (await cookies()).set(COOKIE, sign(`${u.id}:${exp}`), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_URL.startsWith("https"),
    maxAge: MAX_AGE,
    path: "/",
    // Mitigate session fixation; browser drops on browser-close only if maxAge omitted — we keep maxAge for UX.
  });
  return true;
}

export async function logout(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export interface Ctx { userId: string; orgId: string; email: string; name: string; mustChangePassword: boolean }

export async function currentUser(): Promise<Ctx | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const payload = verify(token);
  if (!payload) return null;
  const [userId, expStr] = payload.split(":");
  if (!userId || Number(expStr) < Date.now() / 1000) return null;
  const [u] = await db.select().from(appUser).where(eq(appUser.id, userId));
  if (!u) return null;
  return { userId: u.id, orgId: u.orgId, email: u.email, name: u.name, mustChangePassword: u.mustChangePassword };
}

export async function requireUser(): Promise<Ctx> {
  const u = await currentUser();
  if (!u) throw new Error("UNAUTHENTICATED");
  return u;
}
