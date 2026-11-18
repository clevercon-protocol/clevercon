import { describe, it, expect } from 'vitest';
import { createRedisMutex, type LockClient } from './redis-mutex.js';

/** In-memory stand-in for the ioredis surface the lock uses (SET NX PX + CAS del). */
function fakeRedis(): LockClient {
  const store = new Map<string, string>();
  return {
    async set(key, value, _px, _ttl, _nx) {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async eval(_script, _n, key, token) {
      if (store.get(key as string) === token) {
        store.delete(key as string);
        return 1;
      }
      return 0;
    },
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('createRedisMutex', () => {
  it('serializes the same key and releases after each holder', async () => {
    const m = createRedisMutex(fakeRedis(), { pollMs: 5 });
    const order: string[] = [];
    const run = (label: string, ms: number) =>
      m.withLock('signer', async () => {
        order.push(`${label}-in`);
        await wait(ms);
        order.push(`${label}-out`);
      });
    await Promise.all([run('a', 25), run('b', 5)]);
    expect(order).toEqual(['a-in', 'a-out', 'b-in', 'b-out']);
  });

  it('different keys do not block each other', async () => {
    const m = createRedisMutex(fakeRedis(), { pollMs: 5 });
    const order: string[] = [];
    const run = (key: string, label: string, ms: number) =>
      m.withLock(key, async () => {
        order.push(`${label}-in`);
        await wait(ms);
        order.push(`${label}-out`);
      });
    await Promise.all([run('k1', 'a', 25), run('k2', 'b', 5)]);
    expect(order).toEqual(['a-in', 'b-in', 'b-out', 'a-out']);
  });

  it('releases the lock even if the critical section throws', async () => {
    const m = createRedisMutex(fakeRedis(), { pollMs: 5 });
    await expect(
      m.withLock('k', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // If the lock leaked, this second acquire would hang; it must resolve.
    expect(await m.withLock('k', async () => 'ok')).toBe('ok');
  });
});
