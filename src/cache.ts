/**
 * Simple in-memory cache with TTL.
 * Prevents hammering Strapi on repeated queries.
 * Default TTL: 5 minutes.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<any>>();

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function cacheSet<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/**
 * Generate a cache key from function name + params.
 */
export function cacheKey(fn: string, params: Record<string, any>): string {
  const sorted = Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return `${fn}:${sorted}`;
}

// Clean up expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt < now) store.delete(key);
  }
}, 10 * 60 * 1000);

export function getCacheStats(): { entries: number } {
  return { entries: store.size };
}
