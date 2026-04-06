/**
 * Simple in-memory rate limiter.
 * Tracks requests per IP with sliding window.
 * No external dependencies.
 */

interface RateWindow {
  count: number;
  resetAt: number;
}

const windows = new Map<string, RateWindow>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of windows) {
    if (window.resetAt < now) windows.delete(key);
  }
}, 5 * 60 * 1000);

export function checkRateLimit(
  ip: string,
  maxRequests: number = 60,
  windowMs: number = 60 * 1000
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const key = ip;
  const existing = windows.get(key);

  if (!existing || existing.resetAt < now) {
    // New window
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  existing.count++;
  const remaining = Math.max(0, maxRequests - existing.count);

  if (existing.count > maxRequests) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  return { allowed: true, remaining, resetAt: existing.resetAt };
}

/**
 * Global request counter for monitoring.
 */
let totalRequests = 0;
let totalBlocked = 0;

export function recordRequest(blocked: boolean): void {
  totalRequests++;
  if (blocked) totalBlocked++;
}

export function getStats(): { total: number; blocked: number } {
  return { total: totalRequests, blocked: totalBlocked };
}
