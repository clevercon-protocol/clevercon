import { describe, it, expect } from 'vitest';
import { KeyedMutex } from './sequence.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('KeyedMutex', () => {
  it('serializes calls for the same key (no interleaving)', async () => {
    const m = new KeyedMutex();
    const order: string[] = [];
    const run = (label: string, ms: number) =>
      m.runExclusive('signer-1', async () => {
        order.push(`${label}-start`);
        await wait(ms);
        order.push(`${label}-end`);
      });
    await Promise.all([run('a', 30), run('b', 5)]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('runs different keys in parallel', async () => {
    const m = new KeyedMutex();
    const order: string[] = [];
    const run = (key: string, label: string, ms: number) =>
      m.runExclusive(key, async () => {
        order.push(`${label}-start`);
        await wait(ms);
        order.push(`${label}-end`);
      });
    await Promise.all([run('k1', 'a', 30), run('k2', 'b', 5)]);
    // b (fast, different signer) overlaps and finishes before a
    expect(order).toEqual(['a-start', 'b-start', 'b-end', 'a-end']);
  });

  it('a rejected op does not wedge the key', async () => {
    const m = new KeyedMutex();
    await expect(
      m.runExclusive('k', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await m.runExclusive('k', async () => 42)).toBe(42);
  });

  it('returns the fn result to the caller', async () => {
    const m = new KeyedMutex();
    expect(await m.runExclusive('k', async () => 7)).toBe(7);
  });
});
