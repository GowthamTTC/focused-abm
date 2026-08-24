import type { NextRequest } from "next/server";

/** Best-effort client IP behind Railway / proxies. */
export function clientIp(req: NextRequest | Request): string {
  const h = (name: string) => {
    if ("headers" in req && typeof (req as NextRequest).headers?.get === "function") {
      return (req as NextRequest).headers.get(name);
    }
    return null;
  };
  const xf = h("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim().slice(0, 64);
  const real = h("x-real-ip");
  if (real) return real.trim().slice(0, 64);
  return "unknown";
}
