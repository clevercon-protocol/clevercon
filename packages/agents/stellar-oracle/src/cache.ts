export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
let hits = 0;
let misses = 0;

function getEnvTtlMs(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export const CACHE_TTLS = {
  priceMs: getEnvTtlMs('ORACLE_PRICE_CACHE_TTL_MS', 10_000),
  assetMs: getEnvTtlMs('ORACLE_ASSET_CACHE_TTL_MS', 60_000),
  accountMs: getEnvTtlMs('ORACLE_ACCOUNT_CACHE_TTL_MS', 30_000),
} as const;

function deleteIfExpired(key: string, entry: CacheEntry<unknown>): boolean {
  if (entry.expiresAt > Date.now()) return false;
  cache.delete(key);
  return true;
}

export async function getCached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && !deleteIfExpired(key, entry)) {
    hits += 1;
    return entry.data as T;
  }

  misses += 1;
  const data = await fn();
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

function purgeExpiredEntries() {
  for (const [key, entry] of cache.entries()) {
    deleteIfExpired(key, entry);
  }
}

export function getCacheStats() {
  purgeExpiredEntries();
  return { entries: cache.size, hits, misses };
}

export function resetCache() {
  cache.clear();
  hits = 0;
  misses = 0;
}
