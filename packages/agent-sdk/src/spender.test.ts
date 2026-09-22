import { describe, it, expect, vi } from 'vitest';
import { createSpender, CleverConError } from './spender.js';

function mockFetch(status = 200, body: unknown = { id: 't1' }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const KEY = 'cc_test.secret';

describe('createSpender', () => {
  it('requires an apiKey', () => {
    expect(() => createSpender({ apiKey: '' })).toThrow(/apiKey is required/);
  });

  it('pay posts a single-line payment with the api key', async () => {
    const { fetchImpl, calls } = mockFetch();
    const cc = createSpender({ apiKey: KEY, apiUrl: 'http://x', fetchImpl });
    await cc.pay('GPAYEE', 5, { reason: 'design', policyId: 'pol1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://x/payments');
    expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      kind: 'pay',
      lines: [{ payee: 'GPAYEE', amount: 5, reason: 'design' }],
      policyId: 'pol1',
    });
  });

  it('disburse posts many lines', async () => {
    const { fetchImpl, calls } = mockFetch();
    const cc = createSpender({ apiKey: KEY, apiUrl: 'http://x', fetchImpl });
    await cc.disburse([
      { payee: 'GA', amount: 1 },
      { payee: 'GB', amount: 2, reason: 'r' },
    ]);
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.kind).toBe('disburse');
    expect(body.lines).toHaveLength(2);
  });

  it('setLimit splits isPrivate from the rules', async () => {
    const { fetchImpl, calls } = mockFetch(200, { id: 'p1', commitment: 'c' });
    const cc = createSpender({ apiKey: KEY, apiUrl: 'http://x', fetchImpl });
    await cc.setLimit({ perPaymentCeilingUsdc: 10, allowlist: ['GA'], isPrivate: true });
    expect(calls[0].url).toBe('http://x/policies');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      rules: { perPaymentCeilingUsdc: 10, allowlist: ['GA'] },
      isPrivate: true,
    });
  });

  it('getBudget reads the vault', async () => {
    const { fetchImpl, calls } = mockFetch(200, { balance: 5, available: 4, locked: 1 });
    const cc = createSpender({ apiKey: KEY, apiUrl: 'http://x', fetchImpl });
    const b = await cc.getBudget();
    expect(calls[0].url).toBe('http://x/vault');
    expect(b.available).toBe(4);
  });

  it('maps 401 to a CleverConError', async () => {
    const { fetchImpl } = mockFetch(401, { message: 'nope' });
    const cc = createSpender({ apiKey: KEY, apiUrl: 'http://x', fetchImpl });
    await expect(cc.getBudget()).rejects.toBeInstanceOf(CleverConError);
  });
});
