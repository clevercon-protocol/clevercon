import { describe, it, expect, vi } from 'vitest';
import { createMarketplaceClient } from './discovery.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const svc = {
  id: 'svc1',
  agentId: 'agent-1',
  name: 'Market Oracle',
  description: 'Prices',
  category: 'data',
  capabilities: ['price'],
  pricingModel: 'X402',
  pricePerCall: 0.05,
  currency: 'USDC',
  endpoint: 'https://p.example',
  status: 'ACTIVE',
  tier: 'T2' as const,
  verification: { method: 'attest' as const },
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  trust: 'trusted',
  settlements: 12,
  uniquePayers: 3,
  verified: true,
  reputation: { score: 4.8, totalJobs: 15 },
};

describe('createMarketplaceClient', () => {
  it('lists + maps services and forwards filters as query params', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [svc] }));
    const client = createMarketplaceClient({
      baseUrl: 'https://api.test/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await client.listServices({ category: 'data', tier: 'T2', q: 'price', limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'svc1',
      tier: 'T2',
      trust: 'trusted',
      rating: 4.8,
      totalJobs: 15,
      verification: { method: 'attest' },
    });
    const url = (fetchImpl.mock.calls[0] as unknown as [string])[0];
    expect(url.startsWith('https://api.test/services?')).toBe(true);
    expect(url).toContain('category=data');
    expect(url).toContain('tier=T2');
    expect(url).toContain('q=price');
    expect(url).toContain('limit=10');
  });

  it('gets one service by id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(svc));
    const client = createMarketplaceClient({
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await client.getService('svc1');
    expect(out.name).toBe('Market Oracle');
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.test/services/svc1',
    );
  });

  it('throws on a non-2xx list', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'boom' }, 500));
    const client = createMarketplaceClient({
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.listServices()).rejects.toThrow('HTTP 500');
  });

  it('returns the fee bps, and 0 when the read fails', async () => {
    const ok = createMarketplaceClient({
      baseUrl: 'https://api.test',
      fetchImpl: (async () => jsonResponse({ bps: 30 })) as unknown as typeof fetch,
    });
    expect(await ok.platformFeeBps()).toBe(30);

    const bad = createMarketplaceClient({
      baseUrl: 'https://api.test',
      fetchImpl: (async () => jsonResponse({}, 503)) as unknown as typeof fetch,
    });
    expect(await bad.platformFeeBps()).toBe(0);
  });
});
