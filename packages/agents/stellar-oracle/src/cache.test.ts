import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCached, getCacheStats, resetCache } from './cache.js';

describe('getCached', () => {
  beforeEach(() => {
    resetCache();
  });

  it('returns cached data within TTL without refetching', async () => {
    const fetcher = vi.fn(async () => ({ price: '0.100000' }));

    const first = await getCached('price:xlm-usdc', 10_000, fetcher);
    const second = await getCached('price:xlm-usdc', 10_000, fetcher);

    expect(first).toEqual({ price: '0.100000' });
    expect(second).toEqual({ price: '0.100000' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getCacheStats()).toEqual({ entries: 1, hits: 1, misses: 1 });
  });
});
