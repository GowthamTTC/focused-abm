/**
 * In-process rate limiter. Fine for a single Railway instance.
 * For multi-instance, swap the store for Redis without changing callers.
 */
type Bucket = { count: number; resetAt: number };

const store = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  let b = store.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    store.set(key, b);
  }
  b.count += 1;
  const remaining = Math.max(0, limit - b.count);
  const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  if (b.count > limit) return { ok: false, remaining: 0, retryAfterSec };
  return { ok: true, remaining, retryAfterSec };
}

/** Periodic cleanup so the map cannot grow forever. */
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of store) {
    if (b.resetAt <= now) store.delete(k);
  }
}, 60_000).unref?.();
