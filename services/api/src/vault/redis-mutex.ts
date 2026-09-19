import { randomUUID } from 'node:crypto';

/**
 * Minimal ioredis-compatible surface the lock needs. Declared here so this
 * module has no ioredis dependency; callers pass their existing client.
 */
export interface LockClient {
  set(key: string, value: string, px: 'PX', ttl: number, nx: 'NX'): Promise<'OK' | null>;
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
}

// Compare-and-delete: only release the lock if we still hold it (never drop
// another holder's lock after our lease expired).
const RELEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RedisMutexOptions {
  /** Lock lease; must exceed the critical section. Default 90s. */
  ttlMs?: number;
  /** Give up acquiring after this. Default 150s. */
  maxWaitMs?: number;
  /** Base poll interval while waiting (jittered). Default 200ms. */
  pollMs?: number;
  prefix?: string;
}

export interface RedisMutex {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * A cross-process advisory lock over Redis, so a resource shared by multiple
 * processes (e.g. one delegate signer used by both the API and the settlement
 * worker) is only touched by one at a time and never races its sequence number.
 * Fail-safe: a crashed holder's lock expires after `ttlMs`; release is a
 * compare-and-delete keyed by a per-acquire token.
 */
export function createRedisMutex(client: LockClient, options: RedisMutexOptions = {}): RedisMutex {
  const ttlMs = options.ttlMs ?? 90_000;
  const maxWaitMs = options.maxWaitMs ?? 150_000;
  const pollMs = options.pollMs ?? 200;
  const prefix = options.prefix ?? 'cc:dlock:';

  async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = prefix + key;
    const token = randomUUID();
    const start = Date.now();
    for (;;) {
      const ok = await client.set(lockKey, token, 'PX', ttlMs, 'NX');
      if (ok === 'OK') break;
      if (Date.now() - start > maxWaitMs) throw new Error(`redis lock timeout for ${key}`);
      await sleep(pollMs + Math.floor(Math.random() * pollMs));
    }
    try {
      return await fn();
    } finally {
      try {
        await client.eval(RELEASE_SCRIPT, 1, lockKey, token);
      } catch {
        // the lease will expire on its own
      }
    }
  }

  return { withLock };
}
