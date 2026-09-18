import { NextRequest, NextResponse } from "next/server";
import { applySecurityHeaders } from "@/lib/security/headers";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client-ip";

const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/change-password",
  "/api/login",
  "/api/signup",
  "/api/change-password",
  "/api/webhooks",
  "/api/version",
  "/api/mock",
];

function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const https = (req.headers.get("x-forwarded-proto") ?? "https") === "https"
    || req.nextUrl.protocol === "https:";

  // Login brute-force shield (edge-side, before handler)
  if (pathname === "/api/login" && req.method === "POST") {
    const ip = clientIp(req);
    const rl = rateLimit(`login:${ip}`, 10, 15 * 60_000); // 10 / 15 min
    if (!rl.ok) {
      const res = NextResponse.redirect(new URL("/login?err=rate", req.url), 303);
      res.headers.set("Retry-After", String(rl.retryAfterSec));
      return applySecurityHeaders(res, https);
    }
  }

  // Sign-up flood shield — cheaper here than after the org insert
  if (pathname === "/api/signup" && req.method === "POST") {
    const ip = clientIp(req);
    const rl = rateLimit(`signup:${ip}`, 5, 15 * 60_000); // 5 / 15 min
    if (!rl.ok) {
      const res = NextResponse.redirect(new URL("/signup?err=rate", req.url), 303);
      res.headers.set("Retry-After", String(rl.retryAfterSec));
      return applySecurityHeaders(res, https);
    }
  }

  // Cookie presence gate for app pages (HMAC verified later in requireUser)
  if (!isPublic(pathname) && !pathname.startsWith("/api/")) {
    const session = req.cookies.get("fabm_session")?.value;
    if (!session) {
      const login = new URL("/login", req.url);
      login.searchParams.set("next", pathname);
      return applySecurityHeaders(NextResponse.redirect(login), https);
    }
  }

  // API routes (except public): require session cookie
  if (pathname.startsWith("/api/") && !isPublic(pathname)) {
    const session = req.cookies.get("fabm_session")?.value;
    if (!session) {
      return applySecurityHeaders(
        NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
        https,
      );
    }
  }

  const res = NextResponse.next();
  return applySecurityHeaders(res, https);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)"],
};
